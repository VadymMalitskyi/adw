import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadPlanTemplate,
  parseYaml,
  resolvePlanTemplate,
  validatePlanTemplate,
  validateProjectConfig,
} from "../../plugin/lib/adw-helper.mjs";

const CORE = [
  "<!-- ADW:PLAN 1 -->",
  "<!-- ADW:REQUIRED-SECTIONS feature-overview security-review acceptance-criteria implementation-plan whole-feature-validation -->",
  "<!-- ADW:SECTION feature-overview -->",
  "# Why this change exists",
  "<!-- ADW:SECTION security-review -->",
  "## Project-required security review",
  "<!-- ADW:SECTION acceptance-criteria -->",
  "## What success means",
  "<!-- ADW:SECTION implementation-plan -->",
  "# How we will deliver it",
  "<!-- ADW:SECTION whole-feature-validation -->",
  "## How the finished change is proved",
  "",
].join("\n");

const BASE = `adw: 1
git:
  base_branch: main
docs:
  branch: docs
  worktree: worktrees/docs
execution:
  mode: sequential
  isolation: provider-sandbox
components:
  app:
    path: .
    validate: []
`;

test("stable markers permit project-owned headings and additional mandatory sections", () => {
  const result = validatePlanTemplate(CORE);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.sections, [
    "feature-overview",
    "security-review",
    "acceptance-criteria",
    "implementation-plan",
    "whole-feature-validation",
  ]);
  assert.deepEqual(result.required_sections, result.sections);

  const fenced = `${CORE}\n\`\`\`markdown\n<!-- ADW:SECTION ignored-example -->\n\`\`\`\n`;
  assert.equal(validatePlanTemplate(fenced).valid, true);
  assert.equal(validatePlanTemplate(fenced).sections.includes("ignored-example"), false);
});

test("marker validation rejects missing, duplicate, malformed, and reordered core sections", () => {
  const missing = validatePlanTemplate(CORE.replace("<!-- ADW:SECTION acceptance-criteria -->\n", ""));
  assert.equal(missing.valid, false);
  assert.match(JSON.stringify(missing.errors), /acceptance-criteria/);

  const duplicate = validatePlanTemplate(CORE.replace(
    "<!-- ADW:SECTION acceptance-criteria -->",
    "<!-- ADW:SECTION security-review -->\n<!-- ADW:SECTION acceptance-criteria -->",
  ));
  assert.equal(duplicate.valid, false);
  assert.match(JSON.stringify(duplicate.errors), /duplicates/);

  const reordered = validatePlanTemplate(CORE
    .replace("<!-- ADW:SECTION acceptance-criteria -->", "<!-- swap -->")
    .replace("<!-- ADW:SECTION implementation-plan -->", "<!-- ADW:SECTION acceptance-criteria -->")
    .replace("<!-- swap -->", "<!-- ADW:SECTION implementation-plan -->"));
  assert.equal(reordered.valid, false);
  assert.match(JSON.stringify(reordered.errors), /out of order/);

  const malformed = validatePlanTemplate(CORE.replace("<!-- ADW:PLAN 1 -->", "<!-- ADW:PLAN latest -->"));
  assert.equal(malformed.valid, false);
  assert.match(JSON.stringify(malformed.errors), /malformed|exactly one/);

  const omittedCustomSection = validatePlanTemplate(CORE.replace(
    "<!-- ADW:SECTION security-review -->\n## Project-required security review\n",
    "",
  ));
  assert.equal(omittedCustomSection.valid, false);
  assert.match(JSON.stringify(omittedCustomSection.errors), /required-sections manifest/);

  const weakenedManifest = validatePlanTemplate(CORE.replace(" security-review", ""));
  assert.equal(weakenedManifest.valid, false);
  assert.match(JSON.stringify(weakenedManifest.errors), /required-sections manifest/);

  const expected = validatePlanTemplate(CORE).sections;
  const coordinatedWeakening = CORE
    .replace(" security-review", "")
    .replace("<!-- ADW:SECTION security-review -->\n## Project-required security review\n", "");
  assert.equal(validatePlanTemplate(coordinatedWeakening).valid, true, "the weakened document remains internally coherent");
  const expectedMismatch = validatePlanTemplate(coordinatedWeakening, { expected_sections: expected });
  assert.equal(expectedMismatch.valid, false);
  assert.match(JSON.stringify(expectedMismatch.errors), /expected template sections/);
});

