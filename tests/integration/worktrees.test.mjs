import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../../plugin/bin/adw.mjs", import.meta.url));

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout.trim();
}

function run(command, input) {
  const result = spawnSync(process.execPath, [cli, command], { input: JSON.stringify(input), encoding: "utf8" });
  return { status: result.status, body: JSON.parse(result.stdout) };
}

function repository() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "adw-worktrees-")));
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.test"]);
  git(root, ["config", "user.name", "ADW Test"]);
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "initial"]);
  return { root, head: git(root, ["rev-parse", "HEAD"]) };
}

function request(root, head, groups, extra = {}) {
  return { project_root: root, change_id: "demo", base_branch: "main", base_commit: head, groups, ...extra };
}

const TWO_GROUPS = [
  { group_id: "api", tasks: ["implement the API"], affected_paths: ["src/api"], validation: ["npm test"] },
  { group_id: "web", tasks: ["implement the web client"], affected_paths: ["src/web"], validation: ["npm test"] },
];

test("parallel groups prepare into isolated branches and worktrees", () => {
  const { root, head } = repository();
  const preview = run("worktree-preview", request(root, head, TWO_GROUPS));
  assert.equal(preview.status, 0);
  assert.deepEqual(preview.body.groups.map((group) => group.action), ["create", "create"]);
  // Preview never mutates: nothing exists yet.
  assert.equal(existsSync(join(root, "worktrees")), false);

  const prepared = run("worktree-prepare", request(root, head, TWO_GROUPS));
  assert.equal(prepared.status, 0);
  assert.equal(prepared.body.ok, true);
  for (const group of prepared.body.groups) {
    assert.equal(group.prepared, true);
    assert.equal(group.branch, `adw/demo/${group.group_id}`);
    assert.equal(group.worktree, `worktrees/demo/${group.group_id}`);
    assert.ok(existsSync(join(root, group.worktree)));
    // Each marker commit sits directly on the shared base, so the groups are
    // genuinely independent rather than chained.
    assert.equal(git(root, ["log", "-1", "--format=%P", group.branch]), head);
  }
  assert.notEqual(prepared.body.groups[0].branch, prepared.body.groups[1].branch);
});

test("a configured branch template names generated group branches", () => {
  const { root, head } = repository();
  const preview = run("worktree-preview", {
    ...request(root, head, [{ group_id: "api", tasks: ["x"], affected_paths: ["src/api"] }]),
    branch_template: "feature/{change_id}-{group_id}",
  });
  assert.equal(preview.status, 0, JSON.stringify(preview.body));
  assert.equal(preview.body.groups[0].branch, "feature/demo-api");
});

test("a marker commit lets a later session resume from Git alone", () => {
  const { root, head } = repository();
  const first = run("worktree-prepare", request(root, head, TWO_GROUPS));
  const markers = first.body.groups.map((group) => group.marker_commit);

  const resumed = run("worktree-prepare", request(root, head, TWO_GROUPS));
  assert.equal(resumed.status, 0);
  for (const [index, group] of resumed.body.groups.entries()) {
    assert.equal(group.action, "reuse");
    assert.equal(group.prepared, false);
    assert.equal(group.marker_commit, markers[index]);
  }

  const trailers = git(root, ["log", "-1", "--format=%b", "adw/demo/api"]);
  for (const trailer of ["ADW-Change-ID: demo", "ADW-Group-ID: api", "ADW-Base-Branch: main", `ADW-Base-Commit: ${head}`, "ADW-Packet-Digest: "]) {
    assert.ok(trailers.includes(trailer), `${trailer} missing from ${trailers}`);
  }
});

test("a changed packet is refused rather than silently resumed", () => {
  const { root, head } = repository();
  run("worktree-prepare", request(root, head, TWO_GROUPS));
  const changed = TWO_GROUPS.map((group) => (group.group_id === "api" ? { ...group, tasks: ["implement something else"] } : group));

  const result = run("worktree-prepare", request(root, head, changed));
  assert.equal(result.status, 5);
  assert.equal(result.body.ok, false);
  assert.deepEqual(result.body.blocked.map(({ group_id }) => group_id), ["api"]);
  assert.match(result.body.blocked[0].blockers.join(" "), /ADW-Packet-Digest/);
});

test("overlapping write paths fail before anything is mutated", () => {
  const { root, head } = repository();
  const overlapping = [
    { group_id: "a", tasks: ["one"], affected_paths: ["src"] },
    { group_id: "b", tasks: ["two"], affected_paths: ["src/web"] },
  ];
  const result = run("worktree-prepare", request(root, head, overlapping));
  assert.equal(result.status, 3);
  assert.match(result.body.error.message, /disjoint write paths/);
  assert.equal(existsSync(join(root, "worktrees")), false);
  assert.equal(git(root, ["branch", "--list", "adw/*"]), "");
});

test("a path both groups declare as shared is allowed through explicitly", () => {
  const { root, head } = repository();
  const groups = [
    { group_id: "a", tasks: ["one"], affected_paths: ["src/a", "docs/shared.md"] },
    { group_id: "b", tasks: ["two"], affected_paths: ["src/b", "docs/shared.md"] },
  ];
  assert.equal(run("worktree-preview", request(root, head, groups)).status, 3, "an undeclared overlap must still fail");
  const result = run("worktree-preview", request(root, head, groups, { shared_paths: ["docs/shared.md"] }));
  assert.equal(result.status, 0);
});

