import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeDigest, dispatch, EXIT, validatePlanTemplate } from "../../plugin/lib/adw-helper.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function readSkill(name) {
  return readFileSync(resolve(repositoryRoot, `plugin/skills/${name}/SKILL.md`), "utf8");
}

const templatePath = resolve(repositoryRoot, "plugin/templates/plan.md");
const template = readFileSync(templatePath, "utf8");

test("the bundled plan template carries the stable semantic marker contract", () => {
  const result = validatePlanTemplate(template);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.sections, [
    "feature-overview",
    "acceptance-criteria",
    "implementation-plan",
    "whole-feature-validation",
  ]);
  assert.ok((template.match(/^### Group: /gm) ?? []).length >= 3, "the standard template demonstrates more than one group");
});

test("headings are project-owned while missing or reordered semantic markers fail", () => {
  const renamed = template
    .replace("# PART 1 — Feature Overview", "# Why this matters")
    .replace("## Summary", "## User-visible outcome")
    .replace("# PART 2 — Implementation Plan", "# How we will deliver it")
    .replace("## Whole-feature validation", "## Proof after integration");
  assert.equal(validatePlanTemplate(renamed).valid, true);

  const missing = validatePlanTemplate(template.replace("<!-- ADW:SECTION acceptance-criteria -->\n", ""));
  assert.equal(missing.valid, false);
  assert.match(JSON.stringify(missing.errors), /acceptance-criteria/);

  const reordered = validatePlanTemplate(template
    .replace("<!-- ADW:SECTION acceptance-criteria -->", "<!-- swap -->")
    .replace("<!-- ADW:SECTION implementation-plan -->", "<!-- ADW:SECTION acceptance-criteria -->")
    .replace("<!-- swap -->", "<!-- ADW:SECTION implementation-plan -->"));
  assert.equal(reordered.valid, false);
  assert.match(JSON.stringify(reordered.errors), /out of order/);
});

test("the template demonstrates the glance table, anchor style, and directive task block", () => {
  const header = /\|\s*Phase\s*\|\s*Group\s*\|\s*Component\s*\|\s*Primary paths\s*\|\s*Depends on\s*\|\s*Tracker\s*\|\s*Delivery\s*\|/;
  assert.match(template, header, "glance table must expose the seven canonical columns");

  const glanceRows = template
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  assert.ok(glanceRows.length >= 3, "the template must show a worked multi-phase glance table");
  for (const row of glanceRows) {
    assert.equal(row.length, 7, `glance row must have seven cells: ${row.join(" | ")}`);
    assert.match(row[0], /^\d+$/, "phase column is a phase number");
    assert.match(row[1], /^`[a-z0-9]+(?:-[a-z0-9]+)*`$/, "group ids are stable and lowercase");
    assert.match(row[6], /group PR|integration PR/, "delivery intent is explicit");
  }

  // Groups sharing a phase must be demonstrably path-disjoint in the template.
  const byPhase = new Map();
  for (const row of glanceRows) {
    if (!byPhase.has(row[0])) byPhase.set(row[0], []);
    byPhase.get(row[0]).push(row[3].replaceAll("`", ""));
  }
  for (const [phase, paths] of byPhase) {
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        assert.ok(
          !paths[i].startsWith(paths[j]) && !paths[j].startsWith(paths[i]),
          `phase ${phase}: concurrent groups must not share write paths`,
        );
      }
    }
  }

  const anchors = template.split("\n").filter((line) => /\S+\.[a-z]+ -> /.test(line));
  assert.ok(anchors.length >= 3, "the template must demonstrate file -> symbol anchors");
  for (const anchor of anchors) {
    assert.doesNotMatch(anchor, /\.[a-z]+:\d+/, `anchors must not use line numbers: ${anchor}`);
  }

  for (const keyword of ["IMPLEMENT", "CONTRACT", "PATTERN", "GOTCHA", "DONE WHEN", "VALIDATE"]) {
    assert.match(template, new RegExp(`\\*\\*${keyword}:\\*\\*`), `template omits the ${keyword} directive`);
  }

  assert.match(template, /## Whole-feature validation/);
  assert.match(template, /immutable after approval/i);
  assert.match(template, /adw:amend/);
});

test("the template is stable, digestible bytes the approval contract can bind", async () => {
  const bytes = readFileSync(templatePath);
  const digested = await dispatch("digest", { content: bytes.toString("utf8") });
  assert.equal(digested.exitCode, EXIT.OK);
  assert.equal(digested.body.digest, computeDigest(bytes));
  assert.match(digested.body.digest, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(template, /\r/, "the canonical template must not carry CRLF bytes");
});

test("plan skill produces one canonical plan.md and stops before approval or implementation", () => {
  const skill = readSkill("plan");

  assert.match(skill, /changes\/<change-id>\/plan\.md/);
  assert.match(skill, /templates\/plan\.md/);
  assert.match(skill, /resolve-plan-template/);
  assert.match(skill, /ADW:SECTION feature-overview[\s\S]*ADW:SECTION whole-feature-validation/);
  assert.match(skill, /load-project/);
  assert.match(skill, /Never implement a task/);
  assert.match(skill, /Never create or switch a code branch/);
  assert.match(skill, /Do not create `approval\.json`/);
  assert.match(skill, /Stop and invite `adw:approve`/);
  assert.match(skill, /never modify application code/i);
});

test("plan skill restores phases, groups, anchors, directives, and validation sourcing", () => {
  const skill = readSkill("plan");

  assert.match(skill, /\^\[a-z0-9\]/);
  assert.match(skill, /glance table/i);
  assert.match(skill, /`Phase`, `Group`, `Component`, `Primary paths`, `Depends on`, `Tracker`, `Delivery`/);
  assert.match(skill, /stable lowercase id/i);
  assert.match(skill, /file -> symbol/);
  assert.match(skill, /never line numbers/i);
  assert.match(skill, /IMPLEMENT[\s\S]{0,200}CONTRACT[\s\S]{0,200}PATTERN[\s\S]{0,200}GOTCHA[\s\S]{0,200}DONE WHEN[\s\S]{0,200}VALIDATE/);
  assert.match(skill, /exact, non-interactive, and derived from an observable manifest, task runner, CI workflow, or authoritative project documentation/);
  assert.match(skill, /Do not invent a command/);
  assert.match(skill, /group pull requests by default, or one integration pull request/);
  assert.match(skill, /`Notes`/);
  assert.match(skill, /runs\//);
});

test("plan skill makes independent review its default final step", () => {
  const skill = readSkill("plan");

  assert.match(skill, /adw:review-plan/);
  assert.match(skill, /default final step/i);
  assert.match(skill, /fresh subagent/i);
  assert.match(skill, /Do not pass the planning conversation/);
  assert.match(skill, /ship-ready/);
  assert.match(skill, /revise-recommended/);
  assert.match(skill, /needs-rework/);
  assert.match(skill, /open decision/i);
  assert.doesNotMatch(skill, /\b(?:GPT|Sonnet|Opus|Haiku|o[34]-mini)\b/i, "skills must not name model products");
});

test("plan skill keeps tracker writes separately authorized and reads bounded", () => {
  const skill = readSkill("plan");

  assert.match(skill, /integrations\/contracts\.md/);
  assert.match(skill, /Tracker reads may inform planning/);
  assert.match(skill, /fresh exact authorization/);
  assert.match(skill, /never implied by running this skill/);
  assert.match(skill, /do not probe external systems/i);
  assert.doesNotMatch(skill, /Azure DevOps|\bADO\b|Datadog|Notion/i);
});

test("planning-lifecycle skills resolve bundled resources portably and use one artifact vocabulary", () => {
  for (const name of ["plan", "review-plan", "approve", "amend"]) {
    const skill = readSkill(name);

    assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${name}: missing Claude plugin-root resolution`);
    assert.match(skill, /absolute source location advertised for this loaded `SKILL\.md`/, `${name}: missing Codex resolution`);
    assert.match(skill, /<plugin-root>/, `${name}: missing shared plugin-root derivation`);
    assert.match(
      skill,
      /never resolve from the project directory or the current working directory/,
      `${name}: resources must not resolve from the project`,
    );
    assert.match(skill, /lib\/adw-helper\.mjs/, `${name}: missing bundled helper reference`);

    for (const forbidden of [
      /spec\.md/i,
      /plan\.yaml/i,
      /integrations\.yaml/i,
      /\bschemas?\b/i,
      /effective[ _-]polic/i,
      /payload profile/i,
      /work-item profile/i,
      /external-events/i,
      /digest-bundle/i,
      /validateArtifact/i,
      /load-artifact-file/i,
      /resolve-project-policy/i,
      /validation\.json/i,
    ]) {
      assert.doesNotMatch(skill, forbidden, `${name}: unsupported concept ${forbidden}`);
    }
  }
});