test("project configuration declares a default from safe unique Markdown template paths", () => {
  const valid = validateProjectConfig(parseYaml(`${BASE}planning:
  default_template: standard
  templates:
    standard: adw/plan-templates/standard.md
    migration: adw/plan-templates/migration.md
`));
  assert.equal(valid.valid, true, JSON.stringify(valid.errors));
  assert.deepEqual(valid.data.planning, {
    default_template: "standard",
    templates: {
      standard: "adw/plan-templates/standard.md",
      migration: "adw/plan-templates/migration.md",
    },
  });
  assert.equal(validateProjectConfig(parseYaml(BASE)).data.planning, null, "legacy projects retain the bundled fallback");

  for (const [fragment, expected] of [
    ["planning:\n  default_template: missing\n  templates:\n    standard: adw/standard.md\n", "/planning/default_template"],
    ["planning:\n  default_template: standard\n  templates: {}\n", "/planning/templates"],
    ["planning:\n  default_template: standard\n  templates:\n    standard: ../outside.md\n", "/planning/templates/standard"],
    ["planning:\n  default_template: standard\n  templates:\n    standard: adw/standard.txt\n", "/planning/templates/standard"],
    ["planning:\n  default_template: standard\n  templates:\n    standard: adw/standard.md\n    alias: adw/standard.md\n", "/planning/templates/alias"],
    ["planning:\n  default_template: standard\n  templates:\n    standard: plans/x.md\n    alias: plans//x.md\n", "/planning/templates/alias"],
    ["planning:\n  default_template: standard\n  templates:\n    standard: plans/x.md\n    alias: plans/./x.md\n", "/planning/templates/alias"],
  ]) {
    const invalid = validateProjectConfig(parseYaml(`${BASE}${fragment}`));
    assert.equal(invalid.valid, false, fragment);
    assert.ok(invalid.errors.some(({ path }) => path === expected), JSON.stringify(invalid.errors));
  }
});

test("template resolution uses explicit, local, project-default, then legacy fallback", async () => {
  const root = mkdtempSync(join(tmpdir(), "adw-plan-template-"));
  mkdirSync(join(root, "adw/plan-templates"), { recursive: true });
  mkdirSync(join(root, ".adw"), { recursive: true });
  writeFileSync(join(root, "adw/plan-templates/standard.md"), CORE.replace("Why this change exists", "Standard"));
  writeFileSync(join(root, "adw/plan-templates/migration.md"), CORE.replace("Why this change exists", "Migration"));
  writeFileSync(join(root, "adw.yaml"), `${BASE}planning:
  default_template: standard
  templates:
    standard: adw/plan-templates/standard.md
    migration: adw/plan-templates/migration.md
`);

  const projectDefault = await resolvePlanTemplate({ project_root: root });
  assert.equal(projectDefault.template.name, "standard");
  assert.equal(projectDefault.template.selected_by, "project-default");

  writeFileSync(join(root, ".adw/local.yaml"), "schema: 1\nplanning:\n  preferred_template: migration\n");
  const local = await resolvePlanTemplate({ project_root: root });
  assert.equal(local.template.name, "migration");
  assert.equal(local.template.selected_by, "local");

  const explicit = await resolvePlanTemplate({ project_root: root, requested_template: "standard" });
  assert.equal(explicit.template.name, "standard");
  assert.equal(explicit.template.selected_by, "explicit");

  writeFileSync(join(root, ".adw/local.yaml"), "schema: 2\nplanning:\n  preferred_template: migration\n");
  await assert.rejects(resolvePlanTemplate({ project_root: root }), /schema must equal 1/);

  writeFileSync(join(root, "adw.yaml"), BASE);
  writeFileSync(join(root, ".adw/local.yaml"), "not valid: [\n");
  const fallback = await resolvePlanTemplate({ project_root: root });
  assert.deepEqual(fallback.template, { source: "bundled", selected_by: "legacy-fallback", name: null, path: null });
});

test("template loading rejects missing and symlinked project files", async () => {
  const root = mkdtempSync(join(tmpdir(), "adw-plan-template-path-"));
  writeFileSync(join(root, "real.md"), CORE);
  symlinkSync(join(root, "real.md"), join(root, "linked.md"));
  await assert.rejects(loadPlanTemplate({ project_root: root, path: "missing.md" }), /does not exist/);
  await assert.rejects(loadPlanTemplate({ project_root: root, path: "linked.md" }), /non-symlink/);
  await assert.rejects(loadPlanTemplate({ project_root: root, path: "../outside.md" }), /escapes the project root/);
});
