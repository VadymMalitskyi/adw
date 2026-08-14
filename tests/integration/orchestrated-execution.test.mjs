import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { realpathSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const helperPath = join(repositoryRoot, "plugin/lib/adw-helper.mjs");
const orchestratorPath = join(repositoryRoot, "plugin/execution/orchestrator.mjs");

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function tryGit(cwd, ...args) {
  return spawnSync("git", args, { cwd, encoding: "utf8" });
}

function runNode(script, argv, input) {
  const result = spawnSync(process.execPath, [script, ...argv], { input: JSON.stringify(input), encoding: "utf8" });
  let body;
  try { body = JSON.parse(result.stdout); }
  catch { throw new Error(`${script} produced non-JSON output: ${result.stdout}${result.stderr}`); }
  return { status: result.status, body };
}

const helper = (command, input) => runNode(helperPath, [command], input);
const orchestrate = (action, input) => runNode(orchestratorPath, [action], input);

function fixture(label) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `adw-${label}-`)));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  mkdirSync(join(root, "src/api"), { recursive: true });
  mkdirSync(join(root, "apps/web"), { recursive: true });
  writeFileSync(join(root, "src/api/index.js"), "export const api = 1;\n");
  writeFileSync(join(root, "apps/web/index.js"), "export const web = 1;\n");
  writeFileSync(join(root, ".gitignore"), "/worktrees/\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function context(root, groups) {
  const planDigest = helper("digest", { content: "# PART 1 — Feature Overview\n" }).body.digest;
  return {
    project_root: root,
    change_id: "tenant-throttling",
    phase_id: "foundations",
    plan_digest: planDigest,
    base_branch: "main",
    base_commit: git(root, "rev-parse", "HEAD"),
    groups,
  };
}

const DISJOINT_GROUPS = [
  { group_id: "api", tasks: ["IMPLEMENT the throttling contract in the api component"], affected_paths: ["src/api"], validation: ["node --version"] },
  { group_id: "web", tasks: ["IMPLEMENT the throttling banner in the web component"], affected_paths: ["apps/web"], validation: ["node --version"] },
];

function branches(root) {
  return git(root, "for-each-ref", "--format=%(refname:short)", "refs/heads").split("\n").filter(Boolean).sort();
}

test("two file-disjoint groups prepare into isolated worktrees on their own branches and can work at the same time", async () => {
  const root = fixture("orchestrated");
  const input = context(root, DISJOINT_GROUPS);
  const prepared = orchestrate("prepare", input);
  assert.equal(prepared.status, 0, JSON.stringify(prepared.body));
  assert.equal(prepared.body.ok, true);
  assert.deepEqual(prepared.body.groups.map(({ group_id, action, prepared: made }) => ({ group_id, action, made })), [
    { group_id: "api", action: "create", made: true },
    { group_id: "web", action: "create", made: true },
  ]);

  for (const group of prepared.body.groups) {
    const worktree = join(root, group.worktree);
    assert.ok(existsSync(worktree), `${group.group_id}: worktree was not created`);
    assert.equal(git(worktree, "rev-parse", "HEAD"), group.marker_commit);
    assert.equal(git(worktree, "log", "-1", "--format=%P"), input.base_commit);
    assert.equal(git(worktree, "symbolic-ref", "--short", "HEAD"), group.branch);
    assert.match(git(worktree, "log", "-1", "--format=%b"), new RegExp(`ADW-Group-ID: ${group.group_id}`));
  }
  assert.deepEqual(branches(root), ["adw/tenant-throttling/api", "adw/tenant-throttling/web", "main"]);

  // Two workers edit their own worktrees at the same time; neither can see or
  // disturb the other's checkout, which is the point of the isolation.
  const worktrees = Object.fromEntries(prepared.body.groups.map((group) => [group.group_id, join(root, group.worktree)]));
  await Promise.all([
    (async () => { writeFileSync(join(worktrees.api, "src/api/throttle.js"), "export const limit = 10;\n"); })(),
    (async () => { writeFileSync(join(worktrees.web, "apps/web/banner.js"), "export const banner = true;\n"); })(),
  ]);
  assert.equal(existsSync(join(worktrees.api, "apps/web/banner.js")), false, "the api worktree must not see the web group's work");
  assert.equal(existsSync(join(worktrees.web, "src/api/throttle.js")), false, "the web worktree must not see the api group's work");

  // The coordinator, never the worker, creates each commit on its own branch.
  for (const [id, worktree] of Object.entries(worktrees)) {
    git(worktree, "add", ".");
    git(worktree, "commit", "-q", "-m", `Implement ${id}`);
  }
  assert.deepEqual(git(root, "diff", "--name-only", `${input.base_commit}..adw/tenant-throttling/api`).split("\n"), ["src/api/throttle.js"]);
  assert.deepEqual(git(root, "diff", "--name-only", `${input.base_commit}..adw/tenant-throttling/web`).split("\n"), ["apps/web/banner.js"]);
});

