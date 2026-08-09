import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const onboardScript = join(repositoryRoot, "plugin/skills/onboard/scripts/onboard.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function projectConfiguration() {
  return [
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
    "  default:",
    "    - command: npm test",
    "      source: package.json",
    "integrations:",
    "  code_host:",
    "    provider: github",
    "    requirement: required",
    "    transport: auto",
    "    access: read-write",
    "",
  ].join("\n");
}

function fixture({ docs = true } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "adw-contributor-onboarding-"));
  const remote = join(parent, "remote.git");
  const seed = join(parent, "seed");
  const checkout = join(parent, "checkout");
  execFileSync("git", ["init", "--bare", "-q", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  git(seed, "config", "user.name", "ADW Test");
  git(seed, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(seed, "README.md"), "# Fixture\n");
  writeFileSync(join(seed, ".gitignore"), ".adw/\n/worktrees/\n");
  writeFileSync(join(seed, "adw.yaml"), projectConfiguration());
  git(seed, "add", "README.md", ".gitignore", "adw.yaml");
  git(seed, "commit", "-q", "-m", "Initialize project");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "-u", "origin", "main");
  if (docs) {
    git(seed, "switch", "--orphan", "docs");
    writeFileSync(join(seed, "architecture.md"), "# Architecture\n");
    writeFileSync(join(seed, "SYNC.yaml"), "code_branch: main\nreviewed_through: fixture\nupdated_at: null\n");
    git(seed, "add", "architecture.md", "SYNC.yaml");
    git(seed, "commit", "-q", "-m", "Initialize docs");
    git(seed, "push", "-q", "-u", "origin", "docs");
  }
  execFileSync("git", ["clone", "-q", "--branch", "main", remote, checkout]);
  git(checkout, "config", "user.name", "ADW Contributor");
  git(checkout, "config", "user.email", "contributor@example.invalid");
  return { parent, checkout };
}

function writeAnswers(parent, name, value) {
  const path = join(parent, name);
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
  return path;
}

function run(root, ...args) {
  return spawnSync(process.execPath, [onboardScript, ...args, "--project-root", root], { encoding: "utf8" });
}

test("fresh-clone onboarding attaches remote docs and writes redacted local state", () => {
  const { parent, checkout } = fixture();
  const values = ["Ada Contributor", "ada@example.invalid", "ada-account"];
  const answers = writeAnswers(parent, "answers.json", {
    schema: 1,
    identity: { display_name: values[0], email: values[1] },
    integrations: { code_host: { transport: "cli", account: values[2] } },
  });
  const before = git(checkout, "status", "--porcelain=v1", "--untracked-files=all");
  const previewResult = run(checkout, "preview", "--answers", answers);
  assert.equal(previewResult.status, 0, previewResult.stderr);
  assert.equal(git(checkout, "status", "--porcelain=v1", "--untracked-files=all"), before);
  const preview = JSON.parse(previewResult.stdout);
  assert.equal(preview.docs.action, "attach-remote");
  assert.equal(preview.docs.start_point, "refs/remotes/origin/docs");
  assert.equal(preview.local.action, "create-local");
  assert.deepEqual(preview.local.identity_fields, ["display_name", "email"]);
  assert.deepEqual(preview.local.integrations.code_host, ["account", "transport"]);
  assert.equal(preview.integrations.code_host.requirement, "required");
  assert.match(preview.preview_digest, /^[a-f0-9]{64}$/);
  for (const value of values) assert.equal(previewResult.stdout.includes(value), false);

  const stale = run(checkout, "apply", "--confirmed", "--preview-digest", "0".repeat(64), "--answers", answers);
  assert.equal(stale.status, 2);
  assert.equal(existsSync(join(checkout, ".adw/local.yaml")), false);

  const applied = run(checkout, "apply", "--confirmed", "--preview-digest", preview.preview_digest, "--answers", answers);
  assert.equal(applied.status, 0, applied.stderr);
  const local = readFileSync(join(checkout, ".adw/local.yaml"), "utf8");
  for (const value of values) assert.equal(local.includes(value), true);
  const worktrees = git(checkout, "worktree", "list", "--porcelain");
  assert.match(worktrees, /branch refs\/heads\/docs/);
  assert.equal(git(checkout, "config", "branch.docs.remote"), "origin");
  assert.equal(git(checkout, "rev-parse", "docs"), git(checkout, "rev-parse", "refs/remotes/origin/docs"));
  assert.equal(git(checkout, "status", "--porcelain=v1", "--untracked-files=all"), "");

  const repeated = JSON.parse(run(checkout, "preview", "--answers", answers).stdout);
  assert.equal(repeated.docs.action, "reuse");
  assert.equal(repeated.local.action, "unchanged");
});

