import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skill = readFileSync(resolve(root, "plugin/skills/investigate/SKILL.md"), "utf8");
const agent = readFileSync(resolve(root, "plugin/skills/investigate/agents/openai.yaml"), "utf8");

function section(heading) {
  const start = skill.indexOf(`## ${heading}`);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const next = skill.indexOf("\n## ", start + 1);
  return skill.slice(start, next === -1 ? skill.length : next);
}

test("investigate has portable metadata and helper resolution", () => {
  const match = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match);
  assert.deepEqual(match[1].split("\n").map((line) => line.split(":", 1)[0]), ["name", "description"]);
  assert.match(match[1], /^name: investigate$/m);
  assert.match(agent, /display_name: "ADW Investigate"/);
  assert.match(agent, /default_prompt: "Use \$investigate /);
  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(skill, /absolute loaded source path ending in `\/skills\/investigate\/SKILL\.md`/);
  assert.match(skill, /<plugin-root>\/lib\/adw-helper\.mjs/);
  assert.match(skill, /never relative to the current working directory or the target project/);
});

test("investigate remains bounded, read-only, and evidence-first", () => {
  assert.match(skill, /Keep the entire workflow read-only/);
  assert.match(skill, /Require one stable alert, monitor, trace, or incident identifier or canonical URL/);
  assert.match(skill, /scope every query by service and environment/i);
  assert.match(skill, /keep the total window within two hours/i);
  assert.match(skill, /Never assume the local checkout is the deployed version/);
  assert.match(skill, /observed facts from inference/i);
  assert.match(skill, /Never copy raw log streams, full traces/);
  assert.match(skill, /Never acknowledge or resolve an incident/);
  assert.match(skill, /do not edit code, create branches, write ADW artifacts/);
});

test("investigate assigns both severity and confidence from a fixed vocabulary", () => {
  const assess = section("Assess severity and cause");
  for (const level of ["critical", "high", "medium", "low", "unknown"]) {
    assert.match(assess, new RegExp("- `" + level + "`"), `severity vocabulary omits ${level}`);
  }
  assert.match(assess, /Record confidence separately as `high`, `medium`, or `low`/);
});

test("investigate no longer depends on a JSON Schema artifact or helper validation", () => {
  assert.doesNotMatch(skill, /plugin\/schemas/);
  assert.doesNotMatch(skill, /schemas\//);
  assert.doesNotMatch(skill, /incident-report\.v1\.schema\.json/);
  assert.doesNotMatch(skill, /adw-helper\.mjs validate/);
  assert.doesNotMatch(skill, /"artifact":"incident-report"/);
  assert.match(skill, /This report has no JSON Schema and no `<plugin-root>\/lib\/adw-helper\.mjs` validation command/);
});

test("investigate reports Markdown by default in the required order", () => {
  const report = section("Report in Markdown by default");
  const order = [
    "severity and confidence",
    "what happened",
    "impact",
    "likely cause",
    "recommended response",
    "proposed fix route",
    "evidence links",
    "unknowns",
  ];
  let cursor = -1;
  for (const heading of order) {
    const index = report.indexOf(heading, cursor + 1);
    assert.ok(index > cursor, `report section out of order or missing: ${heading}`);
    cursor = index;
  }
  assert.match(report, /Do not save the report in the repository or the docs worktree/);
});

test("investigate states handwritten machine-output consistency rules", () => {
  const machine = section("Machine output on explicit request");
  assert.match(machine, /Only when the caller explicitly requests machine output, return exactly one JSON object with no Markdown wrapper/);
  assert.match(machine, /Check it yourself, before returning it, against these consistency rules/);

  const rules = machine.match(/^\d+\. \*\*[^*]+\*\*/gm) ?? [];
  assert.ok(rules.length >= 6, `expected an enumerated rule list, found ${rules.length}`);

  assert.match(machine, /Unique evidence ids[\s\S]*no id repeats/);
  assert.match(machine, /timeline\[\]\.evidence[\s\S]*hypotheses\[\]\.supporting_evidence[\s\S]*resolves to a declared `evidence\[\]\.id`/);
  assert.match(machine, /no dangling references/i);
  assert.match(machine, /`window\.from` and `window\.to`[\s\S]*`from` is less than or equal to `to`/);
  assert.match(machine, /`proposed_fix\.route` is `none` exactly when no code fix is indicated/);
  assert.match(machine, /`repository\.deployed_revision_verified` is `true` only when/);

  const example = machine.match(/```json\n([\s\S]*?)```/);
  assert.ok(example, "machine output section must show the exact JSON object shape");
  const parsed = JSON.parse(example[1]);
  for (const field of ["version", "alert", "window", "severity", "confidence", "summary", "impact", "repository", "evidence", "timeline", "hypotheses", "recommended_response", "proposed_fix", "unknowns"]) {
    assert.ok(Object.hasOwn(parsed, field), `machine output example omits ${field}`);
  }
  assert.equal(parsed.version, 1);
  assert.equal(parsed.proposed_fix.route, "none");
  assert.deepEqual(parsed.proposed_fix.anchors, [], "a `none` route must carry empty anchors");
  assert.equal(parsed.repository.deployed_revision_verified, false);
  const ids = new Set(parsed.evidence.map((item) => item.id));
  assert.equal(ids.size, parsed.evidence.length);
  for (const entry of parsed.timeline) for (const id of entry.evidence) assert.ok(ids.has(id), `example timeline cites undeclared evidence ${id}`);
  for (const hypothesis of parsed.hypotheses) {
    for (const id of [...hypothesis.supporting_evidence, ...hypothesis.contradicting_evidence]) {
      assert.ok(ids.has(id), `example hypothesis cites undeclared evidence ${id}`);
    }
  }
});

test("investigate routes fixes only to safe local workflows", () => {
  const propose = section("Propose safe action");
  assert.match(propose, /do not execute them/);
  assert.match(propose, /`none` when no code fix is indicated/);
  assert.match(propose, /`adw:quick` only for a narrow, low-risk local correction/);
  assert.match(propose, /`adw:plan` for public behavior, schemas, dependencies, security/);
  const routes = new Set([...skill.matchAll(/`(adw:[a-z-]+)`/g)].map((match) => match[1]));
  assert.deepEqual([...routes].sort(), ["adw:plan", "adw:quick"], "investigate may route only to quick or plan");
  assert.match(skill, /this skill never starts, supervises, or communicates with such a runner/i);
});
