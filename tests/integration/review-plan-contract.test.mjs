import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const skillRoot = resolve(repositoryRoot, "plugin/skills/review-plan");
const skill = readFileSync(resolve(skillRoot, "SKILL.md"), "utf8");

const VERDICTS = ["ship-ready", "revise-recommended", "needs-rework"];

function parseFrontmatter(source) {
  assert.ok(source.startsWith("---\n"), "frontmatter must begin on the first line");
  const closing = source.indexOf("\n---\n", 4);
  assert.notEqual(closing, -1, "frontmatter must have a closing delimiter");
  const block = source.slice(4, closing);
  assert.doesNotMatch(block, /\t/, "frontmatter must not contain tabs");
  const metadata = {};
  for (const [index, line] of block.split("\n").entries()) {
    assert.notEqual(line.trim(), "", `frontmatter line ${index + 2} must not be blank`);
    const match = /^([a-z][a-z0-9_-]*):\s+(.+)$/.exec(line);
    assert.ok(match, `frontmatter line ${index + 2} must be a scalar key/value`);
    assert.ok(!Object.hasOwn(metadata, match[1]), `duplicate frontmatter key ${match[1]}`);
    metadata[match[1]] = match[2];
  }
  return metadata;
}

test("review-plan ships as a real skill with portable frontmatter and resource resolution", () => {
  assert.ok(existsSync(resolve(skillRoot, "SKILL.md")), "review-plan must ship a SKILL.md");

  const metadata = parseFrontmatter(skill);
  assert.deepEqual(Object.keys(metadata).sort(), ["description", "name"]);
  assert.equal(metadata.name, "review-plan");
  assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 1024);
  assert.doesNotMatch(metadata.description, /[<>]/, "description must not contain angle brackets");
  for (const verdict of VERDICTS) assert.ok(metadata.description.includes(verdict), `description omits ${verdict}`);

  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(skill, /absolute source location advertised for this loaded `SKILL\.md`/);
  assert.match(skill, /<plugin-root>/);
  assert.match(skill, /never resolve from the project directory or the current working directory/);
  assert.match(skill, /lib\/adw-helper\.mjs/);
  assert.match(skill, /integrations\/contracts\.md/);
  assert.doesNotMatch(skill, /Azure DevOps|\bADO\b|Datadog|Notion/i);
  assert.doesNotMatch(skill, /\b(?:GPT|Sonnet|Opus|Haiku)\b/i, "skills must not name model products");
  assert.doesNotMatch(skill, /(?:~\/|\/Users\/|\/home\/)[^\s`]*(?:\.claude|\.codex)/, "hard-coded provider install path");
});

test("review-plan advertises exactly three verdicts with a blocking one", () => {
  for (const verdict of VERDICTS) {
    assert.match(skill, new RegExp(`\`${verdict}\``), `skill omits the ${verdict} verdict`);
  }

  const verdictSection = skill.slice(skill.indexOf("## Verdict"), skill.indexOf("## Report"));
  assert.ok(verdictSection.length > 0, "the skill must define a verdict section");
  const defined = [...verdictSection.matchAll(/^- `([a-z-]+)`\s+.\s/gm)].map(([, value]) => value);
  assert.deepEqual(defined, VERDICTS, "the verdict section must define exactly the three verdicts, in order");
  assert.match(verdictSection, /Return exactly one verdict/);
  assert.match(verdictSection, /needs-rework`[^\n]*blocking/i);
  assert.match(skill, /Approval is blocked/i);
  assert.match(skill, /revise-recommended[\s\S]{0,400}presented clearly/i);
  assert.match(skill, /objective defects[\s\S]{0,200}judgment calls|judgment calls[\s\S]{0,200}objective/i);
});

test("review-plan performs a cold read and covers every required semantic check", () => {
  assert.match(skill, /You do not receive the conversation that produced the plan/);
  assert.match(skill, /Do not ask for them/);
  assert.match(skill, /fresh subagent|starts cold/i);
  assert.match(skill, /Agent task|collaboration agent/i);

  const checks = [
    ["problem fit", /Does the design solve the stated problem/i],
    ["load-bearing assumption", /load-bearing assumption/i],
    ["simpler alternatives", /simpler[\s\S]{0,80}alternative/i],
    ["anchor verification", /file -> symbol[\s\S]{0,200}against live code/i],
    ["phase dependency order", /dependency order/i],
    ["concurrency path overlap", /write-path overlap|overlap[\s\S]{0,80}concurrent/i],
    ["worker context completeness", /worker context/i],
    ["validation reality", /invented commands|observable manifest, task runner, CI workflow/i],
    ["criterion coverage", /acceptance criterion to at least one group/i],
  ];
  for (const [label, pattern] of checks) assert.match(skill, pattern, `missing check: ${label}`);

  assert.match(skill, /`resolved`, `moved`, or `missing`/);
  assert.match(skill, /max_parallel/);
  assert.match(skill, /Never report a check as passed when it was skipped/);
});

test("review-plan is read-only when invoked standalone", () => {
  assert.match(skill, /Never edit `plan\.md`/);
  assert.match(skill, /this skill is read-only/i);
  assert.match(skill, /never write `approval\.json`/i);
  assert.match(skill, /never implement anything/i);
  assert.match(skill, /is not approval and grants no authorization/i);
  assert.match(skill, /adw:plan` is responsible for applying findings/);

  // Read-only is also a filesystem property: this skill ships no executables.
  const shipped = readdirSync(skillRoot, { withFileTypes: true }).map((entry) => entry.name).sort();
  assert.deepEqual(shipped, ["SKILL.md", "agents"], "review-plan must ship only its contract and provider metadata");
  const openAi = readFileSync(resolve(skillRoot, "agents/openai.yaml"), "utf8");
  assert.doesNotMatch(openAi, /\t/);
  const lines = openAi.trimEnd().split("\n");
  assert.equal(lines.shift(), "interface:");
  const values = {};
  for (const line of lines) {
    const match = /^  ([a-z][a-z0-9_]*): "([^"\n]+)"$/.exec(line);
    assert.ok(match, `invalid agents/openai.yaml line: ${line}`);
    values[match[1]] = match[2];
  }
  assert.deepEqual(Object.keys(values).sort(), ["default_prompt", "display_name", "short_description"]);
  assert.ok(values.display_name.length <= 64);
  assert.ok(values.short_description.length <= 80);
  assert.match(values.default_prompt, /\$review-plan(?:\b|\s)/);
});

