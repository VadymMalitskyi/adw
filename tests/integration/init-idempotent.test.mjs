import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const initScript = join(repositoryRoot, "plugin/skills/init/scripts/init.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "adw-init-")));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  mkdirSync(join(root, ".devcontainer"));
  writeFileSync(join(root, ".devcontainer/devcontainer.json"), '{"name":"project-owned"}\n');
  writeFileSync(join(root, "AGENTS.md"), Buffer.from("project instruction\r\nsecond byte-sensitive line\r\n"));
  writeFileSync(join(root, "CLAUDE.md"), "claude project instruction\n");
  writeFileSync(join(root, ".gitignore"), "dist/\n/worktrees/\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { lint: "eslint .", test: "node --test", release: "forbidden" } }, null, 2));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function run(root, action, confirmed = false) {
  const args = [initScript, action, "--project-root", root];
  if (confirmed) args.push("--confirmed");
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function outsideRoutingBlock(bytes) {
  const text = bytes.toString("utf8");
  return text.replace(/<!-- ADW:START -->[\s\S]*?<!-- ADW:END -->\n?/, "");
}

test("init previews without writes and applies idempotent bounded changes", () => {
  const root = fixture();
  const initialHead = git(root, "rev-parse", "HEAD");
  const agentBefore = readFileSync(join(root, "AGENTS.md"));
  const claudeBefore = readFileSync(join(root, "CLAUDE.md"));
  const ignoreBefore = readFileSync(join(root, ".gitignore"));
  const devcontainerBefore = readFileSync(join(root, ".devcontainer/devcontainer.json"));
  const statusBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");

  const preview = run(root, "preview");
  assert.equal(preview.mode, "preview");
  assert.equal(preview.devcontainer, "untouched");
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), statusBefore);
  assert.deepEqual(readFileSync(join(root, "AGENTS.md")), agentBefore);

  const applied = run(root, "apply", true);
  assert.equal(applied.docs.action, "ready");
  assert.equal(git(root, "rev-parse", "HEAD"), initialHead, "code checkout HEAD must not move");
  assert.equal(git(root, "-C", join(root, "worktrees/docs"), "branch", "--show-current"), "docs");
  assert.match(git(root, "worktree", "list", "--porcelain"), new RegExp(`worktree ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/worktrees/docs[\\s\\S]*branch refs/heads/docs`));

  const agentsAfter = readFileSync(join(root, "AGENTS.md"));
  const claudeAfter = readFileSync(join(root, "CLAUDE.md"));
  assert.equal(outsideRoutingBlock(agentsAfter), agentBefore.toString("utf8"));
  assert.equal(outsideRoutingBlock(claudeAfter), claudeBefore.toString("utf8"));
  assert.equal((agentsAfter.toString().match(/<!-- ADW:START -->/g) ?? []).length, 1);
  assert.equal((claudeAfter.toString().match(/<!-- ADW:START -->/g) ?? []).length, 1);

  const ignoreAfter = readFileSync(join(root, ".gitignore"), "utf8");
  assert.ok(ignoreAfter.startsWith(ignoreBefore.toString("utf8")));
  assert.equal((ignoreAfter.match(/^\/worktrees\/$/gm) ?? []).length, 1, "existing worktrees rule must not be duplicated");
  assert.equal((ignoreAfter.match(/^\.adw\/$/gm) ?? []).length, 1);
  assert.equal(git(root, "check-ignore", "--no-index", ".adw/local.yaml"), ".adw/local.yaml");
  assert.equal(git(root, "check-ignore", "--no-index", "worktrees/probe"), "worktrees/probe");

  const config = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.match(config, /^schema: 2$/m);
  assert.match(config, /command: "npm run lint"\n\s+source: "package\.json#scripts\.lint"/);
  assert.match(config, /command: "npm run test"\n\s+source: "package\.json#scripts\.test"/);
  assert.doesNotMatch(config, /release/);
  assert.deepEqual(readFileSync(join(root, ".devcontainer/devcontainer.json")), devcontainerBefore);

  const stablePaths = ["AGENTS.md", "CLAUDE.md", ".gitignore", "adw.yaml", ".adw/local.yaml", "worktrees/docs/README.md", "worktrees/docs/architecture.md", "worktrees/docs/SYNC.yaml"];
  const stableBytes = new Map(stablePaths.map((path) => [path, readFileSync(join(root, path))]));
  const docsHead = git(root, "-C", join(root, "worktrees/docs"), "rev-parse", "HEAD");
  const repeated = run(root, "apply", true);
  assert.equal(repeated.docs.action, "reuse");
  assert.equal(git(root, "-C", join(root, "worktrees/docs"), "rev-parse", "HEAD"), docsHead);
  for (const [path, bytes] of stableBytes) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} changed on repeat init`);
});

test("init attaches an existing docs branch instead of creating another", () => {
  const root = fixture();
  git(root, "branch", "docs");
  const preview = run(root, "preview");
  assert.equal(preview.docs.action, "attach");
  run(root, "apply", true);
  assert.equal(git(root, "-C", join(root, "worktrees/docs"), "branch", "--show-current"), "docs");
  assert.equal((git(root, "worktree", "list", "--porcelain").match(/branch refs\/heads\/docs/g) ?? []).length, 1);
});
