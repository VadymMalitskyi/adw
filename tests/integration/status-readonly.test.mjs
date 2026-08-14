import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helperPath = join(repositoryRoot, "plugin/lib/adw-helper.mjs");
const orchestratorPath = join(repositoryRoot, "plugin/execution/orchestrator.mjs");
const statusScript = join(repositoryRoot, "plugin/skills/status/scripts/snapshot.mjs");

const PLAN = `# PART 1 — Feature Overview

## Summary

Throttle noisy tenants.

# PART 2 — Implementation Plan

## Phase 1 — foundations

### Group: api
`;

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runNode(script, argv, input) {
  const result = spawnSync(process.execPath, [script, ...argv], { input: JSON.stringify(input), encoding: "utf8" });
  return { status: result.status, body: JSON.parse(result.stdout) };
}

const helper = (command, input) => runNode(helperPath, [command], input);

function status(root, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [statusScript, "--project-root", root], {
    encoding: "utf8",
    env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" },
  });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

// A hand-built initialized project: `adw: 1` config on the code branch and an
// orphan docs branch attached at the configured worktree.
function fixture(label) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `adw-status-${label}-`)));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src/api"), { recursive: true });
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "src/api/index.js"), "export const api = 1;\n");
  writeFileSync(join(root, "apps/web/index.js"), "export const web = 1;\n");
  writeFileSync(join(root, ".gitignore"), "/worktrees/\n/.adw/\n");
  writeFileSync(join(root, "adw.yaml"), [
    "adw: 1",
    "",
    "git:",
    "  base_branch: main",
    "",
    "docs:",
    "  branch: docs",
    "  worktree: worktrees/docs",
    "",
    "execution:",
    "  mode: orchestrated",
    "  max_parallel: 3",
    "  isolation: managed-devcontainer",
    "",
    "components:",
    "  api:",
    "    path: src/api",
    "    validate:",
    "      - node --version",
    "  web:",
    "    path: apps/web",
    "    validate:",
    "      - node --version",
    "",
  ].join("\n"));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");

  const docs = join(root, "worktrees/docs");
  git(root, "worktree", "add", "-q", "--detach", docs, "HEAD");
  git(docs, "checkout", "-q", "--orphan", "docs");
  git(docs, "rm", "-rqf", ".");
  writeFileSync(join(docs, "architecture.md"), "# Architecture\n");
  git(docs, "add", ".");
  git(docs, "commit", "-q", "-m", "Initialize docs");
  return { root, docs };
}

function planned({ root, docs }, changeId = "tenant-throttling", planBytes = PLAN) {
  const change = join(docs, "changes", changeId);
  mkdirSync(change, { recursive: true });
  writeFileSync(join(change, "plan.md"), planBytes);
  git(docs, "add", ".");
  git(docs, "commit", "-q", "-m", `Plan ${changeId}`);
  const planCommit = git(docs, "rev-parse", "HEAD");
  const planDigest = helper("digest", { content: planBytes }).body.digest;
  const approval = helper("create-approval", {
    change_id: changeId,
    plan_path: `changes/${changeId}/plan.md`,
    plan_digest: planDigest,
    plan_commit: planCommit,
    approved_by: "Ada Lovelace",
    approved_at: "2026-08-13T12:00:00Z",
  });
  assert.equal(approval.status, 0, JSON.stringify(approval.body));
  writeFileSync(join(change, "approval.json"), `${JSON.stringify(approval.body.approval, null, 2)}\n`);
  git(docs, "add", ".");
  git(docs, "commit", "-q", "-m", `Approve ${changeId}`);
  return { change, changeId, planCommit, planDigest };
}

function fingerprint(root) {
  const hash = createHash("sha256");
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git") continue;
      const path = join(directory, name);
      const stat = lstatSync(path);
      hash.update(`${stat.isDirectory() ? "d" : stat.isSymbolicLink() ? "l" : "f"}:${relative(root, path)}\0`);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  }
  visit(root);
  return hash.digest("hex");
}

