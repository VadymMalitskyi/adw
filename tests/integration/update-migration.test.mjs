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
    "  mode: branch", "  branch: docs", "  worktree: worktrees/docs", "  sync_marker: SYNC.yaml", "  delivery: direct-push",
    "", "components:", "  app:", "    path: .", "", "validation:", "  default:", "    - npm test", "",
  ].join("\n");
}

function fixture(schema) {
  const root = mkdtempSync(join(tmpdir(), "adw-update-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "adw.yaml"), config(schema));
  mkdirSync(join(root, "changes/historical"), { recursive: true });
  writeFileSync(join(root, "changes/historical/spec.md"), "immutable historical intent\n");
  writeFileSync(join(root, "changes/historical/approval.json"), "{\"status\":\"active\"}\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function run(root, args, expected = 0) {
  const result = spawnSync(process.execPath, [updateScript, ...args, "--project-root", root], { encoding: "utf8" });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

test("a compatible plugin update touches no project artifact", () => {
  const root = fixture(1);
  const head = git(root, "rev-parse", "HEAD");
  const configBefore = readFileSync(join(root, "adw.yaml"), "utf8");
  const historyBefore = readFileSync(join(root, "changes/historical/approval.json"), "utf8");
  const preview = JSON.parse(run(root, ["preview"]).stdout);
  assert.equal(preview.compatible, true);
  assert.deepEqual(preview.writes, []);
  const apply = JSON.parse(run(root, ["apply"]).stdout);
  assert.equal(apply.compatible, true);
  assert.deepEqual(apply.writes, []);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), configBefore);
  assert.equal(readFileSync(join(root, "changes/historical/approval.json"), "utf8"), historyBefore);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("migration requires its reviewed digest, rolls back failed attempts, and preserves history", () => {
  const root = fixture(0);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const specBefore = readFileSync(join(root, "changes/historical/spec.md"), "utf8");
  const approvalBefore = readFileSync(join(root, "changes/historical/approval.json"), "utf8");
  const preview = JSON.parse(run(root, ["preview"]).stdout);
  assert.equal(preview.migration_required, true);
  assert.deepEqual(preview.writes, ["adw.yaml"]);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);

  assert.match(run(root, ["apply", "--confirmed", "--preview-digest", "wrong"], 2).stderr, /preview is stale/);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before, "failed apply must leave the prior schema usable");
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");

  const applied = JSON.parse(run(root, ["apply", "--confirmed", "--preview-digest", preview.preview_digest]).stdout);
  assert.equal(applied.migrated, true);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /^schema: 1$/m);
  assert.equal(readFileSync(join(root, "changes/historical/spec.md"), "utf8"), specBefore);
  assert.equal(readFileSync(join(root, "changes/historical/approval.json"), "utf8"), approvalBefore);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "M adw.yaml");
});
