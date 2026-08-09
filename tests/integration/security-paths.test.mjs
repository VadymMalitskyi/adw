import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  applyAtomicMigration,
  dispatch,
  EXIT,
  InputError,
  MigrationError,
  PathError,
  resolveProjectPath,
} from "../../plugin/lib/adw-helper.mjs";

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function repository(prefix = "adw-security-path-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Security Test");
  git(root, "config", "user.email", "security@example.invalid");
  return root;
}

function planWith(overrides = {}) {
  return {
    schema: 2,
    change_id: "safe-change",
    summary: "Exercise the boundary",
    effective_policy: { components: ["app"], unowned_paths: [], project_policy_digest: "a".repeat(64), required_validation: [] },
    tasks: [{
      id: 1,
      title: "Bounded task",
      description: "Touch one project file",
      affected_paths: ["src/index.js"],
      validation: [{ command: "npm test", cwd: ".", timeout_ms: 1000, required: true, source: "package.json#scripts.test" }],
    }],
    documentation: { impact: "none", files: [] },
    ...overrides,
  };
}

test("path resolver and migration reject traversal, absolute, root, duplicate, and symlink destinations", async () => {
  const root = repository();
  const outside = mkdtempSync(join(tmpdir(), "adw-security-outside-"));
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested/file.txt"), "original\n");
  symlinkSync(outside, join(root, "linked-directory"));
  symlinkSync(join(outside, "linked-file.txt"), join(root, "linked-file"));

  for (const path of ["", ".", "..", "../escape", "nested/../..", resolve(outside, "absolute.txt"), "bad\0path"]) {
    await assert.rejects(resolveProjectPath(root, path), PathError, path || "empty path");
  }
  for (const path of ["linked-directory/write.txt", "linked-file"]) {
    await assert.rejects(applyAtomicMigration(root, [{ path, content: "escaped\n" }]), PathError);
  }
  await assert.rejects(applyAtomicMigration(root, [
    { path: "nested/file.txt", content: "first\n" },
    { path: "nested/./file.txt", content: "second\n" },
  ]), InputError);
  assert.equal(readFileSync(join(root, "nested/file.txt"), "utf8"), "original\n");
  assert.deepEqual(readdirSync(outside), []);
});

test("run-validation rejects hostile cwd values before launching an explicit command", async () => {
  const root = repository();
  const outside = mkdtempSync(join(tmpdir(), "adw-security-command-outside-"));
  const marker = join(outside, "command-ran");
  const command = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(`require('fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`)}`;
  symlinkSync(outside, join(root, "linked"));
  const base = {
    project_root: root,
    change_id: "safe-change",
    plugin_version: "0.1.0",
    code_commit: "a".repeat(40),
    docs_commit: "b".repeat(40),
    recorded_at: "2026-08-05T12:00:00Z",
  };
  for (const cwd of ["../outside", resolve(outside), "linked"]) {
    await assert.rejects(dispatch("run-validation", {
      ...base,
      commands: [{ command, cwd, timeout_ms: 1000, required: true }],
    }), PathError);
    assert.equal(existsSync(marker), false, `command launched for rejected cwd ${cwd}`);
  }
});

test("artifact schemas reject malicious change IDs and path strings", async () => {
  for (const change_id of ["../escape", "/absolute", ".hidden", "bad/name", "bad;touch-pwned", "bad space", "bad\nline"]) {
    const result = await dispatch("validate", { artifact: "plan", data: planWith({ change_id }) });
    assert.equal(result.exitCode, EXIT.SCHEMA_INVALID, change_id);
    assert.ok(result.body.errors.some(({ path }) => path === "/change_id"), change_id);
  }
  for (const affectedPath of ["../escape.js", "src/../../escape.js", "/absolute.js"]) {
    const data = planWith();
    data.tasks[0].affected_paths = [affectedPath];
    const result = await dispatch("validate", { artifact: "plan", data });
    assert.equal(result.exitCode, EXIT.SCHEMA_INVALID, affectedPath);
    assert.ok(result.body.errors.some(({ path }) => path === "/tasks/0/affected_paths/0"), affectedPath);
  }
});

test("failed and interrupted-looking migrations leave prior bytes usable and rerunnable", async () => {
  const root = repository("adw-security-rollback-");
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config/one"), "old-one\n");
  mkdirSync(join(root, "config/blocker"));
  mkdirSync(join(root, ".adw-migration-interrupted"));
  writeFileSync(join(root, ".adw-migration-interrupted/staged"), "untrusted stale transaction\n");

  await assert.rejects(applyAtomicMigration(root, [
    { path: "config/one", content: "new-one\n", expected_content: "old-one\n" },
    { path: "config/blocker", content: "cannot replace a directory\n" },
  ]), MigrationError);
  assert.equal(readFileSync(join(root, "config/one"), "utf8"), "old-one\n");
  assert.equal(readFileSync(join(root, ".adw-migration-interrupted/staged"), "utf8"), "untrusted stale transaction\n");

  rmSync(join(root, "config/blocker"), { recursive: true });
  await applyAtomicMigration(root, [
    { path: "config/one", content: "new-one\n", expected_content: "old-one\n" },
    { path: "config/two", content: "new-two\n", expected_content: null },
  ]);
  assert.equal(readFileSync(join(root, "config/one"), "utf8"), "new-one\n");
  assert.equal(readFileSync(join(root, "config/two"), "utf8"), "new-two\n");
});

test("record-validation preserves shell metacharacters as inert evidence data", async () => {
  const root = repository("adw-security-command-data-");
  const marker = join(root, "must-not-exist");
  const command = `printf safe; touch ${marker}; $(printf injected)`;
  const result = await dispatch("record-validation", {
    change_id: "shell-data",
    plugin_version: "0.1.0",
    code_commit: "a".repeat(40),
    docs_commit: "b".repeat(40),
    recorded_at: "2026-08-05T12:00:00Z",
    commands: [{ command, cwd: ".", exit_code: 0, duration_ms: 1, summary: "not executed", required: true }],
  });
  assert.equal(result.exitCode, EXIT.OK);
  assert.equal(result.body.evidence.commands[0].command, command);
  assert.equal(existsSync(marker), false);
});
