import assert from "node:assert/strict";
import test from "node:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { codexArgv, createCodexAdapter } from "../../plugin/lib/execution-adapters/codex.mjs";

test("Codex adapter uses supported unattended argument surfaces", () => {
  const argv = codexArgv({ cwd: "/tmp/work", schemaPath: "/tmp/schema", resultPath: "/tmp/result" });
  assert.deepEqual(argv.slice(0, 6), ["exec", "-C", "/tmp/work", "-c", 'approval_policy="never"', "--json"]);
  assert.ok(!argv.join(" ").includes("dangerously"));
});

test("Codex adapter resolves a relative worktree once before launching the worker", async () => {
  const projectRoot = "/tmp/project";
  let launch;
  const adapter = createCodexAdapter({
    projectRoot,
    spawnRunner: async (command, args, input, cwd) => {
      launch = { command, args, input, cwd };
      const resultPath = args[args.indexOf("--output-last-message") + 1];
      await writeFile(resultPath, JSON.stringify({ status: "passed", findings: [] }));
      return 0;
    },
  });

  await adapter.runStage({
    stage: "implement",
    group: { group_id: "worker", worktree: "worktrees/worker", affected_paths: ["src"], tasks: "Implement it" },
  });

  const worktree = join(projectRoot, "worktrees/worker");
  assert.equal(launch.cwd, worktree);
  assert.deepEqual(launch.args.slice(0, 3), ["exec", "-C", worktree]);
});
