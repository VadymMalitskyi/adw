#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");

function parseArguments(argv) {
  const index = argv.indexOf("--project-root");
  if (index === -1 || !argv[index + 1]) throw new Error("--project-root is required");
  return { projectRoot: realpathSync(argv[index + 1]) };
}

function git(projectRoot, args) {
  return spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function check(id, status, summary, details = {}) {
  return { id, status, summary, ...details };
}

function boundedBlock(text, start, end) {
  const starts = text.split(start).length - 1;
  const ends = text.split(end).length - 1;
  return starts === 1 && ends === 1 && text.indexOf(start) < text.indexOf(end);
}

function yamlValue(text, key) {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*(?:"([^"]*)"|'([^']*)'|([^#\\n]+))`, "m"));
  return match ? (match[1] ?? match[2] ?? match[3]).trim() : undefined;
}

function manifestChecks() {
  const codexPath = join(pluginRoot, ".codex-plugin/plugin.json");
  const claudePath = join(pluginRoot, ".claude-plugin/plugin.json");
  try {
    const codex = JSON.parse(readFileSync(codexPath, "utf8"));
    const claude = JSON.parse(readFileSync(claudePath, "utf8"));
    const valid = codex.name === "adw" && claude.name === "adw" && codex.version === claude.version && codex.skills === "./skills/" && claude.skills === "./skills/";
    return check("plugin", valid ? "pass" : "fail", valid ? `compatible ADW manifests at ${codex.version}` : "provider manifests disagree", {
      plugin_root: pluginRoot,
      codex_version: codex.version,
      claude_version: claude.version,
    });
  } catch (error) {
    return check("plugin", "fail", `cannot read provider manifests: ${error.message}`, { plugin_root: pluginRoot });
  }
}

function projectChecks(projectRoot) {
  const checks = [];
  const top = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== projectRoot) {
    return [check("repository", "fail", "project root is not the Git top level")];
  }
  checks.push(check("repository", "pass", "project root is a Git repository"));

  const configPath = join(projectRoot, "adw.yaml");
  if (!existsSync(configPath)) {
    checks.push(check("project-schema", "fail", "adw.yaml is missing"));
  } else {
    const config = readFileSync(configPath, "utf8");
    const schema = yamlValue(config, "schema");
    const worktree = yamlValue(config, "worktree");
    checks.push(check("project-schema", schema === "1" ? "pass" : "fail", schema === "1" ? "project schema 1 is supported" : `unsupported or unresolved schema: ${schema ?? "missing"}`));
    checks.push(check("docs-config", worktree === "worktrees/docs" ? "pass" : "fail", worktree === "worktrees/docs" ? "docs worktree uses worktrees/docs" : `unexpected docs worktree: ${worktree ?? "missing"}`));
  }

  for (const [path, start, end] of [
    ["AGENTS.md", "<!-- ADW:START -->", "<!-- ADW:END -->"],
    ["CLAUDE.md", "<!-- ADW:START -->", "<!-- ADW:END -->"],
  ]) {
    const fullPath = join(projectRoot, path);
    const valid = existsSync(fullPath) && boundedBlock(readFileSync(fullPath, "utf8"), start, end);
    checks.push(check(`routing:${path}`, valid ? "pass" : "fail", valid ? "one bounded ADW routing block" : "missing, duplicate, or incomplete ADW routing block"));
  }

  for (const probe of [".adw/probe", "worktrees/probe"]) {
    const ignored = git(projectRoot, ["check-ignore", "--no-index", "--quiet", probe]).status === 0;
    checks.push(check(`ignore:${probe.split("/")[0]}`, ignored ? "pass" : "fail", ignored ? `${probe.split("/")[0]}/ is ignored` : `${probe.split("/")[0]}/ is not ignored`));
  }

  const worktrees = git(projectRoot, ["worktree", "list", "--porcelain"]);
  const hasDocs = worktrees.status === 0 && /(?:^|\n)branch refs\/heads\/docs(?:\n|$)/.test(worktrees.stdout) && worktrees.stdout.split(/\n\n+/).some((record) => record.includes(`worktree ${join(projectRoot, "worktrees/docs")}`) && record.includes("branch refs/heads/docs"));
  checks.push(check("docs-worktree", hasDocs ? "pass" : "fail", hasDocs ? "docs branch is attached at worktrees/docs" : "docs branch is not attached at worktrees/docs"));

  const syncPath = join(projectRoot, "worktrees/docs/SYNC.yaml");
  if (!existsSync(syncPath)) {
    checks.push(check("context-freshness", "warn", "SYNC.yaml is unavailable"));
  } else {
    const sync = readFileSync(syncPath, "utf8");
    const reviewed = yamlValue(sync, "reviewed_through");
    const head = git(projectRoot, ["rev-parse", "HEAD"]);
    if (!reviewed || reviewed === "unresolved" || head.status !== 0) checks.push(check("context-freshness", "warn", "context freshness is unresolved"));
    else {
      const ancestor = git(projectRoot, ["merge-base", "--is-ancestor", reviewed, head.stdout.trim()]);
      const current = reviewed === head.stdout.trim();
      checks.push(check(
        "context-freshness",
        ancestor.status === 0 && current ? "pass" : ancestor.status === 0 ? "warn" : "fail",
        ancestor.status === 0 && current ? "context matches code HEAD" : ancestor.status === 0 ? "context trails code HEAD" : "SYNC marker is not an ancestor of code HEAD",
        { reviewed_through: reviewed, code_head: head.stdout.trim() },
      ));
    }
  }

  const origin = git(projectRoot, ["remote", "get-url", "origin"]);
  checks.push(check("integration:origin", origin.status === 0 ? "pass" : "info", origin.status === 0 ? "origin remote is configured" : "origin remote is optional and not configured"));
  checks.push(check("integration:devcontainer", "info", existsSync(join(projectRoot, ".devcontainer")) ? "project-owned devcontainer detected; ADW does not manage it" : "no devcontainer detected; none is required"));
  return checks;
}

try {
  const { projectRoot } = parseArguments(process.argv.slice(2));
  const checks = [manifestChecks(), ...projectChecks(projectRoot)];
  const failed = checks.some(({ status }) => status === "fail");
  process.stdout.write(`${JSON.stringify({ ok: !failed, read_only: true, project_root: projectRoot, checks }, null, 2)}\n`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, read_only: true, error: error.message })}\n`);
  process.exitCode = 2;
}