test("existing local settings require explicit replacement", () => {
  const { parent, checkout } = fixture();
  const first = writeAnswers(parent, "first.json", {
    schema: 1,
    identity: { display_name: "First Person", email: "first@example.invalid" },
  });
  const firstPreview = JSON.parse(run(checkout, "preview", "--answers", first).stdout);
  assert.equal(run(checkout, "apply", "--confirmed", "--preview-digest", firstPreview.preview_digest, "--answers", first).status, 0);
  const before = readFileSync(join(checkout, ".adw/local.yaml"), "utf8");

  const replacement = writeAnswers(parent, "replacement.json", {
    schema: 1,
    identity: { display_name: "Second Person" },
  });
  const replacementPreview = JSON.parse(run(checkout, "preview", "--answers", replacement).stdout);
  assert.equal(replacementPreview.local.action, "update-local");
  const refused = run(checkout, "apply", "--confirmed", "--preview-digest", replacementPreview.preview_digest, "--answers", replacement);
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /requires --replace-local/);
  assert.equal(readFileSync(join(checkout, ".adw/local.yaml"), "utf8"), before);

  const replaced = run(checkout, "apply", "--confirmed", "--replace-local", "--preview-digest", replacementPreview.preview_digest, "--answers", replacement);
  assert.equal(replaced.status, 0, replaced.stderr);
  const after = readFileSync(join(checkout, ".adw/local.yaml"), "utf8");
  assert.match(after, /Second Person/);
  assert.doesNotMatch(after, /First Person|first@example\.invalid/);
});

test("onboarding refuses missing docs branches and secret-like answers", () => {
  const missing = fixture({ docs: false });
  const ordinary = writeAnswers(missing.parent, "answers.json", { schema: 1, identity: { display_name: "Contributor" } });
  const missingResult = run(missing.checkout, "preview", "--answers", ordinary);
  assert.equal(missingResult.status, 2);
  assert.match(missingResult.stderr, /no local or remote-tracking docs branch is available/);
  assert.equal(existsSync(join(missing.checkout, ".adw/local.yaml")), false);
  assert.equal(git(missing.checkout, "branch", "--list", "docs"), "");

  const configured = fixture();
  const secret = writeAnswers(configured.parent, "secret.json", { schema: 1, api_token: "forbidden" });
  const secretResult = run(configured.checkout, "preview", "--answers", secret);
  assert.equal(secretResult.status, 2);
  assert.match(secretResult.stderr, /credential-like keys are forbidden/);

  const disabled = writeAnswers(configured.parent, "disabled.json", {
    schema: 1,
    integrations: { observability: { transport: "api" } },
  });
  const disabledResult = run(configured.checkout, "preview", "--answers", disabled);
  assert.equal(disabledResult.status, 2);
  assert.match(disabledResult.stderr, /requires an enabled observability integration/);
});

test("onboarding refuses tracked personal state and an unignored docs worktree", () => {
  const tracked = fixture();
  mkdirSync(join(tracked.checkout, ".adw"));
  writeFileSync(join(tracked.checkout, ".adw/local.yaml"), "schema: 1\nidentity:\n  email: committed@example.invalid\n");
  git(tracked.checkout, "add", "-f", ".adw/local.yaml");
  git(tracked.checkout, "commit", "-q", "-m", "Track forbidden ADW local state");
  const trackedAnswers = writeAnswers(tracked.parent, "tracked.json", { schema: 1, identity: { display_name: "Contributor" } });
  const trackedResult = run(tracked.checkout, "preview", "--answers", trackedAnswers);
  assert.equal(trackedResult.status, 2);
  assert.match(trackedResult.stderr, /.adw\/local.yaml is tracked by Git/);

  const unignored = fixture();
  writeFileSync(join(unignored.checkout, ".gitignore"), ".adw/\n");
  git(unignored.checkout, "add", ".gitignore");
  git(unignored.checkout, "commit", "-q", "-m", "Remove worktree ignore");
  const unignoredAnswers = writeAnswers(unignored.parent, "unignored.json", { schema: 1 });
  const unignoredResult = run(unignored.checkout, "preview", "--answers", unignoredAnswers);
  assert.equal(unignoredResult.status, 2);
  assert.match(unignoredResult.stderr, /worktrees\/docs is not ignored by Git/);
});
