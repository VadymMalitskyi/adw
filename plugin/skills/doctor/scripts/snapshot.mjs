#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
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

function integrationDeclarations(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^integrations:\s*(?:#.*)?$/.test(line));
  if (start === -1) return [];
  const declarations = [];
  let current;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const capability = /^  (work_tracker|code_host|observability|knowledge):\s*(?:#.*)?$/.exec(line);
    if (capability) {
      current = { capability: capability[1] };
      declarations.push(current);
      continue;
    }
    if (!current) continue;
    const field = /^    (provider|requirement|transport|access):\s*(?:"([^"]*)"|'([^']*)'|([^#\n]+))/.exec(line);
    if (field) current[field[1]] = (field[2] ?? field[3] ?? field[4]).trim();
  }
  return declarations;
}

function executionDeclaration(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^execution:\s*(?:#.*)?$/.test(line));
  if (start === -1) return {};
  const execution = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const field = /^  (isolation|enforcement):\s*(?:"([^"]*)"|'([^']*)'|([^#\n]+))/.exec(line);
    if (field) execution[field[1]] = (field[2] ?? field[3] ?? field[4]).trim();
  }
  return execution;
}

function managedDevcontainerChecks(projectRoot, execution) {
  const checks = [];
  const directory = join(projectRoot, ".devcontainer");
  const required = ["devcontainer.json", "Dockerfile", "allowed-domains.txt", "init-firewall.sh", "post-create.sh", "project-requirements.json", "project-setup.sh", "adw-managed.json"];
  const missing = required.filter((name) => !existsSync(join(directory, name)));
  if (missing.length > 0) {
    checks.push(check("execution:managed-files", "fail", `managed devcontainer is missing: ${missing.join(", ")}`));
    return checks;
  }
  let config = "";
  let configObject;
  let dockerfile = "";
  let marker;
  try {
    config = readFileSync(join(directory, "devcontainer.json"), "utf8");
    configObject = JSON.parse(config);
    dockerfile = readFileSync(join(directory, "Dockerfile"), "utf8");
    marker = JSON.parse(readFileSync(join(directory, "adw-managed.json"), "utf8"));
  } catch (error) {
    checks.push(check("execution:managed-files", "fail", `cannot inspect managed devcontainer: ${error.message}`));
    return checks;
  }
  const unsafeMount = /docker\.sock|(?:source|target)=[^,\n]*(?:\.ssh|\.aws|\.azure|\.config\/gcloud)|localEnv:HOME}(?:,|\/)/i.test(config);
  const versionsMatch = configObject?.build?.args?.CODEX_VERSION === marker?.codex_version
    && configObject?.build?.args?.CLAUDE_CODE_VERSION === marker?.claude_code_version
    && /^\d+\.\d+\.\d+$/.test(marker?.codex_version ?? "")
    && /^\d+\.\d+\.\d+$/.test(marker?.claude_code_version ?? "");
  const scopedVolumes = Array.isArray(configObject?.mounts) && configObject.mounts.length > 0 && configObject.mounts.every((mount) => typeof mount === "string" && /type=volume/.test(mount));
  const postCreateCommand = configObject?.postCreateCommand ?? "";
  const hardening = configObject?.remoteUser === "vscode"
    && configObject?.containerEnv?.ADW_MANAGED_DEVCONTAINER === "1"
    && /adw-init-firewall/.test(configObject?.postStartCommand ?? "")
    && postCreateCommand.indexOf("adw-init-firewall") !== -1
    && postCreateCommand.indexOf("adw-init-firewall") < postCreateCommand.indexOf("adw-project-setup")
    && scopedVolumes
    && /bubblewrap/.test(dockerfile)
    && /gpasswd -d vscode sudo/.test(dockerfile)
    && /chmod 0555 \/usr\/local\/bin\/adw-project-setup/.test(dockerfile)
    && /USER vscode/.test(dockerfile);
  const validMarker = marker?.schema === 1 && marker?.profile === "managed-devcontainer" && marker?.plugin_version === JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
  const requirementsDigest = createHash("sha256").update(readFileSync(join(directory, "project-requirements.json"))).digest("hex");
  const setupDigest = createHash("sha256").update(readFileSync(join(directory, "project-setup.sh"))).digest("hex");
  const generatedFilesMatch = marker?.requirements_schema === 1
    && marker?.project_requirements_sha256 === requirementsDigest
    && marker?.project_setup_sha256 === setupDigest
    && /^[a-z0-9+.-]*(?: [a-z0-9+.-]+)*$/.test(configObject?.build?.args?.ADW_PROJECT_APT_PACKAGES ?? "");
  const valid = hardening && validMarker && versionsMatch && generatedFilesMatch && !unsafeMount;
  checks.push(check("execution:managed-files", valid ? "pass" : "fail", valid ? "managed devcontainer hardening and pinned agents are present" : "managed devcontainer hardening, versions, mounts, or marker are invalid"));
  const active = process.env.ADW_MANAGED_DEVCONTAINER === "1";
  checks.push(check("execution:runtime", active ? "pass" : execution.enforcement === "required" ? "fail" : "warn", active ? "running inside the ADW managed devcontainer" : "ADW managed devcontainer is not the active execution environment"));
  return checks;
}

