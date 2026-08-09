import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const updateScript = join(repositoryRoot, "plugin/skills/update/scripts/update.mjs");
const initScript = join(repositoryRoot, "plugin/skills/init/scripts/init.mjs");

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

function run(root, action, options = {}) {
  const args = [updateScript, action, "--project-root", root];
  if (options.confirmed) args.push("--confirmed");
  if (options.previewDigest) args.push("--preview-digest", options.previewDigest);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

test("provider-sandbox preview and digest-bound apply are no-op managed-file checks", () => {
  const root = fixture(5);
  const head = git(root, "rev-parse", "HEAD");
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const previewResult = run(root, "preview");
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  for (const [action, result] of [["preview", previewResult], ["apply", run(root, "apply", { confirmed: true, previewDigest: preview.preview_digest })]]) {
    assert.equal(result.status, 0, result.stderr);
    const body = JSON.parse(result.stdout);
    assert.deepEqual(body.writes, []);
  }
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("invalid project configuration is rejected without writes or format-specific recovery", () => {
  const root = fixture(999);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const result = run(root, "preview");
  assert.equal(result.status, 2);
  const body = JSON.parse(result.stderr);
  assert.doesNotMatch(body.error, /compatib|migration|downgrade/i);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("managed projects preview and atomically repair release-owned files", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-update-managed-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  git(root, "commit", "-q", "--allow-empty", "-m", "fixture");
  const initPreview = spawnSync(process.execPath, [initScript, "preview", "--project-root", root], { encoding: "utf8" });
  assert.equal(initPreview.status, 0, initPreview.stderr);
  const initDigest = JSON.parse(initPreview.stdout).preview_digest;
  const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--preview-digest", initDigest, "--project-root", root], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);

  const markerPath = join(root, ".devcontainer/adw-managed.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  marker.plugin_version = "0.5.0";
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  writeFileSync(join(root, ".devcontainer/Dockerfile"), "drifted\n");
  writeFileSync(join(root, ".devcontainer/allowed-domains.txt"), `${readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8")}evil.example.com\n`);

  const previewResult = run(root, "preview");
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  assert.equal(preview.repair_required, true);
  assert.ok(preview.writes.some(({ path }) => path === ".devcontainer/adw-managed.json"));
  assert.ok(preview.writes.some(({ path }) => path === ".devcontainer/Dockerfile"));
  const stale = run(root, "apply", { confirmed: true, previewDigest: "0".repeat(64) });
  assert.equal(stale.status, 2);
  const applied = run(root, "apply", { confirmed: true, previewDigest: preview.preview_digest });
  assert.equal(applied.status, 0, applied.stderr);
  assert.notEqual(readFileSync(join(root, ".devcontainer/Dockerfile"), "utf8"), "drifted\n");
  assert.doesNotMatch(readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8"), /evil\.example\.com/);
  assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).plugin_version, "0.6.0");
});
