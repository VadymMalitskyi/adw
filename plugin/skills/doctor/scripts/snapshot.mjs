#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CODEX_RULES, PERMISSION_PROFILE, managedClaudeSettings, mergeClaudeSettings, mergeCodexConfig, permissionAgentsFromProject } from "../../../execution/managed-development.mjs";

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

function componentDeclarations(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^components:\s*(?:#.*)?$/.test(line));
  if (start === -1) return [];
  const components = [];
  let current;
  for (const line of lines.slice(start + 1)) {
    if (/^\S/.test(line)) break;
    const component = /^  ([A-Za-z0-9_-]+):\s*(?:#.*)?$/.exec(line);
    if (component) { current = { name: component[1] }; components.push(current); continue; }
    const path = current && /^    path:\s*(?:"([^"]*)"|'([^']*)'|([^#\n]+))/.exec(line);
    if (path) current.path = (path[1] ?? path[2] ?? path[3]).trim();
  }
  return components;
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
  const profile = text.match(/^    profile:\s*(?:"([^"]*)"|'([^']*)'|([^#\n]+))/m);
  if (profile) execution.permissions = { profile: (profile[1] ?? profile[2] ?? profile[3]).trim() };
  return execution;
}

function regularFile(path, projectRoot) {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) return false;
  const rel = relative(realpathSync(projectRoot), realpathSync(path));
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

function permissionChecks(projectRoot, execution) {
  const checks = [];
  const profile = execution.permissions?.profile;
  checks.push(check("permissions:configuration", profile === PERMISSION_PROFILE ? "pass" : "fail", profile === PERMISSION_PROFILE ? `${PERMISSION_PROFILE} is configured` : `missing or unsupported permission profile: ${profile ?? "missing"}`));
  if (profile !== PERMISSION_PROFILE) return checks;
  const agentTools = permissionAgentsFromProject(projectRoot, { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join });
  if (agentTools === "codex" || agentTools === "both") {
    const configPath = join(projectRoot, ".codex/config.toml");
    const rulesPath = join(projectRoot, ".codex/rules/adw.rules");
    let valid = regularFile(configPath, projectRoot) && regularFile(rulesPath, projectRoot) && readFileSync(rulesPath, "utf8") === CODEX_RULES;
    try { valid = valid && mergeCodexConfig(readFileSync(configPath, "utf8")) === readFileSync(configPath, "utf8"); } catch { valid = false; }
    checks.push(check("permissions:codex", valid ? "pass" : "fail", valid ? "Codex uses workspace-write, on-request, writes-only app approval, and ADW exec rules" : "Codex permission configuration is missing, unsafe, or drifted"));
  }
  if (agentTools === "claude" || agentTools === "both") {
    const settingsPath = join(projectRoot, ".claude/settings.json");
    let valid = regularFile(settingsPath, projectRoot);
    try {
      const current = JSON.parse(readFileSync(settingsPath, "utf8"));
      valid = valid && JSON.stringify(current) === JSON.stringify(JSON.parse(mergeClaudeSettings(JSON.stringify(current))));
    } catch { valid = false; }
    checks.push(check("permissions:claude", valid ? "pass" : "fail", valid ? "Claude Code uses accept-edits, sandboxed Bash, and ADW allow/ask/deny rules" : "Claude Code permission configuration is missing, unsafe, or drifted"));
  }
  return checks;
}

function workTrackerWorkflow(text) {
  const lines = text.split(/\r?\n/);
  const workflows = lines.findIndex((line) => /^workflows:\s*(?:#.*)?$/.test(line));
  if (workflows === -1) return null;
  const start = lines.findIndex((line, index) => index > workflows && /^  work_tracker:\s*(?:#.*)?$/.test(line));
  if (start === -1) return null;
  const policy = {};
  for (const line of lines.slice(start + 1)) {
    if (/^\S|^  \S/.test(line)) break;
    const field = /^    (binding|ensure|stage|cardinality|profile|child_profile):\s*(?:"([^"]*)"|'([^']*)'|([^#\n]+))/.exec(line);
    if (field) policy[field[1]] = (field[2] ?? field[3] ?? field[4]).trim();
  }
  return policy;
}

function workTrackerPolicyChecks(projectRoot, config, integrations) {
  const policy = workTrackerWorkflow(config);
  if (!policy) return [];
  const tracker = integrations.find(({ capability }) => capability === "work_tracker");
  const validPolicy = ["optional", "required"].includes(policy.binding)
    && ["link-only", "create-or-link"].includes(policy.ensure)
    && ["plan", "execute"].includes(policy.stage)
    && ["one-per-change", "one-parent-plus-plan-tasks"].includes(policy.cardinality)
    && tracker && tracker.requirement !== "disabled"
    && (policy.binding !== "required" || tracker.requirement === "required")
    && (policy.ensure !== "create-or-link" || tracker.access === "read-write");
  const checks = [check("workflow:work_tracker", validPolicy ? "pass" : "fail", validPolicy ? `${policy.binding} ${policy.ensure} policy at ${policy.stage}` : "invalid work-tracker policy or disabled capability", policy)];
  if (!policy.profile) {
    if (policy.ensure === "create-or-link") checks.push(check("workflow:work_tracker:profile", "fail", "create-or-link policy requires a profile"));
    return checks;
  }
  const target = resolve(projectRoot, policy.profile);
  const rel = relative(projectRoot, target);
  if (isAbsolute(policy.profile) || rel === ".." || rel.startsWith("../") || !existsSync(target) || lstatSync(target).isSymbolicLink()) {
    checks.push(check("workflow:work_tracker:profile", "fail", "profile must be an existing non-symlink project-relative file", { profile: policy.profile }));
    return checks;
  }
  const profile = readFileSync(target, "utf8");
  const provider = yamlValue(profile, "provider");
  const structurallyPresent = yamlValue(profile, "schema") === "1"
    && Boolean(yamlValue(profile, "id"))
    && Boolean(yamlValue(profile, "object_type"))
    && /^required_fields:\s*$/m.test(profile)
    && /^requirement_fields:\s*$/m.test(profile);
  const valid = structurallyPresent && provider === tracker?.provider;
  checks.push(check("workflow:work_tracker:profile", valid ? "pass" : "fail", valid ? "profile structure and provider match" : "profile structure or provider is invalid", { profile: policy.profile, provider, sha256: createHash("sha256").update(profile).digest("hex") }));
  if (policy.cardinality === "one-parent-plus-plan-tasks" && !policy.child_profile) checks.push(check("workflow:work_tracker:child-profile", "fail", "one-parent-plus-plan-tasks requires a child profile"));
  if (policy.child_profile) {
    const childTarget = resolve(projectRoot, policy.child_profile);
    const childRel = relative(projectRoot, childTarget);
    if (isAbsolute(policy.child_profile) || childRel === ".." || childRel.startsWith("../") || !existsSync(childTarget) || lstatSync(childTarget).isSymbolicLink()) {
      checks.push(check("workflow:work_tracker:child-profile", "fail", "child profile must be an existing non-symlink project-relative file", { profile: policy.child_profile }));
    } else {
      const child = readFileSync(childTarget, "utf8");
      const childProvider = yamlValue(child, "provider");
      const childValid = yamlValue(child, "schema") === "1" && Boolean(yamlValue(child, "id")) && Boolean(yamlValue(child, "object_type")) && /^required_fields:\s*$/m.test(child) && /^requirement_fields:\s*$/m.test(child) && childProvider === tracker?.provider;
      checks.push(check("workflow:work_tracker:child-profile", childValid ? "pass" : "fail", childValid ? "child profile structure and provider match" : "child profile structure or provider is invalid", { profile: policy.child_profile, provider: childProvider, sha256: createHash("sha256").update(child).digest("hex") }));
    }
  }
  return checks;
}

function managedDevcontainerChecks(projectRoot, execution) {
  const checks = [];
  const directory = join(projectRoot, ".devcontainer");
  const required = ["devcontainer.json", "Dockerfile", "allowed-domains.txt", "init-firewall.sh", "post-create.sh", "codex.rules", "claude-settings.json", "claude-permission-hook.mjs", "project-requirements.json", "project-setup.sh", "adw-managed.json"];
  const missing = required.filter((name) => !existsSync(join(directory, name)));
  if (missing.length > 0) {
    checks.push(check("execution:managed-files", "fail", `managed devcontainer is missing: ${missing.join(", ")}`));
    return checks;
  }
  let config = "";
  let configObject;
  let dockerfile = "";
  let allowedDomains = "";
  let marker;
  try {
    config = readFileSync(join(directory, "devcontainer.json"), "utf8");
    configObject = JSON.parse(config);
    dockerfile = readFileSync(join(directory, "Dockerfile"), "utf8");
    allowedDomains = readFileSync(join(directory, "allowed-domains.txt"), "utf8");
    marker = JSON.parse(readFileSync(join(directory, "adw-managed.json"), "utf8"));
  } catch (error) {
    checks.push(check("execution:managed-files", "fail", `cannot inspect managed devcontainer: ${error.message}`));
    return checks;
  }
  const unsafeMount = /docker\.sock|(?:source|target)=[^,\n]*(?:\.ssh|\.aws|\.azure|\.config\/gcloud)|localEnv:HOME}(?:,|\/)/i.test(config);
  const profiles = { codex: ["codex"], claude: ["claude"], both: ["codex", "claude"] };
  const selectedAgents = profiles[marker?.agent_tools] ?? [];
  const selectedAgentSet = new Set(selectedAgents);
  const validAgentProfile = selectedAgents.length > 0 && configObject?.build?.args?.ADW_AGENT_TOOLS === marker?.agent_tools;
  const versionsMatch = validAgentProfile
    && configObject?.build?.args?.CODEX_VERSION === marker?.codex_version
    && configObject?.build?.args?.CLAUDE_CODE_VERSION === marker?.claude_code_version
    && /^\d+\.\d+\.\d+$/.test(marker?.codex_version ?? "")
    && /^\d+\.\d+\.\d+$/.test(marker?.claude_code_version ?? "");
  const scopedVolumes = Array.isArray(configObject?.mounts) && configObject.mounts.length > 0 && configObject.mounts.every((mount) => typeof mount === "string" && /type=volume/.test(mount));
  const mountTargets = (configObject?.mounts ?? []).filter((mount) => typeof mount === "string");
  const hasMountTarget = (target) => mountTargets.some((mount) => mount.split(",").some((part) => /^(?:target|dst|destination)=/.test(part) && part.slice(part.indexOf("=") + 1) === target));
  const agentMountsMatch = [
    ["codex", "/home/vscode/.codex"],
    ["claude", "/home/vscode/.claude"],
  ].every(([agent, target]) => hasMountTarget(target) === selectedAgentSet.has(agent));
  const extensions = configObject?.customizations?.vscode?.extensions;
  const hasExtension = (extension) => Array.isArray(extensions) && extensions.includes(extension);
  const agentExtensionsMatch = hasExtension("openai.chatgpt") === selectedAgentSet.has("codex")
    && hasExtension("anthropic.claude-code") === selectedAgentSet.has("claude");
  const environment = configObject?.containerEnv ?? {};
  const claudeEnvironmentMatches = selectedAgentSet.has("claude")
    ? environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1" && environment.DISABLE_AUTOUPDATER === "1"
    : !Object.prototype.hasOwnProperty.call(environment, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC")
      && !Object.prototype.hasOwnProperty.call(environment, "DISABLE_AUTOUPDATER");
  const requiredAgentDomains = selectedAgents.flatMap((agent) => agent === "codex"
    ? ["api.openai.com", "auth.openai.com", "chatgpt.com"]
    : ["api.anthropic.com", "claude.ai", "console.anthropic.com"]);
  const configuredDomains = new Set(allowedDomains.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  const agentDomainsPresent = requiredAgentDomains.every((domain) => configuredDomains.has(domain));
  const postCreateCommand = configObject?.postCreateCommand ?? "";
  const hardening = configObject?.remoteUser === "vscode"
    && configObject?.containerEnv?.ADW_MANAGED_DEVCONTAINER === "1"
    && /adw-init-firewall/.test(configObject?.postStartCommand ?? "")
    && postCreateCommand.indexOf("adw-init-firewall") !== -1
    && postCreateCommand.indexOf("adw-init-firewall") < postCreateCommand.indexOf("adw-project-setup")
    && scopedVolumes
    && agentMountsMatch
    && agentExtensionsMatch
    && claudeEnvironmentMatches
    && agentDomainsPresent
    && /bubblewrap/.test(dockerfile)
    && /ARG ADW_AGENT_TOOLS=both/.test(dockerfile)
    && /case "\$ADW_AGENT_TOOLS" in/.test(dockerfile)
    && /> \/etc\/adw\/agent-tools/.test(dockerfile)
    && /chmod 0444 \/etc\/adw\/agent-tools/.test(dockerfile)
    && /gpasswd -d vscode sudo/.test(dockerfile)
    && /chmod 0555 \/usr\/local\/bin\/adw-project-setup/.test(dockerfile)
    && /USER vscode/.test(dockerfile);
  const validMarker = marker?.schema === 2 && marker?.profile === "managed-devcontainer" && marker?.permission_profile === PERMISSION_PROFILE && validAgentProfile && marker?.plugin_version === JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
  const requirementsDigest = createHash("sha256").update(readFileSync(join(directory, "project-requirements.json"))).digest("hex");
  const setupDigest = createHash("sha256").update(readFileSync(join(directory, "project-setup.sh"))).digest("hex");
  const generatedFilesMatch = marker?.requirements_schema === 1
    && marker?.project_requirements_sha256 === requirementsDigest
    && marker?.project_setup_sha256 === setupDigest
    && /^[a-z0-9+.-]*(?: [a-z0-9+.-]+)*$/.test(configObject?.build?.args?.ADW_PROJECT_APT_PACKAGES ?? "");
  const permissionFilesMatch = readFileSync(join(directory, "codex.rules"), "utf8") === CODEX_RULES
    && readFileSync(join(directory, "claude-settings.json"), "utf8") === managedClaudeSettings({ allowedDomains: [...configuredDomains] })
    && readFileSync(join(directory, "claude-permission-hook.mjs"), "utf8") === readFileSync(join(pluginRoot, "templates/devcontainer/claude-permission-hook.mjs"), "utf8")
    && /COPY \.devcontainer\/codex\.rules/.test(dockerfile)
    && /managed-settings\.d\/20-adw\.json/.test(dockerfile)
    && /adw-claude-permission-hook/.test(dockerfile)
    && marker?.codex_rules_sha256 === createHash("sha256").update(readFileSync(join(directory, "codex.rules"))).digest("hex")
    && marker?.claude_settings_sha256 === createHash("sha256").update(readFileSync(join(directory, "claude-settings.json"))).digest("hex")
    && marker?.claude_hook_sha256 === createHash("sha256").update(readFileSync(join(directory, "claude-permission-hook.mjs"))).digest("hex");
  const valid = hardening && validMarker && versionsMatch && generatedFilesMatch && permissionFilesMatch && !unsafeMount;
  checks.push(check("execution:managed-files", valid ? "pass" : "fail", valid ? `managed devcontainer hardening and selected pinned agent tools (${marker.agent_tools}) are configured` : "managed devcontainer hardening, selected agent tools, versions, mounts, domains, or marker are invalid"));
  const active = process.env.ADW_MANAGED_DEVCONTAINER === "1";
  checks.push(check("execution:runtime", active ? "pass" : execution.enforcement === "required" ? "fail" : "warn", active ? "running inside the ADW managed devcontainer" : "ADW managed devcontainer is not the active execution environment"));
  return checks;
}

function executionChecks(projectRoot, config) {
  const execution = executionDeclaration(config);
  if (!execution.isolation || !["required", "preferred"].includes(execution.enforcement)) {
    return [check("execution:configuration", "fail", "execution isolation or enforcement is missing")];
  }
  const checks = [check("execution:configuration", "pass", `${execution.isolation} is ${execution.enforcement}`, execution), ...permissionChecks(projectRoot, execution)];
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
    checks.push(check("project-schema", schema === "5" ? "pass" : "fail", schema === "5" ? "project schema 5 is supported" : `unsupported or migration-required schema: ${schema ?? "missing"}`));
    checks.push(check("docs-config", worktree === "worktrees/docs" ? "pass" : "fail", worktree === "worktrees/docs" ? "docs worktree uses worktrees/docs" : `unexpected docs worktree: ${worktree ?? "missing"}`));
    const componentPaths = componentDeclarations(config).map(({ path }) => path).filter(Boolean);
    const uniqueComponents = new Set(componentPaths).size === componentPaths.length;
    checks.push(check("components", uniqueComponents ? "pass" : "fail", uniqueComponents ? `${componentPaths.length} component path(s) have unambiguous ownership` : "duplicate component paths create ambiguous ownership"));
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
    checks.push(...workTrackerPolicyChecks(projectRoot, config, integrations));
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