test("overlapping write paths are refused before any branch or worktree exists", () => {
  const root = fixture("overlap");
  const overlapping = orchestrate("prepare", context(root, [
    { group_id: "api", tasks: ["IMPLEMENT the contract"], affected_paths: ["src/api"], validation: ["node --version"] },
    { group_id: "routes", tasks: ["IMPLEMENT the routes"], affected_paths: ["src/api/routes"], validation: ["node --version"] },
  ]));
  assert.notEqual(overlapping.status, 0);
  assert.equal(overlapping.body.ok, false);
  assert.match(overlapping.body.error, /parallel groups require disjoint write paths/);
  assert.deepEqual(branches(root), ["main"]);
  assert.equal(existsSync(join(root, "worktrees/tenant-throttling")), false);
});

test("preparing again after an interruption resumes instead of duplicating branches", () => {
  const root = fixture("resume");
  const input = context(root, DISJOINT_GROUPS);
  const first = orchestrate("prepare", input);
  assert.equal(first.status, 0, JSON.stringify(first.body));
  const branchesAfterFirst = branches(root);

  // A new session with the identical packet must recognize its own durable
  // marker commits and continue, not create a second branch or worktree.
  const second = orchestrate("prepare", input);
  assert.equal(second.status, 0, JSON.stringify(second.body));
  assert.deepEqual(second.body.groups.map(({ action, prepared }) => ({ action, prepared })), [
    { action: "reuse", prepared: false },
    { action: "reuse", prepared: false },
  ]);
  assert.deepEqual(branches(root), branchesAfterFirst);
  assert.deepEqual(second.body.groups.map(({ marker_commit }) => marker_commit), first.body.groups.map(({ marker_commit }) => marker_commit));

  // A different interpreted packet for the same group is not resumable.
  const drifted = orchestrate("prepare", context(root, [
    { ...DISJOINT_GROUPS[0], tasks: ["IMPLEMENT something entirely different"] },
    DISJOINT_GROUPS[1],
  ]));
  assert.notEqual(drifted.status, 0);
  assert.match(JSON.stringify(drifted.body), /ADW-Packet-Digest/);
});

test("a run record round-trips through the real status transitions and refuses to move backwards", () => {
  const root = fixture("record");
  const input = context(root, DISJOINT_GROUPS);
  const created = helper("create-run-record", {
    change_id: input.change_id,
    phase_id: input.phase_id,
    plan_digest: input.plan_digest,
    base_branch: input.base_branch,
    base_commit: input.base_commit,
    started_at: "2026-08-13T12:00:00Z",
    groups: DISJOINT_GROUPS.map(({ group_id, tasks, affected_paths }) => ({ group_id, tasks, affected_paths })),
  });
  assert.equal(created.status, 0, JSON.stringify(created.body));
  let record = created.body.record;
  assert.equal(record.status, "running");
  assert.equal(record.groups.api.status, "prepared");
  assert.equal(record.groups.api.branch, "adw/tenant-throttling/api");
  assert.equal(record.groups.web.worktree, "worktrees/tenant-throttling/web");

  for (const status of ["implementing", "reviewing", "validating"]) {
    const stepped = helper("update-run-record", { record, update: { groups: { api: { status } } } });
    assert.equal(stepped.status, 0, JSON.stringify(stepped.body));
    record = stepped.body.record;
    assert.equal(record.groups.api.status, status);
  }

  const backwards = helper("update-run-record", { record, update: { groups: { api: { status: "implementing" } } } });
  assert.equal(backwards.status, 2);
  assert.equal(backwards.body.ok, false);
  assert.match(backwards.body.error.message, /cannot move backwards from validating to implementing/);

  const dishonest = helper("update-run-record", {
    record,
    update: {
      groups: {
        api: {
          validation: {
            status: "passed",
            commands: [{ command: "npm test", cwd: ".", exit_code: 1, signal: null, timed_out: false, duration_ms: 4, summary: "1 failing", required: true }],
          },
        },
      },
    },
  });
  assert.equal(dishonest.status, 2);
  assert.match(dishonest.body.error.message, /cannot be passed while a required command failed/);

  const premature = helper("update-run-record", { record, update: { groups: { api: { status: "passed" } } } });
  assert.equal(premature.status, 2);
  assert.match(premature.body.error.message, /cannot be passed before independent review passes/);
});

