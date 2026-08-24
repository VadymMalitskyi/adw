import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { concurrentPipeline, runShippedClaudeWorkflow } from "../fixtures/execution/claude-workflow-harness.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const workflowPath = resolve(testDirectory, "../../plugin/workflows/execute-phase.mjs");

test("the shipped Claude workflow runs offline against its exact source", async () => {
  assert.equal(existsSync(workflowPath), true);
  const result = await runShippedClaudeWorkflow({
    sourcePath: workflowPath,
    args: { packet: { groups: [{
      group_id: "workflow",
      worktree: "/project/worktree",
      affected_paths: ["plugin"],
      tasks: "Implement the change.",
    }] } },
    pipeline: concurrentPipeline,
    agent: async () => ({ schema_version: 1, status: "passed", findings: [] }),
  });
  assert.deepEqual(result, {
    schema_version: 1,
    provider: "claude",
    groups: [{
      group_id: "workflow",
      status: "passed",
      fix_cycles: 0,
      findings: [],
    }],
  });
  assert.match(readFileSync(workflowPath, "utf8"), /acceptEdits|no-commit/i);
});
