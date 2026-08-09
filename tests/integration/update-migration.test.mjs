import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
  const lines = [
    `schema: ${schema}`, "", "git:", "  default_branch: main", "", "documentation:",
    "  mode: branch", "  branch: docs", "  worktree: worktrees/docs", "  sync_marker: SYNC.yaml", "  delivery: direct-push",
  ];
  if (schema >= 3) lines.push("", "execution:", "  isolation: provider-sandbox", "  enforcement: preferred");
  return [...lines, "", "components:", "  app:", "    path: .", "", "validation:", "  default:", "    - npm test", ""].join("\n");
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

test("a schema 5 project is a no-op and touches no project artifact", () => {
  const root = fixture(5);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  writeFileSync(join(root, "adw.yaml"), before.replace(/  enforcement: preferred\n/, "  enforcement: preferred\n  permissions:\n    profile: managed-development\n"));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "schema 5 policy");
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

test("schema 4 to 5 migration adds the permission profile and provider policy files", () => {
  const root = fixture(4);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const preview = JSON.parse(run(root, ["preview"]).stdout);
  assert.equal(preview.from_schema, 4);
  assert.equal(preview.to_schema, 5);
  assert.deepEqual(preview.writes, ["adw.yaml", ".codex/config.toml", ".codex/rules/adw.rules"]);
  assert.match(preview.diffs[0].after, /^schema: 5$/m);
  assert.match(preview.diffs[0].after, /permissions:\n    profile: managed-development/);
  const applied = JSON.parse(run(root, ["apply", "--confirmed", "--preview-digest", preview.preview_digest]).stdout);
  assert.equal(applied.migrated, true);
  assert.equal(readFileSync(join(root, "changes/historical/approval.json"), "utf8"), "{\"status\":\"active\"}\n");
  assert.equal(readFileSync(join(root, ".codex/rules/adw.rules"), "utf8").includes('decision = "prompt"'), true);
  assert.notEqual(readFileSync(join(root, "adw.yaml"), "utf8"), before);
});

test("schema 4 managed container migration installs root-owned provider policy artifacts", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-update-managed-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "fixture\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  const initialized = spawnSync(process.execPath, [initScript, "apply", "--confirmed", "--project-root", root], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);

  const adwPath = join(root, "adw.yaml");
  writeFileSync(adwPath, readFileSync(adwPath, "utf8").replace(/^schema: 5$/m, "schema: 4").replace(/  permissions:\n    profile: managed-development\n/, ""));
  rmSync(join(root, ".codex"), { recursive: true });
  rmSync(join(root, ".claude"), { recursive: true });
  for (const name of ["codex.rules", "claude-settings.json", "claude-permission-hook.mjs"]) rmSync(join(root, ".devcontainer", name));
  const dockerPath = join(root, ".devcontainer/Dockerfile");
  writeFileSync(dockerPath, readFileSync(dockerPath, "utf8")
    .replace(/^COPY \.devcontainer\/(?:codex\.rules|claude-settings\.json|claude-permission-hook\.mjs).*\n/gm, "")
    .replace(" /etc/adw/codex.rules", "").replace(" /etc/claude-code/managed-settings.d/20-adw.json", "").replace(" /usr/local/bin/adw-claude-permission-hook", "")
    .replace(" /etc/adw/codex.rules", "").replace(" /etc/claude-code/managed-settings.d/20-adw.json", "").replace(" /usr/local/bin/adw-claude-permission-hook", ""));
  const postCreatePath = join(root, ".devcontainer/post-create.sh");
  writeFileSync(postCreatePath, readFileSync(postCreatePath, "utf8").replace(/\nif \[\[ "\$agent_tools" == "codex"[\s\S]*?\nfi\n/, "\n"));
  const markerPath = join(root, ".devcontainer/adw-managed.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  for (const key of ["permission_profile", "codex_rules_sha256", "claude_settings_sha256", "claude_hook_sha256"]) delete marker[key];
  marker.schema = 1;
  marker.plugin_version = "0.3.0";
  writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "schema 4 managed fixture");

  const preview = JSON.parse(run(root, ["preview"]).stdout);
  for (const path of [".devcontainer/Dockerfile", ".devcontainer/post-create.sh", ".devcontainer/codex.rules", ".devcontainer/claude-settings.json", ".devcontainer/claude-permission-hook.mjs", ".devcontainer/adw-managed.json"]) assert.ok(preview.writes.includes(path), path);
  const applied = JSON.parse(run(root, ["apply", "--confirmed", "--preview-digest", preview.preview_digest]).stdout);
  assert.equal(applied.migrated, true);
  const migratedMarker = JSON.parse(readFileSync(markerPath, "utf8"));
  assert.equal(migratedMarker.schema, 2);
  assert.equal(migratedMarker.permission_profile, "managed-development");
  assert.equal(migratedMarker.plugin_version, "0.4.0");
});

test("schema 3 to 5 migration adds permissions without inventing workflow policy", () => {
  const root = fixture(3);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const preview = JSON.parse(run(root, ["preview"]).stdout);
  assert.equal(preview.from_schema, 3);
  assert.equal(preview.to_schema, 5);
  assert.match(preview.diffs[0].after, /^schema: 5$/m);
  assert.match(preview.diffs[0].after, /permissions:\n    profile: managed-development/);
  assert.doesNotMatch(preview.diffs[0].after, /^workflows:/m);
  assert.doesNotMatch(preview.diffs[0].after, /^integrations:/m);

  const applied = JSON.parse(run(root, ["apply", "--confirmed", "--preview-digest", preview.preview_digest]).stdout);
  assert.equal(applied.migrated, true);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /^schema: 5$/m);
});

test("permission migration rejects provider configuration symlink escapes without writes", () => {
  const root = fixture(4);
  const outside = mkdtempSync(join(tmpdir(), "adw-update-outside-"));
  writeFileSync(join(outside, "config.toml"), 'sandbox_mode = "danger-full-access"\n');
  mkdirSync(join(root, ".codex"));
  symlinkSync(join(outside, "config.toml"), join(root, ".codex/config.toml"));
  git(root, "add", ".codex/config.toml");
  git(root, "commit", "-q", "-m", "hostile symlink");
  const result = run(root, ["preview"], 2);
  assert.match(result.stderr, /symbolic link|outside the project root/);
  assert.equal(readFileSync(join(outside, "config.toml"), "utf8"), 'sandbox_mode = "danger-full-access"\n');
});

test("schema 1 to 5 migration requires its reviewed digest and preserves historical change evidence", () => {
  const root = fixture(1);
  const before = readFileSync(join(root, "adw.yaml"), "utf8");
  const specBefore = readFileSync(join(root, "changes/historical/spec.md"), "utf8");
  const approvalBefore = readFileSync(join(root, "changes/historical/approval.json"), "utf8");
  const preview = JSON.parse(run(root, ["preview"]).stdout);
  assert.equal(preview.migration_required, true);
  assert.equal(preview.from_schema, 1);
  assert.equal(preview.to_schema, 5);
  assert.deepEqual(preview.writes, ["adw.yaml", ".codex/config.toml", ".codex/rules/adw.rules"]);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before);

  assert.match(run(root, ["apply", "--confirmed", "--preview-digest", "wrong"], 2).stderr, /preview is stale/);
  assert.equal(readFileSync(join(root, "adw.yaml"), "utf8"), before, "failed apply must leave the prior schema usable");
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");

  const applied = JSON.parse(run(root, ["apply", "--confirmed", "--preview-digest", preview.preview_digest]).stdout);
  assert.equal(applied.migrated, true);
  const migrated = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.match(migrated, /^schema: 5$/m);
  assert.match(migrated, /execution:\n  isolation: provider-sandbox\n  enforcement: preferred\n  permissions:\n    profile: managed-development/);
  assert.equal(readFileSync(join(root, "changes/historical/spec.md"), "utf8"), specBefore);
  assert.equal(readFileSync(join(root, "changes/historical/approval.json"), "utf8"), approvalBefore);
  assert.match(git(root, "status", "--porcelain=v1", "--untracked-files=all"), /M adw.yaml/);
  assert.match(git(root, "status", "--porcelain=v1", "--untracked-files=all"), /\.codex\/config.toml/);
});