test("a failed group is recorded truthfully without corrupting a sibling group that passed", () => {
  const root = fixture("mixed");
  const input = context(root, DISJOINT_GROUPS);
  orchestrate("prepare", input);
  let record = helper("create-run-record", {
    change_id: input.change_id,
    phase_id: input.phase_id,
    plan_digest: input.plan_digest,
    base_branch: input.base_branch,
    base_commit: input.base_commit,
    started_at: "2026-08-13T12:00:00Z",
    groups: DISJOINT_GROUPS.map(({ group_id, tasks, affected_paths }) => ({ group_id, tasks, affected_paths })),
  }).body.record;

  // The api group runs a real passing command; the web group runs a real
  // failing one. Both results come from the helper's own process mechanics.
  const passing = helper("run-validation", {
    project_root: join(root, "worktrees/tenant-throttling/api"),
    recorded_at: "2026-08-13T12:05:00Z",
    commands: [{ command: 'node -e "process.exit(0)"', cwd: ".", timeout_ms: 20000, required: true }],
  });
  assert.equal(passing.status, 0, JSON.stringify(passing.body));
  assert.equal(passing.body.evidence.status, "passed");

  const failing = helper("run-validation", {
    project_root: join(root, "worktrees/tenant-throttling/web"),
    recorded_at: "2026-08-13T12:06:00Z",
    commands: [{ command: 'node -e "process.exit(17)"', cwd: ".", timeout_ms: 20000, required: true }],
  });
  assert.equal(failing.status, 5);
  assert.equal(failing.body.evidence.status, "failed");
  assert.equal(failing.body.evidence.commands[0].exit_code, 17);

  for (const status of ["implementing", "reviewing", "validating"]) {
    record = helper("update-run-record", { record, update: { groups: { api: { status }, web: { status } } } }).body.record;
  }
  const apiCommit = git(join(root, "worktrees/tenant-throttling/api"), "rev-parse", "HEAD");
  record = helper("update-run-record", {
    record,
    update: {
      groups: {
        api: {
          review: { status: "passed", high_findings: [] },
          validation: { status: passing.body.evidence.status, commands: passing.body.evidence.commands, deferred: passing.body.evidence.deferred, recorded_at: passing.body.evidence.recorded_at },
          implementation_commit: apiCommit,
          status: "passed",
        },
        web: {
          review: { status: "passed", high_findings: [] },
          validation: { status: failing.body.evidence.status, commands: failing.body.evidence.commands, deferred: failing.body.evidence.deferred, recorded_at: failing.body.evidence.recorded_at },
          status: "failed",
        },
      },
    },
  }).body.record;

  record = helper("update-run-record", { record, update: { status: "failed", completed_at: "2026-08-13T12:07:00Z" } }).body.record;
  assert.equal(record.groups.api.status, "passed");
  assert.equal(record.groups.api.implementation_commit, apiCommit);
  assert.equal(record.groups.web.status, "failed");
  assert.equal(record.groups.web.validation.commands[0].exit_code, 17);
  assert.equal(record.status, "failed");
  assert.equal(helper("validate-run-record", { record }).body.ok, true);

  // The phase failed as a whole, yet the passed group keeps its branch, its
  // worktree, and its evidence for a later resumed run.
  assert.equal(tryGit(root, "show-ref", "--verify", "--quiet", "refs/heads/adw/tenant-throttling/api").status, 0);
  assert.ok(existsSync(join(root, "worktrees/tenant-throttling/api")));

  const cleanup = orchestrate("cleanup-guidance", input);
  assert.equal(cleanup.status, 0);
  assert.match(JSON.stringify(cleanup.body), /ADW never deletes them for you/);
});

test("execute's coordinator contract keeps workers away from Git and delivery", () => {
  const execute = readFileSync(join(repositoryRoot, "plugin/skills/execute/SKILL.md"), "utf8");
  assert.match(execute, /execution\/orchestrator\.mjs prepare/);
  assert.match(execute, /create-run-record/);
  assert.match(execute, /update-run-record/);
  assert.match(execute, /before any worker starts/i);
  assert.match(execute, /must not commit, push, touch another group's paths, create tracker items, or open pull requests/);
});
