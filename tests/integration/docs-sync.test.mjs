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

function run(root, args, expected = 0) {
  const result = spawnSync(process.execPath, [syncScript, ...args, "--project-root", root], { encoding: "utf8" });
  assert.equal(result.status, expected, result.stderr || result.stdout);
  return result;
}

function fixture({ remote = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "adw-docs-"));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, ".gitignore"), "/worktrees/\n");
  writeFileSync(join(root, "README.md"), "# Authoritative project docs\n");
  writeFileSync(join(root, "adw.yaml"), [
    "schema: 5", "", "git:", "  default_branch: main", "", "documentation:",
    "  mode: branch", "  branch: docs", "  worktree: worktrees/docs", "  sync_marker: SYNC.yaml", "  delivery: direct-push",
    "", "execution:", "  isolation: provider-sandbox", "  enforcement: preferred", "  permissions:", "    profile: managed-development",
    "", "components:", "  app:", "    path: .", "", "validation:", "  default:", "    - npm test", "",
  ].join("\n"));
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
  mkdirSync(join(docs, "changes/accepted"), { recursive: true });
  writeFileSync(join(docs, "changes/accepted/spec.md"), "accepted intent\n");
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

test("sync-docs reports drift without writes and protects authoritative records during an authorized push", () => {
  const { root, docs, remoteRoot } = fixture({ remote: true });
  const before = {
    codeHead: git(root, "rev-parse", "HEAD"),
    docsHead: git(docs, "rev-parse", "HEAD"),
    architecture: readFileSync(join(docs, "architecture.md"), "utf8"),
    history: readFileSync(join(docs, "changes/accepted/spec.md"), "utf8"),
    authoritative: readFileSync(join(root, "docs/api.md"), "utf8"),
  };
  const reportResult = run(root, ["report"]);
  const report = JSON.parse(reportResult.stdout);
  assert.equal(report.read_only, true);
  assert.equal(report.drift, true);
  assert.deepEqual(report.authoritative_docs, ["docs/api.md"]);
  assert.equal(git(root, "rev-parse", "HEAD"), before.codeHead);
  assert.equal(git(docs, "rev-parse", "HEAD"), before.docsHead);
  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), before.architecture);

  const proposalPath = join(mkdtempSync(join(tmpdir(), "adw-docs-proposal-")), "proposal.json");
  writeFileSync(proposalPath, JSON.stringify({ files: [{
    path: "architecture.md",
    expected_content: before.architecture,
    content: "# Architecture\n\nConcise map; see ../docs/api.md for authoritative API detail.\n",
  }] }));
  run(root, ["fix", "--proposal", proposalPath], 2);
  assert.equal(readFileSync(join(docs, "architecture.md"), "utf8"), before.architecture);

  const protectedProposal = join(mkdtempSync(join(tmpdir(), "adw-docs-protected-")), "proposal.json");
  writeFileSync(protectedProposal, JSON.stringify({ files: [{
    path: "changes/accepted/spec.md",
    expected_content: before.history,
    content: "rewritten history\n",
  }] }));
  assert.match(run(root, ["fix", "--authorized", "--proposal", protectedProposal], 2).stderr, /protected documentation path/);
  assert.equal(readFileSync(join(docs, "changes/accepted/spec.md"), "utf8"), before.history);

  const fixed = JSON.parse(run(root, ["fix", "--authorized", "--push-authorized", "--proposal", proposalPath]).stdout);
  assert.equal(fixed.committed, true);
  assert.equal(fixed.pushed, true);
  assert.equal(git(docs, "rev-parse", "HEAD"), git(remoteRoot, "rev-parse", "refs/heads/docs"));
  assert.equal(readFileSync(join(docs, "changes/accepted/spec.md"), "utf8"), before.history);
  assert.equal(readFileSync(join(root, "docs/api.md"), "utf8"), before.authoritative);
  assert.equal(git(root, "rev-parse", "HEAD"), before.codeHead);
  assert.match(readFileSync(join(docs, "SYNC.yaml"), "utf8"), new RegExp(`reviewed_through: "${before.codeHead}"`));
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
