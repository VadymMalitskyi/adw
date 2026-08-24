import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { concurrentPipeline, runClaudeWorkflow } from "../fixtures/execution/claude-workflow-harness.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(testDirectory, "../../plugin/workflows/execute-phase.mjs");
const source = readFileSync(sourcePath, "utf8");

function envelope(groups) {
  return { packet: { groups: groups.map((group, index) => ({
    group_id: group.group_id || `group-${index + 1}`,
    worktree: `/project/worktrees/${group.group_id || index + 1}`,
    affected_paths: ["plugin/lib"],
    tasks: "Make the requested change.",
  })) } };
}

function result(status = "passed", findings = []) {
  return { schema_version: 1, status, findings };
}

test("Claude workflow ships literal metadata and only Dynamic Workflow runtime surfaces", () => {
  assert.match(source, /^export const meta = \{[\s\S]*?name: "execute-phase"[\s\S]*?phases:/m);
  assert.match(source, /\bargs\b/);
  assert.match(source, /\bagent\(/);
  assert.match(source, /\bpipeline\(/);
  assert.doesNotMatch(source, /^\s*import\b/m);
  assert.doesNotMatch(source, /\b(?:require|process|fetch|XMLHttpRequest|Deno|Bun)\b/);
  assert.doesNotMatch(source, /\b(?:readFile|writeFile|exec|spawn|child_process)\b/);
  assert.doesNotMatch(source, /claude\s+-p|Math\.random|Date\.now|new Date/);
});

test("Claude workflow keeps each group ordered while independent groups run concurrently", async () => {
  const calls = [];
  let active = 0;
  let maximumActive = 0;
  const output = await runClaudeWorkflow({
    source,
    args: envelope([{ group_id: "one" }, { group_id: "two" }]),
    pipeline: concurrentPipeline,
    agent: async (prompt, { label }) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(label);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 5));
      active -= 1;
      return result();
    },
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(calls.filter((label) => label.startsWith("one:")), ["one:implementation", "one:review"]);
  assert.deepEqual(calls.filter((label) => label.startsWith("two:")), ["two:implementation", "two:review"]);
  assert.deepEqual(output, {
    schema_version: 1,
    provider: "claude",
    groups: [
      { group_id: "one", status: "passed", fix_cycles: 0, findings: [] },
      { group_id: "two", status: "passed", fix_cycles: 0, findings: [] },
    ],
  });
});

test("Claude workflow uses a fresh reviewer after each fix and fails after two fix cycles", async () => {
  const calls = [];
  const output = await runClaudeWorkflow({
    source,
    args: envelope([{ group_id: "loop" }]),
    pipeline: concurrentPipeline,
    agent: async (_prompt, { label }) => {
      calls.push(label);
      if (label.endsWith(":review")) return result("findings", [{ severity: "high", code: "defect" }]);
      return result();
    },
  });
  assert.deepEqual(calls, ["loop:implementation", "loop:review", "loop:fix", "loop:review", "loop:fix", "loop:review"]);
  assert.equal(output.groups[0].status, "failed");
  assert.equal(output.groups[0].fix_cycles, 2);
  assert.deepEqual(output.groups[0].findings, [{ severity: "high", code: "defect" }]);
});

test("Claude workflow treats null, malformed, and stopped-stage outputs as isolated failures", async () => {
  const calls = [];
  const output = await runClaudeWorkflow({
    source,
    args: envelope([{ group_id: "null" }, { group_id: "bad" }, { group_id: "good" }]),
    pipeline: concurrentPipeline,
    agent: async (_prompt, { label }) => {
      calls.push(label);
      if (label === "null:implementation") return null;
      if (label === "bad:implementation") return { schema_version: 2, status: "passed", findings: [] };
      return result();
    },
  });
  assert.deepEqual(output.groups.map(({ group_id, status }) => ({ group_id, status })), [
    { group_id: "null", status: "failed" },
    { group_id: "bad", status: "failed" },
    { group_id: "good", status: "passed" },
  ]);
  assert.ok(calls.includes("good:review"), "a failed sibling must not cancel an independent group");
});

test("Claude workflow returns only bounded versioned safe fields", async () => {
  const output = await runClaudeWorkflow({
    source,
    args: envelope([{ group_id: "safe" }]),
    pipeline: concurrentPipeline,
    agent: async () => result("findings", [{ severity: "medium", code: "safe_code" }]),
  });
  assert.equal(JSON.stringify(output).includes("Authoritative task instructions"), false);
  assert.equal(output.schema_version, 1);
  assert.equal(output.provider, "claude");
  assert.deepEqual(Object.keys(output.groups[0]).sort(), ["findings", "fix_cycles", "group_id", "status"]);
  assert.deepEqual(output.groups[0].findings, [{ severity: "medium", code: "safe_code" }]);
});