test("unsafe group input is refused before touching the repository", () => {
  const { root, head } = repository();
  const cases = [
    [[{ group_id: "escape", tasks: ["x"], affected_paths: ["../outside"] }], /traversal-free/],
    [[{ group_id: "absolute", tasks: ["x"], affected_paths: ["/etc/passwd"] }], /traversal-free/],
    [[{ group_id: "Bad Id", tasks: ["x"], affected_paths: ["src"] }], /safe identifier/],
    [[{ group_id: "empty", tasks: [], affected_paths: ["src"] }], /task directives/],
    [[{ group_id: "nopaths", tasks: ["x"], affected_paths: [] }], /at least one affected path/],
    [[{ group_id: "a", tasks: ["x"], affected_paths: ["src/a"] }, { group_id: "a", tasks: ["y"], affected_paths: ["src/b"] }], /duplicate group id/],
    [[{ group_id: "a", tasks: ["x"], affected_paths: ["src/a"], worktree: "../outside" }], /traversal-free/],
    [[{ group_id: "a", tasks: ["x"], affected_paths: ["src/a"], branch: "bad branch" }], /valid Git branch name/],
  ];
  for (const [groups, pattern] of cases) {
    const result = run("worktree-prepare", request(root, head, groups));
    assert.equal(result.body.ok, false, JSON.stringify(groups));
    assert.match(result.body.error.message, pattern);
  }
  assert.equal(existsSync(join(root, "worktrees")), false);
});

test("a symlinked worktree location is refused", () => {
  const { root, head } = repository();
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "adw-outside-")));
  mkdirSync(join(root, "worktrees"), { recursive: true });
  symlinkSync(outside, join(root, "worktrees/demo"));
  const result = run("worktree-prepare", request(root, head, [{ group_id: "api", tasks: ["x"], affected_paths: ["src/api"] }]));
  assert.equal(result.body.ok, false);
  assert.match(result.body.error.message, /symbolic link/);
  assert.deepEqual(readdirSync(outside), []);
});

test("a base commit that the base branch does not contain is refused", () => {
  const { root, head } = repository();
  writeFileSync(join(root, "other.txt"), "other\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "second"]);
  git(root, ["checkout", "-q", "-b", "side"]);
  writeFileSync(join(root, "side.txt"), "side\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "side"]);
  const sideHead = git(root, ["rev-parse", "HEAD"]);
  git(root, ["checkout", "-q", "main"]);

  const missing = run("worktree-prepare", { ...request(root, head, TWO_GROUPS), base_commit: "0".repeat(40) });
  assert.match(missing.body.error.message, /does not exist in this repository/);

  const wrongBranch = run("worktree-prepare", { ...request(root, head, TWO_GROUPS), base_commit: sideHead });
  assert.match(wrongBranch.body.error.message, /does not contain base_commit/);
});

test("a branch occupied by unrelated history blocks instead of being reused", () => {
  const { root, head } = repository();
  git(root, ["branch", "adw/demo/api"]);
  const result = run("worktree-preview", request(root, head, TWO_GROUPS));
  assert.equal(result.status, 5);
  assert.deepEqual(result.body.blocked.map(({ group_id }) => group_id), ["api"]);
  assert.match(result.body.blocked[0].blockers.join(" "), /without an ADW group marker commit/);
});

test("cleanup stays guidance-only and never deletes a branch or worktree", () => {
  const { root, head } = repository();
  run("worktree-prepare", request(root, head, TWO_GROUPS));
  const guidance = run("worktree-cleanup-guidance", request(root, head, TWO_GROUPS));
  assert.equal(guidance.status, 0);
  assert.deepEqual(guidance.body.groups.map(({ commands }) => commands), [
    ["git worktree remove worktrees/demo/api", "git branch -d adw/demo/api"],
    ["git worktree remove worktrees/demo/web", "git branch -d adw/demo/web"],
  ]);
  for (const group of guidance.body.groups) assert.match(group.note, /ADW never deletes them for you/);
  // The guidance call itself removed nothing.
  assert.ok(existsSync(join(root, "worktrees/demo/api")));
  assert.ok(existsSync(join(root, "worktrees/demo/web")));
  assert.match(git(root, ["branch", "--list", "adw/*"]), /adw\/demo\/api/);
});

test("preparation reports dirty work in an attached worktree instead of discarding it", () => {
  const { root, head } = repository();
  run("worktree-prepare", request(root, head, TWO_GROUPS));
  writeFileSync(join(root, "worktrees/demo/api/scratch.txt"), "in progress\n");

  const inspected = run("worktree-inspect", request(root, head, TWO_GROUPS));
  const api = inspected.body.groups.find((group) => group.group_id === "api");
  assert.equal(api.worktree_attached, true);
  assert.deepEqual(api.dirty, ["?? scratch.txt"]);

  run("worktree-prepare", request(root, head, TWO_GROUPS));
  assert.ok(existsSync(join(root, "worktrees/demo/api/scratch.txt")), "resuming must not discard uncommitted work");
});