test("status reconstructs plan, approval, and run-record state from durable artifacts without writing", () => {
  const project = fixture("full");
  const { root, docs } = project;
  const { change, changeId, planCommit, planDigest } = planned(project);

  const groups = [
    { group_id: "api", tasks: ["IMPLEMENT the throttle contract"], affected_paths: ["src/api"], validation: ["node --version"] },
    { group_id: "web", tasks: ["IMPLEMENT the throttle banner"], affected_paths: ["apps/web"], validation: ["node --version"] },
  ];
  const baseCommit = git(root, "rev-parse", "main");
  const prepared = runNode(orchestratorPath, ["prepare"], {
    project_root: root,
    change_id: changeId,
    phase_id: "foundations",
    plan_digest: planDigest,
    base_branch: "main",
    base_commit: baseCommit,
    groups,
  });
  assert.equal(prepared.status, 0, JSON.stringify(prepared.body));

  let record = helper("create-run-record", {
    change_id: changeId,
    phase_id: "foundations",
    plan_digest: planDigest,
    base_branch: "main",
    base_commit: baseCommit,
    started_at: "2026-08-13T12:01:00Z",
    groups: groups.map(({ group_id, tasks, affected_paths }) => ({ group_id, tasks, affected_paths })),
  }).body.record;
  for (const step of ["implementing", "reviewing", "validating"]) {
    record = helper("update-run-record", { record, update: { groups: { api: { status: step }, web: { status: step } } } }).body.record;
  }
  const evidence = helper("run-validation", {
    project_root: join(root, "worktrees", changeId, "api"),
    recorded_at: "2026-08-13T12:04:00Z",
    commands: [{ command: "node --version", cwd: ".", timeout_ms: 20000, required: true }],
  });
  assert.equal(evidence.status, 0, JSON.stringify(evidence.body));
  record = helper("update-run-record", {
    record,
    update: {
      groups: {
        api: {
          review: { status: "passed", high_findings: [] },
          validation: { status: "passed", commands: evidence.body.evidence.commands, deferred: [], recorded_at: evidence.body.evidence.recorded_at },
          implementation_commit: git(join(root, "worktrees", changeId, "api"), "rev-parse", "HEAD"),
          status: "passed",
        },
      },
    },
  }).body.record;
  mkdirSync(join(change, "runs"), { recursive: true });
  writeFileSync(join(change, "runs/foundations.json"), `${JSON.stringify(record, null, 2)}\n`);
  git(docs, "add", ".");
  git(docs, "commit", "-q", "-m", "Record foundations run");

  const before = fingerprint(root);
  const codeDirtyBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");
  const docsDirtyBefore = git(docs, "status", "--porcelain=v1", "--untracked-files=all");

  const snapshot = status(root);
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.read_only, true);
  assert.equal(snapshot.config.valid, true);
  assert.equal(snapshot.code.base_branch, "main");
  assert.equal(snapshot.docs.attached, true);
  assert.equal(snapshot.docs.branch, "docs");
  assert.equal(snapshot.execution.mode, "orchestrated");
  assert.equal(snapshot.execution.max_parallel, 3);
  assert.equal(snapshot.execution.isolation, "managed-devcontainer");
  assert.equal(snapshot.execution.permissions.profile, "managed-development");
  assert.equal(snapshot.execution.active, true);

  assert.equal(snapshot.changes.length, 1);
  const [entry] = snapshot.changes;
  assert.equal(entry.change_id, changeId);
  assert.equal(entry.plan.present, true);
  assert.equal(entry.plan.digest, planDigest);
  assert.equal(entry.approval.state, "active");
  assert.equal(entry.approval.plan_commit, planCommit);
  assert.equal(entry.approval.approved_by, "Ada Lovelace");
  assert.equal(entry.runs.length, 1);

  const [run] = entry.runs;
  assert.equal(run.valid, true);
  assert.equal(run.phase_id, "foundations");
  assert.equal(run.status, "running");
  assert.equal(run.plan_digest_matches, true);
  const api = run.groups.find(({ group_id }) => group_id === "api");
  const web = run.groups.find(({ group_id }) => group_id === "web");
  assert.equal(api.status, "passed");
  assert.equal(api.branch, `adw/${changeId}/api`);
  assert.equal(api.branch_exists, true);
  assert.equal(api.worktree, `worktrees/${changeId}/api`);
  assert.equal(api.worktree_attached, true);
  assert.equal(api.validation.status, "passed");
  assert.equal(api.validation.commands[0].exit_code, 0);
  assert.equal(api.review.status, "passed");
  assert.equal(api.pull_request, null);
  assert.equal(web.status, "validating");
  assert.equal(entry.state, "executing");
  assert.equal(entry.next_skill, "adw:execute");
  assert.deepEqual(entry.blocked, []);
  assert.equal(snapshot.pull_requests.state, "not-queried");

  assert.equal(fingerprint(root), before, "status must not modify the working tree");
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), codeDirtyBefore);
  assert.equal(git(docs, "status", "--porcelain=v1", "--untracked-files=all"), docsDirtyBefore);
});

