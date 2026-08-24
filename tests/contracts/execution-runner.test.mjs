import assert from "node:assert/strict";
import test from "node:test";
import { runExecutionGroups } from "../../plugin/lib/execution-runner.mjs";

test("runner isolates a failed group and settles independent work", async () => {
  const groups = ["one", "two"].map((group_id) => ({ group_id, tasks: "x", worktree: ".", affected_paths: ["src"], branch: group_id, validation: [], review_level: "full" }));
  const adapter = { runStage: async ({ group, stage }) => group.group_id === "one" && stage === "implement" ? { status: "failed", findings: [] } : { status: "passed", findings: [] } };
  const git = { assertTarget: async () => {}, snapshot: async () => "", assertUnchanged: async () => {} };
  const result = await runExecutionGroups({ packet: { groups } }, { adapter, git });
  assert.deepEqual(result.groups.map(({ status }) => status), ["failed", "passed"]);
});
