import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { EXECUTION_SCHEMA_VERSION, validateExecutionEnvelope, validateExecutionPacket } from "../../plugin/lib/execution-contract.mjs";
import { captureExecutionBaselines, porcelainPaths } from "../../plugin/lib/execution-git.mjs";

test("porcelain v2 parser retains ordinary, untracked, and rename paths", () => {
  const rows = "1 .M N... 100644 100644 100644 a b file.txt\0? odd name\0" + "2 R. N... 100644 100644 100644 100644 a b R100 renamed.txt\0old.txt\0";
  assert.deepEqual(porcelainPaths(Buffer.from(rows)), ["file.txt", "odd name", "renamed.txt", "old.txt"]);
});

test("baselines captured for a clean worktree satisfy the execution envelope contract", () => {
  const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const root = mkdtempSync(join(tmpdir(), "adw-execution-git-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  git(root, "worktree", "add", "-b", "adw/dew/execution-core", "worktrees/dew/execution-core", "main");

  const packet = validateExecutionPacket({
    schema_version: EXECUTION_SCHEMA_VERSION,
    phase_id: "phase-1",
    groups: [{
      group_id: "execution-core", tasks: "Make the change", affected_paths: ["plugin/lib/example.mjs"],
      branch: "adw/dew/execution-core", worktree: "worktrees/dew/execution-core", validation: [], review_level: "full",
    }],
  });
  const baselines = captureExecutionBaselines(root, packet);
  const envelope = validateExecutionEnvelope({ schema_version: EXECUTION_SCHEMA_VERSION, packet, ...baselines });
  assert.deepEqual(envelope.targets[0], { group_id: "execution-core", head: baselines.targets[0].head, status: "" });
});