test("status reports an approval stale as soon as one approved plan byte changes", () => {
  const project = fixture("stale");
  const { change } = planned(project);
  writeFileSync(join(change, "plan.md"), `${PLAN}\nOne extra sentence.\n`);

  const snapshot = status(project.root);
  const [entry] = snapshot.changes;
  assert.equal(entry.plan.present, true);
  assert.equal(entry.approval.state, "stale");
  assert.match(entry.approval.reason, /plan bytes changed after approval/);
  assert.equal(entry.state, "planned");
  assert.equal(entry.next_skill, "adw:amend");
  assert.equal(entry.blocked.length, 1);
});

test("status refuses an approval whose bound docs commit no longer holds those plan bytes", () => {
  const project = fixture("commit");
  const { change, changeId, planDigest } = planned(project);
  const approval = JSON.parse(readFileSync(join(change, "approval.json"), "utf8"));
  approval.plan_commit = "b".repeat(40);
  writeFileSync(join(change, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`);

  const entry = status(project.root).changes.find((item) => item.change_id === changeId);
  assert.equal(entry.plan.digest, planDigest);
  assert.equal(entry.approval.state, "invalid");
  assert.match(entry.approval.reason, /plan_commit does not exist/);
  assert.equal(entry.next_skill, "adw:amend");
});

test("status ignores symlinked and hostile change entries rather than following them", () => {
  const project = fixture("hostile");
  const { docs, root } = project;
  planned(project);
  const changes = join(docs, "changes");
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "adw-outside-")));
  mkdirSync(join(outside, "changes/escaped"), { recursive: true });
  writeFileSync(join(outside, "changes/escaped/plan.md"), "# stolen plan\n");
  symlinkSync(join(outside, "changes/escaped"), join(changes, "escaped"));
  symlinkSync(join(changes, "tenant-throttling"), join(changes, "aliased"));
  writeFileSync(join(changes, "not-a-directory"), "");
  mkdirSync(join(changes, "Bad Name"), { recursive: true });

  const snapshot = status(root);
  assert.deepEqual(snapshot.changes.map(({ change_id }) => change_id), ["tenant-throttling"]);
  const skipped = Object.fromEntries(snapshot.skipped_changes.map(({ name, reason }) => [name, reason]));
  assert.match(skipped.escaped, /symlinked change entries are ignored/);
  assert.match(skipped.aliased, /symlinked change entries are ignored/);
  assert.match(skipped["not-a-directory"], /not a directory/);
  assert.match(skipped["Bad Name"], /not a safe change id/);
  rmSync(outside, { recursive: true, force: true });
});

test("status ignores a symlinked plan, approval, and run record inside a real change directory", () => {
  const project = fixture("artifacts");
  const { change } = planned(project, "swapped");
  rmSync(join(change, "approval.json"));
  symlinkSync(join(change, "plan.md"), join(change, "approval.json"));
  mkdirSync(join(change, "runs"), { recursive: true });
  symlinkSync(join(change, "plan.md"), join(change, "runs/foundations.json"));

  const entry = status(project.root).changes.find((item) => item.change_id === "swapped");
  assert.equal(entry.approval.state, "invalid");
  assert.match(entry.approval.reason, /regular non-symlink file/);
  assert.deepEqual(entry.runs, []);
  assert.deepEqual(entry.skipped, [{ path: "runs/foundations.json", reason: "run record must be a regular non-symlink file" }]);
});

test("status exits 2 with a truthful error outside a Git project", () => {
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "adw-status-nogit-")));
  const result = spawnSync(process.execPath, [statusScript, "--project-root", outside], { encoding: "utf8" });
  assert.equal(result.status, 2);
  const body = JSON.parse(result.stdout);
  assert.equal(body.ok, false);
  assert.equal(body.read_only, true);
  assert.ok(body.error.length > 0);
  rmSync(outside, { recursive: true, force: true });
});