// ---------------------------------------------------------------------------
// The two objective checks the reviewer must perform are mechanical enough to
// execute here against a real fixture, proving the plan format the skill
// mandates actually supports them.
// ---------------------------------------------------------------------------

function glanceRows(plan) {
  return plan
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim().replaceAll("`", "")));
}

function overlappingParallelGroups(plan) {
  const byPhase = new Map();
  for (const [phase, group, , paths] of glanceRows(plan)) {
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase).push({ group, paths: paths.split(/\s*,\s*/) });
  }
  const conflicts = [];
  for (const [phase, groups] of byPhase) {
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        for (const left of groups[i].paths) {
          for (const right of groups[j].paths) {
            if (left.startsWith(right) || right.startsWith(left)) {
              conflicts.push({ phase, groups: [groups[i].group, groups[j].group], path: left });
            }
          }
        }
      }
    }
  }
  return conflicts;
}

function resolveAnchors(plan, projectRoot) {
  const results = [];
  for (const [, file, symbol] of plan.matchAll(/`([\w./-]+\.[a-z]+) -> ([^`]+)`/g)) {
    const target = resolve(projectRoot, file);
    if (!existsSync(target)) {
      results.push({ file, symbol, status: "missing" });
      continue;
    }
    const contents = readFileSync(target, "utf8");
    results.push({ file, symbol, status: contents.includes(symbol) ? "resolved" : "missing" });
  }
  return results;
}

test("the mandated plan format supports mechanical anchor and overlap checking", () => {
  const root = mkdtempSync(resolve(tmpdir(), "adw-review-plan-"));
  try {
    mkdirSync(resolve(root, "src/api/contracts"), { recursive: true });
    mkdirSync(resolve(root, "apps/web/src/client"), { recursive: true });
    writeFileSync(resolve(root, "src/api/contracts/limits.mjs"), "export function resolveLimit() {\n  return 10;\n}\n");
    writeFileSync(resolve(root, "apps/web/src/client/request.mjs"), "export function sendRequest() {}\n");

    const safePlan = [
      "| Phase | Group | Component | Primary paths | Depends on | Tracker | Delivery |",
      "|---|---|---|---|---|---|---|",
      "| 1 | `contracts` | `api` | `src/api/contracts/` | — | child | group PR |",
      "| 1 | `web-client` | `web` | `apps/web/src/client/` | — | child | group PR |",
      "",
      "- `src/api/contracts/limits.mjs -> resolveLimit` — limit resolution.",
      "- `apps/web/src/client/request.mjs -> sendRequest` — retry seam.",
      "- `src/api/contracts/limits.mjs -> removedHelper` — stale anchor.",
      "",
    ].join("\n");

    assert.deepEqual(overlappingParallelGroups(safePlan), [], "disjoint concurrent groups must produce no conflict");

    const anchors = resolveAnchors(safePlan, root);
    assert.equal(anchors.length, 3);
    assert.deepEqual(
      anchors.map(({ status }) => status),
      ["resolved", "resolved", "missing"],
      "a stale anchor is an objective defect the format makes detectable",
    );

    const unsafePlan = safePlan.replace(
      "| 1 | `web-client` | `web` | `apps/web/src/client/` | — | child | group PR |",
      "| 1 | `web-client` | `web` | `src/api/contracts/limits.mjs` | — | child | group PR |",
    );
    const conflicts = overlappingParallelGroups(unsafePlan);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0].groups, ["contracts", "web-client"]);
    assert.equal(conflicts[0].phase, "1");

    // Dependency ordering: a phase may only depend on strictly earlier phases.
    const rows = glanceRows(unsafePlan.replace(
      "| 1 | `contracts` | `api` | `src/api/contracts/` | — | child | group PR |",
      "| 1 | `contracts` | `api` | `src/api/contracts/` | Phase 2 | child | group PR |",
    ));
    const backwardDependency = rows.some(([phase, , , , dependsOn]) => {
      const match = /Phase (\d+)/.exec(dependsOn);
      return match ? Number(match[1]) >= Number(phase) : false;
    });
    assert.equal(backwardDependency, true, "a dependency on a later phase must be detectable from the glance table");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the bundled template is itself clean under the reviewer's objective checks", () => {
  const template = readFileSync(resolve(repositoryRoot, "plugin/templates/plan.md"), "utf8");
  assert.deepEqual(overlappingParallelGroups(template), []);
  const rows = glanceRows(template);
  assert.ok(rows.length >= 3);
  for (const [phase, , , , dependsOn] of rows) {
    const match = /Phase (\d+)/.exec(dependsOn);
    if (match) assert.ok(Number(match[1]) < Number(phase), "template dependencies must point at strictly earlier phases");
  }
});
