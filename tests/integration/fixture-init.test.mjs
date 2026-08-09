import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixturesRoot = join(repositoryRoot, "tests/fixtures");
const initScript = join(repositoryRoot, "plugin/skills/init/scripts/init.mjs");

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function copyFixture(name) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), `adw-fixture-${name}-`)));
  cpSync(join(fixturesRoot, name), root, {
    recursive: true,
    filter: (source) => source === join(fixturesRoot, name) || !source.endsWith("/.fixture"),
  });
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Fixture Test");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "add", ".");
  git(root, "commit", "-q", "--allow-empty", "-m", `Create ${name} fixture`);
  return root;
}

function runInit(root, action, confirmed = false, expectedStatus = 0, execution = null) {
  const args = [initScript, action, "--project-root", root];
  if (confirmed) args.push("--confirmed");
  if (execution) args.push("--execution", execution);
  if (action === "apply" && confirmed && expectedStatus === 0) {
    const previewArgs = [initScript, "preview", "--project-root", root];
    if (execution) previewArgs.push("--execution", execution);
    const preview = spawnSync(process.execPath, previewArgs, { encoding: "utf8" });
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    args.push("--preview-digest", JSON.parse(preview.stdout).preview_digest);
  }
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(expectedStatus === 0 ? result.stdout : result.stderr);
}

function filesUnder(root, relativeRoot) {
  const directory = join(root, relativeRoot);
  if (!existsSync(directory)) return [];
  const paths = [];
  function visit(current) {
    for (const name of readdirSync(current).sort()) {
      const path = join(current, name);
      const relativePath = relative(root, path);
      if (statSync(path).isDirectory()) visit(path);
      else paths.push(relativePath);
    }
  }
  visit(directory);
  return paths;
}

test("empty repository initializes an empty validation set, docs records, and a managed devcontainer", () => {
  const root = copyFixture("empty-repo");
  const headBefore = git(root, "rev-parse", "HEAD");
  const statusBefore = git(root, "status", "--porcelain=v1", "--untracked-files=all");

  const preview = runInit(root, "preview");
  assert.equal(preview.mode, "preview");
  assert.equal(preview.docs.action, "create");
  assert.deepEqual(preview.devcontainer, { isolation: "managed-devcontainer", action: "create", required: true, reopen_required: true, agent_tools: "both", web_access: "public-pages" });
  assert.match(preview.setup_guidance.what_adw_is, /plan, review, and safely carry out/i);
  assert.match(preview.setup_guidance.preview_safety, /not changed the repository/i);
  assert.match(preview.setup_guidance.why_information_is_needed, /cannot safely infer/i);
  assert.equal(preview.next_steps.length, 4);
  assert.equal(git(root, "status", "--porcelain=v1", "--untracked-files=all"), statusBefore);

  runInit(root, "apply", true);
  assert.equal(git(root, "rev-parse", "HEAD"), headBefore, "init must not commit code-branch artifacts");
  assert.deepEqual(filesUnder(root, ".devcontainer"), [
    ".devcontainer/Dockerfile",
    ".devcontainer/adw-managed.json",
    ".devcontainer/allowed-domains.txt",
    ".devcontainer/claude-permission-hook.mjs",
    ".devcontainer/claude-settings.json",
    ".devcontainer/codex.rules",
    ".devcontainer/devcontainer.json",
    ".devcontainer/egress-proxy.mjs",
    ".devcontainer/git-wrapper.sh",
    ".devcontainer/init-firewall.sh",
    ".devcontainer/post-create.sh",
    ".devcontainer/project-requirements.json",
    ".devcontainer/project-setup.sh",
  ]);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /^schema: 5$/m);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /permissions:\n    profile: managed-development/);
  assert.equal(existsSync(join(root, ".codex/config.toml")), true);
  assert.equal(existsSync(join(root, ".codex/rules/adw.rules")), true);
  assert.equal(existsSync(join(root, ".claude/settings.json")), true);
  const claudeProjectSettings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  assert.deepEqual(claudeProjectSettings.permissions.allow, ["WebSearch"]);
  assert.equal(claudeProjectSettings.sandbox.autoAllowBashIfSandboxed, true);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /execution:\n  isolation: managed-devcontainer\n  enforcement: required\n  web_access: public-pages/);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /validation:\n  default: \[\]/);
  assert.doesNotMatch(readFileSync(join(root, "adw.yaml"), "utf8"), /<unresolved>|<replace with/);
  assert.deepEqual(filesUnder(root, "worktrees/docs"), [
    "worktrees/docs/.git",
    "worktrees/docs/README.md",
    "worktrees/docs/SYNC.yaml",
    "worktrees/docs/architecture.md",
    "worktrees/docs/changes/.gitkeep",
    "worktrees/docs/components/.gitkeep",
  ]);

  const configBefore = readFileSync(join(root, "adw.yaml"));
  const docsHeadBefore = git(join(root, "worktrees/docs"), "rev-parse", "HEAD");
  const repeated = runInit(root, "apply", true);
  assert.equal(repeated.docs.action, "reuse");
  assert.deepEqual(readFileSync(join(root, "adw.yaml")), configBefore);
  assert.equal(git(join(root, "worktrees/docs"), "rev-parse", "HEAD"), docsHeadBefore);
});

