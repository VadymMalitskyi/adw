import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { EXECUTION_SCHEMA_VERSION, validateExecutionEnvelope, validateExecutionPacket } from "../../plugin/lib/execution-contract.mjs";
import { executionAssertTarget } from "../../plugin/lib/execution-finalizer.mjs";
import { captureExecutionBaselines, porcelainPaths } from "../../plugin/lib/execution-git.mjs";

const git = (root, ...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function fixture() {
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
  return { root, packet, baselines, envelope };
}

function writeInWorktree(root, relativePath, contents) {
  const path = join(root, "worktrees/dew/execution-core", relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

test("porcelain v2 parser retains ordinary, untracked, and rename paths", () => {
  const rows = "1 .M N... 100644 100644 100644 a b file.txt\0? odd name\0" + "2 R. N... 100644 100644 100644 100644 a b R100 renamed.txt\0old.txt\0";
  assert.deepEqual(porcelainPaths(Buffer.from(rows)), ["file.txt", "odd name", "renamed.txt", "old.txt"]);
});

test("baselines captured for a clean worktree satisfy the execution envelope contract", () => {
  const { baselines, envelope } = fixture();
  assert.deepEqual(envelope.targets[0], { group_id: "execution-core", head: baselines.targets[0].head, status: "", content: baselines.targets[0].content });
});

// The between-stage gate is the only thing standing between a coordinator-driven
// stage loop and an agent that wandered, so it has to catch each way out.
test("the between-stage gate accepts in-scope work and refuses every escape", () => {
  const { root, envelope } = fixture();

  writeInWorktree(root, "plugin/lib/example.mjs", "export const answer = 1;\n");
  const afterImplement = executionAssertTarget(root, { execution_envelope: envelope, group_id: "execution-core" });
  assert.equal(afterImplement.group_id, "execution-core");
  assert.match(afterImplement.snapshot, /^[0-9a-f]{64}$/);

  // A review that edited anything is caught by replaying its own baseline.
  assert.deepEqual(
    executionAssertTarget(root, { execution_envelope: envelope, group_id: "execution-core", since: afterImplement.snapshot }),
    afterImplement,
  );
  writeInWorktree(root, "plugin/lib/example.mjs", "export const answer = 2;\n");
  assert.throws(
    () => executionAssertTarget(root, { execution_envelope: envelope, group_id: "execution-core", since: afterImplement.snapshot }),
    /read-only stage/,
  );

  writeInWorktree(root, "plugin/lib/escaped.mjs", "export const escaped = true;\n");
  assert.throws(() => executionAssertTarget(root, { execution_envelope: envelope, group_id: "execution-core" }), /escape affected_paths/);

  assert.throws(() => executionAssertTarget(root, { execution_envelope: envelope, group_id: "no-such-group" }), /unknown group/);
  assert.throws(() => executionAssertTarget(root, { execution_envelope: { nope: true }, group_id: "execution-core" }), /malformed envelope|unknown field/);
});

test("the between-stage gate refuses a group whose worker committed", () => {
  const { root, envelope } = fixture();
  const worktree = join(root, "worktrees/dew/execution-core");
  writeInWorktree(root, "plugin/lib/example.mjs", "export const answer = 1;\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", "worker committed");
  assert.throws(() => executionAssertTarget(root, { execution_envelope: envelope, group_id: "execution-core" }), /HEAD changed/);
});
