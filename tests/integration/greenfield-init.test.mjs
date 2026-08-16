import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const initScript = join(repositoryRoot, "plugin/initialization/init.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function run(root, answers, action, previewDigest = null, execution = null) {
  const args = [initScript, action, "--kind", "greenfield", "--project-root", root, "--onboarding", answers];
  if (execution) args.push("--execution", execution);
  if (action === "apply") args.push("--confirmed", "--preview-digest", previewDigest);
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

function fixture({ managed = false } = {}) {
  const sandbox = mkdtempSync(join(tmpdir(), "adw-greenfield-"));
  const root = join(sandbox, "project");
  mkdirSync(root);
  const answers = join(sandbox, "answers.json");
  writeFileSync(answers, `${JSON.stringify({
    schema: 1,
    greenfield: {
      name: "Example Project",
      problem: "Teams cannot review example data consistently.",
      users: "Small engineering teams",
      mvp: "A user can submit one record and receive a deterministic review.",
      shape: "One application with a command-line entry point",
      non_goals: ["Hosted multi-tenancy"],
      constraints: ["Keep validation non-interactive"],
    },
    execution: { mode: "orchestrated", isolation: managed ? "managed-devcontainer" : "provider-sandbox" },
    development: { runtime_versions: managed ? { python: "3.13" } : {} },
    providers: {},
    conventions: {},
    local: {},
  }, null, 2)}\n`);
  return { root, answers };
}

test("greenfield initialization creates Git, a seed contract, first main commit, and docs branch", () => {
  const { root, answers } = fixture();
  const previewResult = run(root, answers, "preview");
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  assert.equal(preview.kind, "greenfield");
  assert.deepEqual(preview.git, { action: "create", base_branch: "main", author_identity: "configured" });
  assert.ok(preview.docs.generated_files.includes("SYNC.yaml"));
  assert.ok(preview.docs.generated_files.includes("changes/.gitkeep"));
  assert.equal(existsSync(join(root, ".git")), false, "preview must not initialize Git");

  const applyResult = run(root, answers, "apply", preview.preview_digest);
  assert.equal(applyResult.status, 0, applyResult.stderr);
  const applied = JSON.parse(applyResult.stdout);
  assert.match(applied.git.commit, /^[0-9a-f]{40}$/);
  assert.match(applied.next_steps[0], /first main-branch commit is ready/i);
  assert.doesNotMatch(applied.setup_guidance.preview_safety, /has not changed/);
  assert.equal(git(root, "branch", "--show-current"), "main");
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
  assert.match(readFileSync(join(root, "PROJECT.md"), "utf8"), /## MVP outcome/);
  assert.equal(readFileSync(join(root, "Makefile"), "utf8"), ".PHONY: check\n\ncheck:\n\t@test -s PROJECT.md\n");
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /command: "make check"[\s\S]*source: "Makefile#target:check"/);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /planning:\n  default_template: standard/);
  assert.deepEqual(
    readFileSync(join(root, "adw/plan-templates/standard.md")),
    readFileSync(join(repositoryRoot, "plugin/templates/plan.md")),
  );
  assert.equal(git(join(root, "worktrees/docs"), "branch", "--show-current"), "docs");
  assert.match(readFileSync(join(root, "worktrees/docs/architecture.md"), "utf8"), /explicitly reviewed project contract/);
  assert.equal(git(join(root, "worktrees/docs"), "diff-tree", "--check", "--root", "--no-commit-id", "HEAD"), "");

  const repeatedGreenfield = run(root, answers, "preview");
  assert.equal(repeatedGreenfield.status, 2);
  assert.match(repeatedGreenfield.stderr, /requires an empty directory/);

  const brownfield = spawnSync(process.execPath, [initScript, "preview", "--kind", "brownfield", "--project-root", root], { encoding: "utf8" });
  assert.equal(brownfield.status, 0, brownfield.stderr);
  assert.equal(JSON.parse(brownfield.stdout).docs.action, "reuse");
});

test("managed greenfield initialization installs an explicitly chosen runtime without a manifest", () => {
  const { root, answers } = fixture({ managed: true });
  const previewResult = run(root, answers, "preview", null, "managed-devcontainer");
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  assert.equal(preview.development_environment.selected_versions.python, "3.13");

  const applyResult = run(root, answers, "apply", preview.preview_digest, "managed-devcontainer");
  assert.equal(applyResult.status, 0, applyResult.stderr);
  const devcontainer = JSON.parse(readFileSync(join(root, ".devcontainer/devcontainer.json"), "utf8"));
  assert.equal(devcontainer.features["ghcr.io/devcontainers/features/python:1"].version, "3.13");
});

test("greenfield initialization normalizes an unborn repository to main", () => {
  const { root, answers } = fixture();
  git(root, "init", "-q", "-b", "legacy-default");
  const previewResult = run(root, answers, "preview");
  assert.equal(previewResult.status, 0, previewResult.stderr);
  const preview = JSON.parse(previewResult.stdout);
  assert.deepEqual(preview.git, { action: "reuse-unborn", base_branch: "main", author_identity: "configured" });

  const applyResult = run(root, answers, "apply", preview.preview_digest);
  assert.equal(applyResult.status, 0, applyResult.stderr);
  assert.equal(git(root, "branch", "--show-current"), "main");
});
