import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const syncScript = join(repositoryRoot, "plugin/skills/sync-docs/scripts/sync-docs.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function run(root, args, expected = 0, env) {
  const result = spawnSync(process.execPath, [syncScript, ...args, "--project-root", root], {
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
  });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

const PROJECT_CONFIG = [
  "adw: 1",
  "",
  "git:",
  "  base_branch: main",
  "",
  "docs:",
  "  branch: docs",
  "  worktree: worktrees/docs",
  "  sync_marker: SYNC.yaml",
  "",
  "execution:",
  "  mode: sequential",
  "  max_parallel: 1",
  "  isolation: provider-sandbox",
  "",
  "components:",
  "  app:",
  "    path: .",
  "    validate:",
  "      - command: npm test",
  "        source: package.json#scripts.test",
  "",
].join("\n");

function fixture({ remote = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "adw-docs-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, ".gitignore"), "/worktrees/\n");
  writeFileSync(join(root, "README.md"), "# Authoritative project docs\n");
  writeFileSync(join(root, "adw.yaml"), PROJECT_CONFIG);
  writeFileSync(join(root, "app.js"), "export const value = 1;\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "initial code");
  const reviewed = git(root, "rev-parse", "HEAD");
  mkdirSync(join(root, "worktrees"));
  git(root, "worktree", "add", "--orphan", "-b", "docs", join(root, "worktrees/docs"));
  const docs = join(root, "worktrees/docs");
  writeFileSync(join(docs, "README.md"), "# Protected docs records\n");
  writeFileSync(join(docs, "architecture.md"), "# Architecture\n\nOld context.\n");
  mkdirSync(join(docs, "components"));
  writeFileSync(join(docs, "components/app.md"), "# App\n\nOld component context.\n");
  mkdirSync(join(docs, "changes/tenant-throttling/approval-history"), { recursive: true });
  mkdirSync(join(docs, "changes/tenant-throttling/runs"), { recursive: true });
  writeFileSync(join(docs, "changes/tenant-throttling/plan.md"), "# PART 1 — Feature Overview\n\nApproved intent.\n");
  writeFileSync(join(docs, "changes/tenant-throttling/approval.json"), `${JSON.stringify({ version: 1, change_id: "tenant-throttling", status: "active" })}\n`);
  writeFileSync(join(docs, "changes/tenant-throttling/approval-history/old.json"), `${JSON.stringify({ version: 1, status: "superseded" })}\n`);
  writeFileSync(join(docs, "changes/tenant-throttling/runs/foundations.json"), `${JSON.stringify({ version: 1, status: "passed" })}\n`);
  writeFileSync(join(docs, "SYNC.yaml"), `code_branch: main\nreviewed_through: ${reviewed}\nupdated_at: null\n`);
  git(docs, "add", ".");
  git(docs, "commit", "-q", "-m", "docs baseline");
  let remoteRoot;
  if (remote) {
    remoteRoot = mkdtempSync(join(tmpdir(), "adw-docs-origin-"));
    git(remoteRoot, "init", "-q", "--bare");
    git(root, "remote", "add", "origin", remoteRoot);
    git(root, "push", "-q", "-u", "origin", "main");
    git(docs, "push", "-q", "-u", "origin", "docs");
  }
  writeFileSync(join(root, "app.js"), "export const value = 2;\n");
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/api.md"), "# API\n\nAuthoritative detail.\n");
  git(root, "add", "app.js", "docs/api.md");
  git(root, "commit", "-q", "-m", "change app and public docs");
  return { root, docs, remoteRoot };
}

function proposal(files) {
  const path = join(mkdtempSync(join(tmpdir(), "adw-docs-proposal-")), "proposal.json");
  writeFileSync(path, JSON.stringify({ files }));
  return path;
}

function durableRecords(docs) {
  return {
    plan: readFileSync(join(docs, "changes/tenant-throttling/plan.md"), "utf8"),
    approval: readFileSync(join(docs, "changes/tenant-throttling/approval.json"), "utf8"),
    history: readFileSync(join(docs, "changes/tenant-throttling/approval-history/old.json"), "utf8"),
    run: readFileSync(join(docs, "changes/tenant-throttling/runs/foundations.json"), "utf8"),
  };
}

test("sync-docs reports drift read-only against the adw: 1 contract", () => {
  const { root, docs } = fixture();
  const before = {
    codeHead: git(root, "rev-parse", "HEAD"),
    docsHead: git(docs, "rev-parse", "HEAD"),
    architecture: readFileSync(join(docs, "architecture.md"), "utf8"),
    marker: readFileSync(join(docs, "SYNC.yaml"), "utf8"),
  };

  const report = JSON.parse(run(root, ["report"]).stdout);
  assert.equal(report.read_only, true);
  assert.equal(report.drift, true);
  assert.equal(report.code_branch, "main");
  assert.equal(report.code_head, before.codeHead);
  assert.deepEqual(report.allowed_context_targets, ["architecture.md", "components/*.md"]);
  assert.deepEqual(report.authoritative_docs, ["docs/api.md"]);

  const categories = new Map(report.changes.map(({ path, category }) => [path, category]));
  assert.deepEqual([...categories.keys()].sort(), ["app.js", "docs/api.md"]);
  assert.equal(categories.get("app.js"), "component:app");
  assert.equal(categories.get("docs/api.md"), "authoritative-documentation");

  assert.equal(git(root, "rev-parse", "HEAD"), before.codeHead);
  assert.equal(git(docs, "rev-parse", "HEAD"), before.docsHead);
  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), before.architecture);
  assert.equal(readFileSync(join(docs, "SYNC.yaml"), "utf8"), before.marker);
  assert.equal(git(docs, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("sync-docs refuses unauthorized, out-of-scope, and stale proposals", () => {
  const { root, docs } = fixture();
  const architecture = readFileSync(join(docs, "architecture.md"), "utf8");
  const records = durableRecords(docs);
  const rewrite = "# Architecture\n\nConcise map; see the code branch docs/api.md for authoritative API detail.\n";

  const valid = proposal([{ path: "architecture.md", expected_content: architecture, content: rewrite }]);
  assert.match(run(root, ["fix", "--proposal", valid], 2).stderr, /requires --authorized/);
  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), architecture);

  for (const path of [
    "changes/tenant-throttling/plan.md",
    "changes/tenant-throttling/approval.json",
    "changes/tenant-throttling/approval-history/old.json",
    "changes/tenant-throttling/runs/foundations.json",
    "README.md",
    "SYNC.yaml",
    "components/nested/app.md",
  ]) {
    const refused = proposal([{ path, expected_content: null, content: "rewritten\n" }]);
    assert.match(run(root, ["fix", "--authorized", "--proposal", refused], 2).stderr, /protected documentation path/, path);
  }
  const escape = proposal([{ path: "../adw.yaml", expected_content: null, content: "adw: 1\n" }]);
  assert.match(run(root, ["fix", "--authorized", "--proposal", escape], 2).stderr, /escapes docs worktree/);

  const stale = proposal([{ path: "architecture.md", expected_content: "# Architecture\n\nNever what the file held.\n", content: rewrite }]);
  assert.match(run(root, ["fix", "--authorized", "--proposal", stale], 2).stderr, /precondition failed for architecture\.md/);

  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), architecture);
  assert.deepEqual(durableRecords(docs), records);
  assert.equal(git(docs, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("an authorized fix updates only context files and the SYNC marker", () => {
  const { root, docs } = fixture();
  const codeHead = git(root, "rev-parse", "HEAD");
  const docsHead = git(docs, "rev-parse", "HEAD");
  const records = durableRecords(docs);
  const architecture = readFileSync(join(docs, "architecture.md"), "utf8");
  const component = readFileSync(join(docs, "components/app.md"), "utf8");

  const path = proposal([
    { path: "architecture.md", expected_content: architecture, content: "# Architecture\n\nRefreshed map.\n" },
    { path: "components/app.md", expected_content: component, content: "# App\n\nRefreshed component context.\n" },
    { path: "components/worker.md", expected_content: null, content: "# Worker\n\nNew component context.\n" },
  ]);
  const fixed = JSON.parse(run(root, ["fix", "--authorized", "--proposal", path]).stdout);

  assert.equal(fixed.read_only, false);
  assert.equal(fixed.committed, false);
  assert.equal(fixed.pushed, false);
  assert.deepEqual(fixed.written, ["architecture.md", "components/app.md", "components/worker.md", "SYNC.yaml"]);

  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), "# Architecture\n\nRefreshed map.\n");
  assert.equal(readFileSync(join(docs, "components/app.md"), "utf8"), "# App\n\nRefreshed component context.\n");
  assert.equal(readFileSync(join(docs, "components/worker.md"), "utf8"), "# Worker\n\nNew component context.\n");

  const marker = readFileSync(join(docs, "SYNC.yaml"), "utf8");
  assert.match(marker, new RegExp(`^reviewed_through: "${codeHead}"$`, "m"));
  assert.match(marker, /^code_branch: "main"$/m);
  assert.match(marker, /^updated_at: "\d{4}-\d{2}-\d{2}T[\d:.]+Z"$/m);

  assert.deepEqual(durableRecords(docs), records);
  assert.equal(git(docs, "rev-parse", "HEAD"), docsHead, "an authorized fix must not commit on its own");
  assert.equal(git(root, "rev-parse", "HEAD"), codeHead);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), "");
});

test("an authorized push commits the reviewed proposal and never forces", () => {
  const { root, docs, remoteRoot } = fixture({ remote: true });
  const codeHead = git(root, "rev-parse", "HEAD");
  const records = durableRecords(docs);
  const architecture = readFileSync(join(docs, "architecture.md"), "utf8");

  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  assert.ok(realGit, "git must be discoverable for the invocation shim");
  const shimDirectory = mkdtempSync(join(tmpdir(), "adw-docs-shim-"));
  const log = join(shimDirectory, "git-invocations.log");
  writeFileSync(join(shimDirectory, "git"), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\nexec ${JSON.stringify(realGit)} "$@"\n`, { mode: 0o755 });
  writeFileSync(log, "");

  const path = proposal([{ path: "architecture.md", expected_content: architecture, content: "# Architecture\n\nPushed map.\n" }]);
  const fixed = JSON.parse(run(root, ["fix", "--authorized", "--push-authorized", "--proposal", path], 0, { PATH: `${shimDirectory}:${process.env.PATH}` }).stdout);

  assert.equal(fixed.committed, true);
  assert.equal(fixed.pushed, true);
  assert.equal(fixed.docs_commit, git(docs, "rev-parse", "HEAD"));
  assert.equal(git(docs, "rev-parse", "HEAD"), git(remoteRoot, "rev-parse", "refs/heads/docs"));
  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), "# Architecture\n\nPushed map.\n");
  assert.match(readFileSync(join(docs, "SYNC.yaml"), "utf8"), new RegExp(`^reviewed_through: "${codeHead}"$`, "m"));
  assert.deepEqual(durableRecords(docs), records);
  assert.equal(git(root, "rev-parse", "HEAD"), codeHead);

  const invocations = readFileSync(log, "utf8").split("\n").filter(Boolean);
  const pushes = invocations.filter((line) => /(?:^|\s)push(?:\s|$)/.test(line));
  assert.equal(pushes.length, 1, `expected exactly one push, saw: ${JSON.stringify(pushes)}`);
  for (const line of pushes) {
    assert.doesNotMatch(line, /--force|--force-with-lease|(?:^|\s)-f(?:\s|$)|(?:^|\s)\+/, `push must never force: ${line}`);
    assert.match(line, /push origin docs:docs$/);
  }
  assert.equal(invocations.filter((line) => /--force/.test(line)).length, 0);
});

test("sync-docs classifies common nested manifests, lockfiles, and build files", () => {
  const { root } = fixture();
  const files = {
    "package-lock.json": "{}\n",
    "services/api/go.mod": "module example.invalid/api\n\ngo 1.23\n",
    "services/api/requirements-dev.txt": "pytest==8.3.5\n",
    "packages/web/pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
    "packages/web/pom.xml": "<project/>\n",
    "src/Widget.csproj": "<Project/>\n",
  };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "add build manifests");

  const report = JSON.parse(run(root, ["report"]).stdout);
  const categories = new Map(report.changes.map(({ path, category }) => [path, category]));
  for (const path of Object.keys(files)) assert.equal(categories.get(path), "manifest-or-build", path);
});

test("sync-docs stops on dirty and non-fast-forward worktrees", () => {
  const dirty = fixture();
  writeFileSync(join(dirty.root, "app.js"), "dirty\n");
  assert.match(run(dirty.root, ["report"], 2).stderr, /code worktree is dirty/);
  git(dirty.root, "restore", "app.js");
  writeFileSync(join(dirty.docs, "architecture.md"), "dirty docs\n");
  assert.match(run(dirty.root, ["report"], 2).stderr, /docs worktree is dirty/);

  const diverged = fixture({ remote: true });
  const other = mkdtempSync(join(tmpdir(), "adw-docs-other-"));
  git(other, "clone", "-q", "--branch", "docs", diverged.remoteRoot, ".");
  git(other, "config", "user.name", "Remote Test");
  git(other, "config", "user.email", "remote@example.invalid");
  writeFileSync(join(other, "architecture.md"), "# Remote architecture\n");
  git(other, "add", "architecture.md");
  git(other, "commit", "-q", "-m", "remote docs update");
  git(other, "push", "-q", "origin", "docs");
  git(diverged.root, "fetch", "-q", "origin", "docs");
  assert.match(run(diverged.root, ["report"], 2).stderr, /behind or diverged/);
});

test("sync-docs refuses a project contract it cannot read", () => {
  const { root } = fixture();
  writeFileSync(join(root, "adw.yaml"), PROJECT_CONFIG.replace("adw: 1", "schema: 99"));
  git(root, "add", "adw.yaml");
  git(root, "commit", "-q", "-m", "unreadable configuration");
  const failure = run(root, ["report"], 2).stderr;
  assert.match(failure, /adw\.yaml is invalid/);
  assert.match(failure, /\/adw/);
});
