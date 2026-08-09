import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createApproval, createApprovalBundle, recordValidation } from "../../plugin/lib/adw-helper.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const initScript = join(repositoryRoot, "plugin/skills/init/scripts/init.mjs");
const doctorScript = join(repositoryRoot, "plugin/skills/doctor/scripts/snapshot.mjs");
const statusScript = join(repositoryRoot, "plugin/skills/status/scripts/snapshot.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function run(script, root, expectedStatus = 0) {
  const result = spawnSync(process.execPath, [script, "--project-root", root], { encoding: "utf8", env: { ...process.env, ADW_MANAGED_DEVCONTAINER: "1" } });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "adw-status-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "# Fixture\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  const initialized = spawnSync(process.execPath, [initScript, "apply", "--project-root", root, "--confirmed"], { encoding: "utf8" });
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);
  return root;
}

function fingerprint(root) {
  const hash = createHash("sha256");
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (name === ".git") continue;
      const path = join(directory, name);
      const rel = relative(root, path);
      const stat = statSync(path);
      hash.update(`${stat.isDirectory() ? "d" : "f"}:${rel}\0`);
      if (stat.isDirectory()) visit(path);
      else hash.update(readFileSync(path));
    }
  }
  visit(root);
  return hash.digest("hex");
}

test("doctor and status reconstruct initialized state without writes", async () => {
  const root = fixture();
  const docs = join(root, "worktrees/docs");
  const change = join(docs, "changes/sample-change");
  mkdirSync(change, { recursive: true });
  const spec = "# Change: sample-change\n\nApproved behavior.\n";
  const plan = "schema: 1\nchange_id: sample-change\nsummary: Test\ntasks: []\ndocumentation:\n  impact: none\n  files: []\n";
  writeFileSync(join(change, "spec.md"), spec);
  writeFileSync(join(change, "plan.yaml"), plan);
  git(docs, "add", "changes/sample-change/spec.md", "changes/sample-change/plan.yaml");
  git(docs, "commit", "-q", "-m", "Plan sample change");
  const planCommit = git(docs, "rev-parse", "HEAD");
  const approval = createApprovalBundle({
    approver: "test-user",
    approved_at: "2026-08-05T12:00:00Z",
    plugin_version: "0.1.0",
    docs_commit: planCommit,
    inputs: [
      { path: "spec.md", content: spec },
      { path: "plan.yaml", content: plan },
    ],
  });
  writeFileSync(join(change, "approval.json"), `${JSON.stringify(approval, null, 2)}\n`);
  git(docs, "add", "changes/sample-change/approval.json");
  git(docs, "commit", "-q", "-m", "Approve sample change");
  const approvalCommit = git(docs, "rev-parse", "HEAD");
  const validation = recordValidation({
    change_id: "sample-change",
    plugin_version: "0.1.0",
    code_commit: git(root, "rev-parse", "HEAD"),
    docs_commit: approvalCommit,
    recorded_at: "2026-08-05T12:05:00Z",
    commands: [{ command: "npm test", cwd: ".", exit_code: 0, duration_ms: 10, summary: "passed", required: true }],
  });
  writeFileSync(join(change, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  git(docs, "add", "changes/sample-change/validation.json");
  git(docs, "commit", "-q", "-m", "Validate sample change");

  const beforeFingerprint = fingerprint(root);
  const codeStatusBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");
  const docsStatusBefore = git(docs, "status", "--porcelain=v1", "--untracked-files=all");
  const doctor = run(doctorScript, root);
  const status = run(statusScript, root);
  assert.equal(doctor.read_only, true);
  assert.equal(doctor.checks.find(({ id }) => id === "plugin").status, "pass");
  assert.equal(doctor.checks.find(({ id }) => id === "docs-worktree").status, "pass");
  assert.equal(status.read_only, true);
  assert.equal(status.execution.isolation, "managed-devcontainer");
  assert.equal(status.execution.permissions.profile, "managed-development");
  assert.deepEqual(status.execution.permissions.provider_artifacts, { codex: true, claude: true });
  assert.equal(status.execution.active, true);
  assert.equal(status.docs.attached, true);
  assert.equal(status.changes.length, 1);
  assert.equal(status.changes[0].approval.state, "active");
  assert.equal(status.changes[0].validation.state, "passed");
  assert.equal(status.changes[0].state, "validated");
  assert.equal(status.draft_prs.state, "not-queried");
  assert.equal(status.pull_requests.state, "not-queried");
  assert.equal(fingerprint(root), beforeFingerprint);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), codeStatusBefore);
  assert.equal(git(docs, "status", "--porcelain=v1", "--untracked-files=all"), docsStatusBefore);
});

test("status reports an approval stale when exact plan bytes change", () => {
  const root = fixture();
  const change = join(root, "worktrees/docs/changes/stale-change");
  mkdirSync(change, { recursive: true });
  const spec = "spec bytes\n";
  const plan = "plan bytes\n";
  writeFileSync(join(change, "spec.md"), spec);
  writeFileSync(join(change, "plan.yaml"), plan);
  const docsCommit = git(root, "-C", join(root, "worktrees/docs"), "rev-parse", "HEAD");
  const approval = createApproval({ approver: "test", approved_at: "2026-08-05T12:00:00Z", plugin_version: "0.1.0", docs_commit: docsCommit, spec, plan });
  writeFileSync(join(change, "approval.json"), JSON.stringify(approval));
  writeFileSync(join(change, "plan.yaml"), "changed plan bytes\n");
  const status = run(statusScript, root);
  assert.equal(status.changes[0].approval.state, "invalid");
  assert.equal(status.changes[0].approval.reason, "approval digest is stale");
  assert.equal(status.changes[0].state, "planned");
});
