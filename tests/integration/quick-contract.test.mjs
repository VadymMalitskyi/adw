import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const quick = readFileSync(resolve(root, "plugin/skills/quick/SKILL.md"), "utf8");
const quickAgent = readFileSync(resolve(root, "plugin/skills/quick/agents/openai.yaml"), "utf8");

test("quick has valid minimal skill metadata and portable helper resolution", () => {
  const match = quick.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match);
  assert.deepEqual(match[1].split("\n").map((line) => line.split(":", 1)[0]), ["name", "description"]);
  assert.match(match[1], /^name: quick$/m);
  assert.match(quickAgent, /display_name: "ADW Quick"/);
  assert.match(quickAgent, /default_prompt: "Use \$quick /);
  assert.match(quick, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(quick, /absolute loaded path ending in `\/skills\/quick\/SKILL\.md`/);
  assert.match(quick, /<plugin-root>\/lib\/adw-helper\.mjs/);
});

test("quick escalates every high-risk and growing-scope category", () => {
  for (const category of [
    /public API or persisted schema change/,
    /migration or data backfill/,
    /adding, removing, or upgrading a dependency/,
    /authentication, authorization, secrets, privacy, or other security behavior/,
    /infrastructure, deployment, release, CI\/CD, or operational topology/,
    /more than one component or repository/,
    /scope that grows beyond the compact contract/,
  ]) assert.match(quick, category);
  assert.match(quick, /Escalate to `adw:plan` immediately/);
  assert.match(quick, /Do not start the larger work, split it into disguised quick changes, or silently expand/);
});

test("quick retains execution safety, evidence, docs, and delivery gates", () => {
  assert.match(quick, /exactly one `adw\/<quick-change-id>` branch/);
  assert.match(quick, /Add or update focused tests/);
  assert.match(quick, /Review the whole diff against the exact base/);
  assert.match(quick, /code-coupled documentation on the same branch/);
  assert.match(quick, /helper's `run-validation` command/);
  assert.match(quick, /Capture helper output even when it exits with `VALIDATION_FAILED`/);
  assert.match(quick, /required failure, signal, timeout, or deferral remains `failed`/);
  assert.match(quick, /only after passed evidence/);
  assert.match(quick, /authorization for the exact push and pull-request payload/);
  assert.match(quick, /explicit (?:user )?(?:authorization|delivery request)/);
  assert.match(quick, /configured `code_host`/);
  assert.match(quick, /never mark ready, approve, merge, release, deploy, or force-push/i);
});
