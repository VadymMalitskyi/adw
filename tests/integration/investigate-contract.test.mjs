import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const skill = readFileSync(resolve(root, "plugin/skills/investigate/SKILL.md"), "utf8");
const agent = readFileSync(resolve(root, "plugin/skills/investigate/agents/openai.yaml"), "utf8");

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

test("investigate validates structured output and routes fixes safely", () => {
  assert.match(skill, /incident-report\.v1\.schema\.json/);
  assert.match(skill, /\{"artifact":"incident-report","data":<report>\}/);
  assert.match(skill, /adw:quick/);
  assert.match(skill, /adw:plan/);
  assert.match(skill, /machine output[\s\S]*exactly the validated incident-report JSON/i);
  assert.match(skill, /this skill never starts, supervises, or communicates with such a runner/i);
});
