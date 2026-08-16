// `adw:update` re-renders ADW-owned files and nothing else. Every assertion
// here is made against the real CLI and against the whole project tree, so a
// refresh that touched an unrelated file would be caught even if its own
// report never mentioned it.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repositoryRoot, "plugin/bin/adw.mjs");
const PERMISSION_FILES = [".codex/config.toml", ".codex/rules/adw.rules", ".claude/settings.json"];

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function adw(command, options = [], stdin = "") {
  return spawnSync(process.execPath, [cli, command, ...options], { encoding: "utf8", input: stdin });
}

function body(result) {
  try { return JSON.parse(result.stdout); }
  catch (error) { throw new Error(`CLI did not print JSON (${error.message}): ${result.stdout}${result.stderr}`); }
}

// A digest of every tracked byte in the project, minus Git's own directory.
function snapshot(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.set(relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  visit(root);
  return files;
}

function initialize(answers, { prefix = "adw-refresh-", seed = () => {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  seed(root);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");

  const stdin = `${JSON.stringify(answers)}\n`;
  const preview = adw("init-preview", ["--project-root", root], stdin);
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const applied = adw("init-apply", ["--project-root", root, "--fingerprint", body(preview).fingerprint], stdin);
  assert.equal(applied.status, 0, applied.stdout || applied.stderr);
  return root;
}

test("a freshly initialized managed project needs no refresh and nothing is written", () => {
  const root = initialize({ isolation: "managed-devcontainer", web_access: "public-pages", runtime_versions: {} });
  const before = snapshot(root);

  const preview = adw("refresh-preview", ["--project-root", root]);
  assert.equal(preview.status, 0, preview.stdout);
  const report = body(preview);
  assert.equal(report.refresh_required, false);
  assert.deepEqual(report.writes, []);
  assert.equal(report.plugin_version, JSON.parse(readFileSync(join(repositoryRoot, "plugin/.codex-plugin/plugin.json"), "utf8")).version);

  const applied = adw("refresh-apply", ["--project-root", root, "--fingerprint", report.fingerprint]);
  assert.equal(applied.status, 0, applied.stdout);
  assert.deepEqual(body(applied).writes, []);
  assert.deepEqual(snapshot(root), before);
});

test("drifted managed bytes are reported exactly and restored exactly", () => {
  const root = initialize({ isolation: "managed-devcontainer", web_access: "public-pages", runtime_versions: {} });
  const pristine = snapshot(root);
  const projectFile = join(root, "README.md");
  writeFileSync(projectFile, "# fixture, edited by a person\n");

  const rulesPath = join(root, ".devcontainer/codex.rules");
  const settingsPath = join(root, ".devcontainer/claude-settings.json");
  writeFileSync(rulesPath, `${readFileSync(rulesPath, "utf8")}\nprefix_rule(pattern = ["rm"], decision = "allow")\n`);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  settings.sandbox.network.allowedDomains.push("evil.example.com");
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

  const report = body(adw("refresh-preview", ["--project-root", root]));
  assert.equal(report.refresh_required, true);
  assert.deepEqual(report.writes.map(({ path }) => path).sort(), [
    ".devcontainer/claude-settings.json",
    ".devcontainer/codex.rules",
  ]);
  assert.ok(report.writes.every(({ action }) => action === "repair-managed-file"));
  assert.ok(report.unchanged.includes(".devcontainer/devcontainer.json"));

  const applied = adw("refresh-apply", ["--project-root", root, "--fingerprint", report.fingerprint]);
  assert.equal(applied.status, 0, applied.stdout);
  assert.equal(body(applied).applied, true);

  const after = snapshot(root);
  // The two drifted files are back to their generated bytes; the person's own
  // edit to README.md is untouched.
  assert.equal(after.get(".devcontainer/codex.rules"), pristine.get(".devcontainer/codex.rules"));
  assert.equal(after.get(".devcontainer/claude-settings.json"), pristine.get(".devcontainer/claude-settings.json"));
  assert.equal(readFileSync(projectFile, "utf8"), "# fixture, edited by a person\n");
  const differing = [...after].filter(([path, digest]) => pristine.get(path) !== digest).map(([path]) => path);
  assert.deepEqual(differing, ["README.md"]);
});

test("refresh apply refuses a wrong or stale fingerprint and writes nothing", () => {
  const root = initialize({ isolation: "managed-devcontainer", web_access: "public-pages", runtime_versions: {} });
  const dockerfile = join(root, ".devcontainer/Dockerfile");
  writeFileSync(dockerfile, "drifted\n");
  const drifted = snapshot(root);

  const stale = body(adw("refresh-preview", ["--project-root", root])).fingerprint;
  const wrong = adw("refresh-apply", ["--project-root", root, "--fingerprint", "0".repeat(64)]);
  assert.equal(wrong.status, 2);
  assert.match(body(wrong).error.message, /fingerprint returned by the reviewed refresh preview/);
  assert.deepEqual(snapshot(root), drifted);

  // A fingerprint from a preview that no longer describes the project is just
  // as stale as a fabricated one.
  writeFileSync(join(root, ".devcontainer/allowed-domains.txt"), `${readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8")}evil.example.com\n`);
  const afterMoreDrift = snapshot(root);
  const staleResult = adw("refresh-apply", ["--project-root", root, "--fingerprint", stale]);
  assert.equal(staleResult.status, 2);
  assert.deepEqual(snapshot(root), afterMoreDrift);
});

test("refresh never rewrites adw.yaml or unrelated project files", () => {
  const root = initialize({ isolation: "managed-devcontainer", web_access: "public-pages", runtime_versions: {} }, {
    seed: (directory) => {
      writeFileSync(join(directory, "notes.md"), "project prose\n");
      writeFileSync(join(directory, "package.json"), `${JSON.stringify({ name: "fixture", private: true, scripts: { test: "node --test" } }, null, 2)}\n`);
    },
  });
  const configPath = join(root, "adw.yaml");
  const configBytes = readFileSync(configPath, "utf8");

  // Drift every managed surface at once so the refresh has real work to do.
  for (const name of ["codex.rules", "claude-settings.json", "Dockerfile", "adw-managed.json"]) {
    writeFileSync(join(root, ".devcontainer", name), "drifted\n");
  }
  for (const name of PERMISSION_FILES) writeFileSync(join(root, name), "");

  const report = body(adw("refresh-preview", ["--project-root", root]));
  assert.ok(!report.writes.some(({ path }) => path === "adw.yaml"));
  assert.ok(!report.writes.some(({ path }) => ["notes.md", "package.json", "README.md", ".gitignore"].includes(path)));

  const applied = adw("refresh-apply", ["--project-root", root, "--fingerprint", report.fingerprint]);
  assert.equal(applied.status, 0, applied.stdout);
  assert.equal(readFileSync(configPath, "utf8"), configBytes);
  assert.equal(readFileSync(join(root, "notes.md"), "utf8"), "project prose\n");
  assert.equal(readFileSync(join(root, "README.md"), "utf8"), "# fixture\n");

  const doctor = adw("doctor", ["--project-root", root]);
  const failures = body(doctor).checks.filter(({ status }) => status === "fail").map(({ id }) => id);
  assert.deepEqual(failures, ["execution:runtime"], "a repaired project is healthy apart from not running inside the container");
});

test("a provider-sandbox project refreshes only the three permission files", () => {
  const root = initialize({ isolation: "provider-sandbox" }, { prefix: "adw-refresh-sandbox-" });
  const before = snapshot(root);
  writeFileSync(join(root, ".codex/rules/adw.rules"), "");

  const report = body(adw("refresh-preview", ["--project-root", root]));
  assert.deepEqual([...report.writes.map(({ path }) => path), ...report.unchanged].sort(), [...PERMISSION_FILES].sort());
  assert.deepEqual(report.writes.map(({ path }) => path), [".codex/rules/adw.rules"]);

  const applied = adw("refresh-apply", ["--project-root", root, "--fingerprint", report.fingerprint]);
  assert.equal(applied.status, 0, applied.stdout);
  assert.deepEqual(snapshot(root), before);
});

test("an invalid adw.yaml fails the refresh contract without writing anything", () => {
  const root = initialize({ isolation: "provider-sandbox" }, { prefix: "adw-refresh-invalid-" });
  writeFileSync(join(root, ".codex/rules/adw.rules"), "");
  writeFileSync(join(root, "adw.yaml"), "adw: 1\nbogus: true\n");
  const before = snapshot(root);

  for (const command of ["refresh-preview", "refresh-apply"]) {
    const options = command === "refresh-apply" ? ["--project-root", root, "--fingerprint", "0".repeat(64)] : ["--project-root", root];
    const result = adw(command, options);
    assert.equal(result.status, 3, result.stdout);
    const error = body(result).error;
    assert.match(error.message, /^adw\.yaml is invalid: /);
    assert.match(error.message, /bogus is not a supported key/);
    assert.doesNotMatch(error.message, /compatib|migration|downgrade/i);
  }
  assert.deepEqual(snapshot(root), before);
});
