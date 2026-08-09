import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const updateScript = join(repositoryRoot, "plugin/skills/update/scripts/update.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function config(schema) {
  return [
    `schema: ${schema}`, "", "git:", "  default_branch: main", "", "documentation:",
    "  mode: branch", "  branch: docs", "  worktree: worktrees/docs", "  sync_marker: SYNC.yaml", "  delivery: direct-push", "",
    "execution:", "  isolation: provider-sandbox", "  enforcement: preferred", "  permissions:", "    profile: managed-development", "",
    "components:", "  app:", "    path: .", "", "validation:", "  default:", "    - npm test", "",
  ].join("\n");
}

function fixture(schema) {
  const root = mkdtempSync(join(tmpdir(), "adw-update-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "adw.yaml"), config(schema));
  mkdirSync(join(root, "changes/historical"), { recursive: true });
  writeFileSync(join(root, "changes/historical/approval.json"), "historical bytes\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function run(root, action) {
  return spawnSync(process.execPath, [updateScript, action, "--project-root", root], { encoding: "utf8" });
}

test("schema 5 preview and apply are read-only compatibility checks", () => {
  const root = fixture(5);
  const head = git(root, "rev-parse", "HEAD");
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  for (const action of ["preview", "apply"]) {
    const result = run(root, action);
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.equal(body.compatible, true);
    assert.equal(body.project_schema, 5);
    assert.equal(body.supported_project_schema, 5);
    assert.equal(body.migration_required, false);
    assert.deepEqual(body.writes, []);
  }
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("every previous project schema is rejected without writes", () => {
  for (const schema of [1, 2, 3, 4]) {
    const root = fixture(schema);
    const before = readFileSync(join(root, "adw.yaml"), "utf8");
    const history = readFileSync(join(root, "changes/historical/approval.json"), "utf8");
    for (const action of ["preview", "apply"]) {
      const result = run(root, action);
      assert.equal(result.status, 2, `schema ${schema}: ${result.stdout}`);
      const body = JSON.parse(result.stderr);
      assert.equal(body.compatible, false);
      assert.equal(body.migration_required, false);
      assert.deepEqual(body.writes, []);
      assert.match(body.error, new RegExp(`project schema ${schema} is not supported`));
      assert.match(body.error, /automatic migration.*not supported/);
    }
    assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);
    assert.equal(readFileSync(join(root, "changes/historical/approval.json"), "utf8"), history);
    assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
  }
});

test("a project newer than the plugin is rejected without downgrade", () => {
  const root = fixture(6);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const result = run(root, "preview");
  assert.equal(result.status, 2);
  const body = JSON.parse(result.stderr);
  assert.equal(body.compatible, false);
  assert.deepEqual(body.writes, []);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});