function executionChecks(projectRoot, config) {
  const execution = executionDeclaration(config);
  if (!execution.isolation || !["required", "preferred"].includes(execution.enforcement)) {
    return [check("execution:configuration", "fail", "execution isolation or enforcement is missing")];
  }
  const checks = [check("execution:configuration", "pass", `${execution.isolation} is ${execution.enforcement}`, execution)];
  if (execution.isolation === "managed-devcontainer") return [...checks, ...managedDevcontainerChecks(projectRoot, execution)];
  if (execution.isolation === "project-devcontainer") {
    const configured = existsSync(join(projectRoot, ".devcontainer/devcontainer.json"));
    const active = process.env.ADW_PROJECT_DEVCONTAINER === "1" || process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true";
    checks.push(check("execution:project-files", configured ? "pass" : "fail", configured ? "project-owned devcontainer is present" : "project-devcontainer is selected but devcontainer.json is missing"));
    checks.push(check("execution:runtime", active ? "pass" : execution.enforcement === "required" ? "fail" : "warn", active ? "project devcontainer runtime marker is active" : "project devcontainer runtime could not be verified; set ADW_PROJECT_DEVCONTAINER=1 inside it"));
  } else if (execution.isolation === "provider-sandbox") {
    checks.push(check("execution:runtime", "info", "provider sandbox strength must be verified by the active agent; this script cannot attest host policy"));
  } else {
    checks.push(check("execution:configuration", "fail", `unknown execution isolation: ${execution.isolation}`));
  }
  return checks;
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
    checks.push(check("project-schema", schema === "3" ? "pass" : "fail", schema === "3" ? "project schema 3 is supported" : `unsupported or migration-required schema: ${schema ?? "missing"}`));
    checks.push(check("docs-config", worktree === "worktrees/docs" ? "pass" : "fail", worktree === "worktrees/docs" ? "docs worktree uses worktrees/docs" : `unexpected docs worktree: ${worktree ?? "missing"}`));
    checks.push(...executionChecks(projectRoot, config));
    const integrations = integrationDeclarations(config);
    if (integrations.length === 0) {
      checks.push(check("integrations", "info", "no integrations configured; lightweight workflow is enabled"));
    } else {
      for (const integration of integrations) {
        const configured = integration.provider && ["disabled", "optional", "required"].includes(integration.requirement);
        checks.push(check(
          `integration:${integration.capability}`,
          configured ? "info" : "fail",
          configured ? `${integration.provider} is declared as ${integration.requirement}; runtime capability probe is required` : "provider or requirement is missing",
          { ...integration, transport: integration.transport ?? "auto", availability: "not-probed" },
        ));
      }
    }
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
