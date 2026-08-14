import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const doctorScript = join(repositoryRoot, "plugin/skills/doctor/scripts/snapshot.mjs");
const updateScript = join(repositoryRoot, "plugin/skills/update/scripts/update.mjs");
const statusScript = join(repositoryRoot, "plugin/skills/status/scripts/snapshot.mjs");

const LEGACY_CONFIG = [
  "schema: 5",
  "git:",
  "  default_branch: main",
  "documentation:",
  "  mode: branch",
  "  branch: docs",
  "  worktree: worktrees/docs",
  "  sync_marker: SYNC.yaml",
  "  delivery: direct-push",
  "execution:",
  "  isolation: provider-sandbox",
  "  enforcement: preferred",
  "  permissions:",
  "    profile: managed-development",
  "components:",
  "  app:",
  "    path: .",
  "validation:",
  "  default: []",
  "",
].join("\n");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

// Every file's exact bytes, so "changed nothing" is proven rather than asserted.
function fingerprint(root) {
  const entries = [];
  function visit(current) {
    for (const name of readdirSync(current).sort()) {
      if (name === ".git") continue;
      const path = join(current, name);
      if (statSync(path).isDirectory()) visit(path);
      else entries.push(`${relative(root, path)}\0${readFileSync(path, "utf8")}`);
    }
  }
  visit(root);
  return entries.join("\n");
}

function legacyProject() {
  const root = mkdtempSync(join(tmpdir(), "adw-legacy-0.6-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Legacy Test");
  git(root, "config", "user.email", "legacy@example.invalid");
  writeFileSync(join(root, "adw.yaml"), LEGACY_CONFIG);
  // A partly finished 0.6 change whose history must survive untouched.
  mkdirSync(join(root, "changes/tenant-throttling"), { recursive: true });
  writeFileSync(join(root, "changes/tenant-throttling/spec.md"), "# Change: tenant-throttling\n");
  writeFileSync(join(root, "changes/tenant-throttling/plan.yaml"), "schema: 2\nchange_id: tenant-throttling\n");
  writeFileSync(join(root, "changes/tenant-throttling/approval.json"), '{"schema":2,"status":"active"}\n');
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "0.6 project");
  return root;
}

function run(script, ...args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test("doctor names the superseded 0.6 contract, cites the transition guide, and changes nothing", () => {
  const root = legacyProject();
  const before = fingerprint(root);
  const head = git(root, "rev-parse", "HEAD");

  const doctor = run(doctorScript, "--project-root", root);
  assert.equal(doctor.status, 1, doctor.stderr || doctor.stdout);
  const snapshot = JSON.parse(doctor.stdout);
  assert.equal(snapshot.read_only, true);

  const legacy = snapshot.checks.find(({ id }) => id === "project-contract:legacy-0.6");
  assert.ok(legacy, `doctor must emit a dedicated legacy check, got ${snapshot.checks.map(({ id }) => id).join(", ")}`);
  assert.equal(legacy.status, "fail");
  assert.match(legacy.summary, /0\.6 project contract/);
  assert.match(legacy.summary, /adw: 1/);
  assert.equal(legacy.detected_schema, 5);
  assert.equal(legacy.transition_guide, "docs/migrating-from-0.6.md");
  assert.equal(legacy.read_only, true);
  assert.ok(legacy.next_steps.length >= 2);
  assert.ok(legacy.next_steps.some((step) => /migrating-from-0\.6/.test(step)));

  // The diagnosis stops before checks that assume the current contract, and it
  // must never propose or perform a translation.
  const serialized = JSON.stringify(snapshot);
  assert.doesNotMatch(serialized, /translat|rewrit|convert|migrated/i);

  assert.equal(fingerprint(root), before, "doctor must not modify a 0.6 project");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("the transition guide documents both supported upgrade paths", () => {
  const guide = readFileSync(join(repositoryRoot, "docs/migrating-from-0.6.md"), "utf8");
  assert.match(guide, /Finish active work on 0\.6/i);
  assert.match(guide, /Preserve 0\.6 artifacts as history and reinitialize/i);
  assert.match(guide, /no migration (?:framework|subsystem)/i);
  for (const mapping of ["schema: 5", "adw: 1", "plan.yaml", "plan.md", "integrations.yaml", "runs/", "default_branch", "base_branch"]) {
    assert.ok(guide.includes(mapping), `transition guide omits ${mapping}`);
  }
});

test("update and status refuse a 0.6 project without writing or reinterpreting it", () => {
  const root = legacyProject();
  const before = fingerprint(root);

  const update = run(updateScript, "preview", "--project-root", root);
  assert.equal(update.status, 2, update.stdout);
  const failure = JSON.parse(update.stderr);
  assert.equal(failure.ok, false);
  assert.doesNotMatch(JSON.stringify(failure), /compatib|migration|downgrade/i);
  assert.deepEqual(failure.writes ?? [], []);

  const status = run(statusScript, "--project-root", root);
  const body = JSON.parse(status.stdout);
  assert.equal(body.read_only, true);
  assert.equal(body.config.valid, false, "status must report the 0.6 contract as unreadable, not silently reinterpret it");
  assert.ok(body.config.errors.length > 0);

  assert.equal(fingerprint(root), before, "no 0.6 workflow evidence may be rewritten");
  assert.equal(existsSync(join(root, "changes/tenant-throttling/plan.yaml")), true, "historical artifacts remain as history");
});
