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
  applyAtomicWrites,
  dispatch,
  EXIT,
  InputError,
  AtomicWriteError,
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

function runWith(overrides = {}, groupOverrides = {}) {
  return {
    version: 1,
    change_id: "safe-change",
    phase_id: "foundations",
    plan_digest: "a".repeat(64),
    base_branch: "main",
    base_commit: "b".repeat(40),
    started_at: "2026-08-13T12:00:00Z",
    completed_at: null,
    status: "running",
    groups: {
      contracts: {
        branch: "adw/safe-change/contracts",
        worktree: "worktrees/safe-change/contracts",
        tasks: ["IMPLEMENT the bounded task"],
        affected_paths: ["src/index.js"],
        tracker: null,
        pull_request: null,
        implementation_commit: null,
        review: { status: "pending", high_findings: [] },
        validation: { status: "pending", commands: [] },
        status: "prepared",
        ...groupOverrides,
      },
    },
    ...overrides,
  };
}

function projectWith(overrides = {}) {
  return {
    adw: 1,
    git: { base_branch: "main" },
    docs: { branch: "docs", worktree: "worktrees/docs" },
    execution: { mode: "sequential", isolation: "provider-sandbox" },
    components: { app: { path: ".", validate: ["npm test"] } },
    ...overrides,
  };
}

test("path resolver and atomic writes reject traversal, absolute, root, duplicate, and symlink destinations", async () => {
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
    await assert.rejects(applyAtomicWrites(root, [{ path, content: "escaped\n" }]), PathError);
  }
  await assert.rejects(applyAtomicWrites(root, [
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

test("handwritten run-record validation rejects malicious identifiers and path strings", async () => {
  for (const change_id of ["../escape", "/absolute", ".hidden", "bad/name", "bad;touch-pwned", "bad space", "bad\nline"]) {
    const result = await dispatch("validate-run-record", { record: runWith({ change_id }) });
    assert.equal(result.exitCode, EXIT.CONTRACT_INVALID, change_id);
    assert.ok(result.body.errors.some(({ path }) => path === "/change_id"), change_id);
  }
  for (const phase_id of ["../escape", "/absolute", "bad/name", "bad;touch", "bad space"]) {
    const result = await dispatch("validate-run-record", { record: runWith({ phase_id }) });
    assert.equal(result.exitCode, EXIT.CONTRACT_INVALID, phase_id);
    assert.ok(result.body.errors.some(({ path }) => path === "/phase_id"), phase_id);
  }
  for (const affectedPath of ["../escape.js", "src/../../escape.js", "/absolute.js", "C:\\windows\\escape.js"]) {
    const result = await dispatch("validate-run-record", { record: runWith({}, { affected_paths: [affectedPath] }) });
    assert.equal(result.exitCode, EXIT.CONTRACT_INVALID, affectedPath);
    assert.ok(result.body.errors.some(({ path }) => path === "/groups/contracts/affected_paths/0"), affectedPath);
  }
  for (const worktree of ["../outside", "/tmp/anywhere", "worktrees/../../escape"]) {
    const result = await dispatch("validate-run-record", { record: runWith({}, { worktree }) });
    assert.equal(result.exitCode, EXIT.CONTRACT_INVALID, worktree);
    assert.ok(result.body.errors.some(({ path }) => path === "/groups/contracts/worktree"), worktree);
  }
  for (const branch of ["-dashed", "has space", "ends.lock", "bad..range", "refs~1"]) {
    const result = await dispatch("validate-run-record", { record: runWith({}, { branch }) });
    assert.equal(result.exitCode, EXIT.CONTRACT_INVALID, branch);
    assert.ok(result.body.errors.some(({ path }) => path === "/groups/contracts/branch"), branch);
  }
});

test("handwritten project validation rejects malicious paths, branches, and credential-like settings", async () => {
  for (const [overrides, expected] of [
    [{ docs: { branch: "docs", worktree: "../outside" } }, "/docs/worktree"],
    [{ docs: { branch: "docs", worktree: "." } }, "/docs/worktree"],
    [{ git: { base_branch: "bad branch" } }, "/git/base_branch"],
    [{ components: { app: { path: "../escape" } } }, "/components/app/path"],
    [{ components: { app: { path: "/absolute" } } }, "/components/app/path"],
    [{ components: { "Bad Id": { path: "." } } }, "/components/Bad Id"],
    [{ providers: { code_host: { provider: "github", settings: { api_token: "leak" } } } }, "/providers/code_host/settings/api_token"],
  ]) {
    const result = await dispatch("validate-project", { data: projectWith(overrides) });
    assert.equal(result.exitCode, EXIT.CONTRACT_INVALID, JSON.stringify(overrides));
    assert.ok(result.body.errors.some(({ path }) => path === expected), `${JSON.stringify(overrides)} -> ${JSON.stringify(result.body.errors)}`);
  }
  assert.equal((await dispatch("validate-project", { data: projectWith() })).exitCode, EXIT.OK);
});

test("failed and interrupted-looking atomic writes leave prior bytes usable and rerunnable", async () => {
  const root = repository("adw-security-rollback-");
  mkdirSync(join(root, "config"));
  writeFileSync(join(root, "config/one"), "old-one\n");
  mkdirSync(join(root, "config/blocker"));
  mkdirSync(join(root, ".adw-atomic-write-interrupted"));
  writeFileSync(join(root, ".adw-atomic-write-interrupted/staged"), "untrusted stale transaction\n");

  await assert.rejects(applyAtomicWrites(root, [
    { path: "config/one", content: "new-one\n", expected_content: "old-one\n" },
    { path: "config/blocker", content: "cannot replace a directory\n" },
  ]), AtomicWriteError);
  assert.equal(readFileSync(join(root, "config/one"), "utf8"), "old-one\n");
  assert.equal(readFileSync(join(root, ".adw-atomic-write-interrupted/staged"), "utf8"), "untrusted stale transaction\n");

  rmSync(join(root, "config/blocker"), { recursive: true });
  await applyAtomicWrites(root, [
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