test("provider sandbox is an explicit initialization choice and creates no container", () => {
  const root = copyFixture("empty-repo");
  const preview = runInit(root, "preview", false, 0, "provider-sandbox");
  assert.deepEqual(preview.devcontainer, { isolation: "provider-sandbox", action: "none", required: false, reopen_required: false, agent_tools: "both", web_access: "public-pages" });
  runInit(root, "apply", true, 0, "provider-sandbox");
  assert.equal(existsSync(join(root, ".devcontainer")), false);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /execution:\n  isolation: provider-sandbox\n  enforcement: preferred\n  web_access: public-pages/);
});

test("existing project keeps instructions, documentation, ignores, and devcontainer bytes", () => {
  const root = copyFixture("existing-project");
  const protectedPaths = [
    "README.md",
    "docs/operations.md",
    ".devcontainer/devcontainer.json",
    ".devcontainer/Dockerfile",
    "package.json",
    "Makefile",
  ];
  const protectedBefore = new Map(protectedPaths.map((path) => [path, readFileSync(join(root, path))]));
  const agentsBefore = readFileSync(join(root, "AGENTS.md"));
  const claudeBefore = readFileSync(join(root, "CLAUDE.md"));

  runInit(root, "apply", true);
  const config = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.match(config, /^schema: 5$/m);
  assert.match(config, /execution:\n  isolation: project-devcontainer\n  enforcement: required/);
  for (const [command, source] of [
    ["npm run lint", "package.json#scripts.lint"],
    ["npm run test", "package.json#scripts.test"],
    ["npm run build", "package.json#scripts.build"],
    ["make check", "Makefile#target:check"],
  ]) {
    assert.match(config, new RegExp(`command: ${JSON.stringify(command)}\\n\\s+source: ${JSON.stringify(source)}`));
  }
  assert.doesNotMatch(config, /deploy|release/);
  assert.deepEqual(readFileSync(join(root, "AGENTS.md")).subarray(0, agentsBefore.length), agentsBefore);
  assert.deepEqual(readFileSync(join(root, "CLAUDE.md")).subarray(0, claudeBefore.length), claudeBefore);
  for (const [path, bytes] of protectedBefore) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} changed`);
  assert.equal((readFileSync(join(root, ".gitignore"), "utf8").match(/^\/worktrees\/$/gm) ?? []).length, 1);

  const stablePaths = ["AGENTS.md", "CLAUDE.md", ".gitignore", "adw.yaml", ...protectedPaths];
  const stable = new Map(stablePaths.map((path) => [path, readFileSync(join(root, path))]));
  runInit(root, "apply", true);
  for (const [path, bytes] of stable) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} is not idempotent`);
});

test("monorepo initialization keeps component commands separate with observable provenance", () => {
  const root = copyFixture("monorepo");
  const sourcesBefore = new Map([
    "package.json",
    "apps/web/package.json",
    "apps/web/src/index.js",
    "services/api/Makefile",
    "services/api/pyproject.toml",
  ].map((path) => [path, readFileSync(join(root, path))]));

  runInit(root, "apply", true);
  const config = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.match(config, /^schema: 5$/m);
  assert.match(config, /path: "apps\/web"/);
  assert.match(config, /path: "services\/api"/);
  for (const source of [
    "apps/web/package.json#scripts.lint",
    "apps/web/package.json#scripts.test",
    "apps/web/package.json#scripts.build",
    "services/api/Makefile#target:lint",
    "services/api/Makefile#target:test",
    "services/api/Makefile#target:build",
  ]) assert.match(config, new RegExp(`source: ${JSON.stringify(source)}`), `missing provenance ${source}`);
  assert.doesNotMatch(config, /publish|deploy/);
  for (const [path, bytes] of sourcesBefore) assert.deepEqual(readFileSync(join(root, path)), bytes, `${path} changed`);
  assert.equal(existsSync(join(root, ".devcontainer/devcontainer.json")), true);

  const configBefore = readFileSync(join(root, "adw.yaml"));
  runInit(root, "apply", true);
  assert.deepEqual(readFileSync(join(root, "adw.yaml")), configBefore);
});

test("init discovers common libs wildcard workspaces and never records the current feature branch as default", () => {
  const root = copyFixture("empty-repo");
  git(root, "branch", "-m", "feature/setup");
  git(root, "config", "init.defaultBranch", "main");
  mkdirSync(join(root, "libs/core"), { recursive: true });
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ private: true, workspaces: ["libs/*"] }, null, 2)}\n`);
  writeFileSync(join(root, "libs/core/package.json"), `${JSON.stringify({ name: "core", scripts: { test: "node --test" } }, null, 2)}\n`);
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "Add wildcard workspace");

  runInit(root, "apply", true);
  const config = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.match(config, /default_branch: "main"/);
  assert.doesNotMatch(config, /default_branch: "feature\/setup"/);
  assert.match(config, /core:\n    path: "libs\/core"/);
  assert.match(config, /command: "npm run test"[\s\S]*source: "libs\/core\/package\.json#scripts\.test"/);
});
