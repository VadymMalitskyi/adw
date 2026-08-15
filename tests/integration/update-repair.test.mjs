import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const updateScript = join(repositoryRoot, "plugin/skills/update/scripts/update.mjs");
const initScript = join(repositoryRoot, "plugin/initialization/init.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function config() {
  return [
    "adw: 1", "", "git:", "  base_branch: main", "",
    "docs:", "  branch: docs", "  worktree: worktrees/docs", "  sync_marker: SYNC.yaml", "",
    "execution:", "  mode: orchestrated", "  isolation: provider-sandbox", "",
    "components:", "  app:", "    path: .", "    validate:", "      - npm test", "",
  ].join("\n");
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "adw-update-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "adw.yaml"), config());
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
  const root = fixture();
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
  const root = fixture();
  // An unreadable contract is reported with its errors, never reinterpreted.
  writeFileSync(join(root, "adw.yaml"), "schema: 99\ngit:\n  default_branch: main\n");
  git(root, "add", "adw.yaml");
  git(root, "commit", "-q", "-m", "superseded contract");
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
  writeFileSync(join(root, "App.csproj"), '<Project Sdk="Microsoft.NET.Sdk" />\n');
  const onboardingPath = join(root, "onboarding.json");
  writeFileSync(onboardingPath, `${JSON.stringify({ schema: 1, development: { runtime_versions: { dotnet: "8" } } }, null, 2)}\n`);
  git(root, "add", "App.csproj", "onboarding.json");
  git(root, "commit", "-q", "-m", "fixture");
  const initPreview = spawnSync(process.execPath, [initScript, "--kind", "brownfield", "preview", "--execution", "managed-devcontainer", "--project-root", root, "--onboarding", onboardingPath], { encoding: "utf8" });
  assert.equal(initPreview.status, 0, initPreview.stderr);
  const initDigest = JSON.parse(initPreview.stdout).preview_digest;
  const initialized = spawnSync(process.execPath, [initScript, "--kind", "brownfield", "apply", "--confirmed", "--preview-digest", initDigest, "--execution", "managed-devcontainer", "--project-root", root, "--onboarding", onboardingPath], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /development:\n  runtime_versions:\n    dotnet: "8"/);
  const initializedContainer = JSON.parse(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8"));
  assert.equal(initializedContainer.features["ghcr.io/devcontainers/features/dotnet:1"].version, "8");

  // Emulate a project initialized before the chosen version was persisted in adw.yaml.
  const projectConfigPath = join(root, "adw.yaml");
  writeFileSync(projectConfigPath, readFileSync(projectConfigPath, "utf8").replace(/\ndevelopment:\n  runtime_versions:\n    dotnet: "8"\n/, "\n"));

  const markerPath = join(root, ".devcontainer/adw-managed.json");
  const marker = JSON.parse(readFileSync(markerPath, "utf8"));
  marker.plugin_version = "0.0.1";
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
  assert.equal(JSON.parse(readFileSync(markerPath, "utf8")).plugin_version, readFileSync(join(repositoryRoot, "VERSION"), "utf8").trim());
  const repairedContainer = JSON.parse(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8"));
  assert.equal(repairedContainer.features["ghcr.io/devcontainers/features/dotnet:1"].version, "8");
});

test("managed repair rejects inconsistent recovered runtime evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-update-runtime-evidence-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "App.csproj"), '<Project Sdk="Microsoft.NET.Sdk" />\n');
  const onboardingPath = join(root, "onboarding.json");
  writeFileSync(onboardingPath, `${JSON.stringify({ schema: 1, development: { runtime_versions: { dotnet: "8" } } }, null, 2)}\n`);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  const preview = JSON.parse(spawnSync(process.execPath, [initScript, "--kind", "brownfield", "preview", "--execution", "managed-devcontainer", "--project-root", root, "--onboarding", onboardingPath], { encoding: "utf8" }).stdout);
  const initialized = spawnSync(process.execPath, [initScript, "--kind", "brownfield", "apply", "--confirmed", "--preview-digest", preview.preview_digest, "--execution", "managed-devcontainer", "--project-root", root, "--onboarding", onboardingPath], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr);
  const projectConfigPath = join(root, "adw.yaml");
  writeFileSync(projectConfigPath, readFileSync(projectConfigPath, "utf8").replace(/\ndevelopment:\n  runtime_versions:\n    dotnet: "8"\n/, "\n"));
  const requirementsPath = join(root, ".devcontainer/project-requirements.json");
  const requirements = JSON.parse(readFileSync(requirementsPath, "utf8"));
  requirements.selected_versions.dotnet = "9";
  writeFileSync(requirementsPath, `${JSON.stringify(requirements, null, 2)}\n`);

  const result = run(root, "preview");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot recover initialization-selected runtime versions/);
});
