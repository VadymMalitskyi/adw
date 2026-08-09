#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadArtifactFile, parseYaml } from "../../../lib/adw-helper.mjs";
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
    checks.push(check("permissions:claude", valid ? "pass" : "fail", valid ? "Claude Code auto-allows sandboxed Bash and uses ADW semantic hooks plus ask/deny backstops" : "Claude Code permission configuration is missing, unsafe, or drifted"));
  }
  return checks;
}

async function workTrackerPolicyChecks(projectRoot, project) {
  const policy = project.workflows?.work_tracker;
  if (!policy) return [];
  const tracker = project.integrations?.work_tracker;
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
  let profile;
  let profileValidation = { valid: false };
  let profileDigest;
  try {
    const loaded = await loadArtifactFile({ project_root: projectRoot, path: policy.profile, artifact: "work-item-profile" });
    profile = loaded.data;
    profileValidation = loaded.validation;
    profileDigest = loaded.digest;
  } catch {}
  const valid = profileValidation.valid && profile.provider === tracker?.provider;
  checks.push(check("workflow:work_tracker:profile", valid ? "pass" : "fail", valid ? "profile schema and provider match" : "profile schema or provider is invalid", { profile: policy.profile, provider: profile?.provider, sha256: profileDigest }));
  if (policy.cardinality === "one-parent-plus-plan-tasks" && !policy.child_profile) checks.push(check("workflow:work_tracker:child-profile", "fail", "one-parent-plus-plan-tasks requires a child profile"));
  if (policy.child_profile) {
    const childTarget = resolve(projectRoot, policy.child_profile);
    const childRel = relative(projectRoot, childTarget);
    if (isAbsolute(policy.child_profile) || childRel === ".." || childRel.startsWith("../") || !existsSync(childTarget) || lstatSync(childTarget).isSymbolicLink()) {
      checks.push(check("workflow:work_tracker:child-profile", "fail", "child profile must be an existing non-symlink project-relative file", { profile: policy.child_profile }));
    } else {
      let child;
      let childValidation = { valid: false };
      let childDigest;
      try {
        const loaded = await loadArtifactFile({ project_root: projectRoot, path: policy.child_profile, artifact: "work-item-profile" });
        child = loaded.data;
        childValidation = loaded.validation;
        childDigest = loaded.digest;
      } catch {}
      const childValid = childValidation.valid && child.provider === tracker?.provider;
      checks.push(check("workflow:work_tracker:child-profile", childValid ? "pass" : "fail", childValid ? "child profile schema and provider match" : "child profile schema or provider is invalid", { profile: policy.child_profile, provider: child?.provider, sha256: childDigest }));
    }
  }
  return checks;
}

function managedDevcontainerChecks(projectRoot, execution) {
  const checks = [];
  const directory = join(projectRoot, ".devcontainer");
  const required = ["devcontainer.json", "Dockerfile", "allowed-domains.txt", "egress-proxy.mjs", "init-firewall.sh", "post-create.sh", "codex.rules", "claude-settings.json", "claude-permission-hook.mjs", "project-requirements.json", "project-setup.sh", "adw-managed.json"];
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
  const expectedWebAccess = execution.web_access ?? (marker?.agent_tools === "codex" ? "hosted-only" : "public-pages");
  const validWebAccess = ["hosted-only", "public-pages"].includes(marker?.web_access)
    && marker.web_access === expectedWebAccess
    && configObject?.build?.args?.ADW_WEB_ACCESS === marker.web_access;
  const versionsMatch = configObject?.build?.args?.CODEX_VERSION === marker?.codex_version
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
  const expectedCapabilities = ["CHOWN", "KILL", "NET_ADMIN", "SETGID", "SETUID"];
  const configuredCapabilities = Array.isArray(configObject?.runArgs)
    ? configObject.runArgs.filter((argument) => argument.startsWith("--cap-add=")).map((argument) => argument.slice("--cap-add=".length)).sort()
    : [];
  const minimumCapabilities = configuredCapabilities.length === expectedCapabilities.length
    && configuredCapabilities.every((capability, index) => capability === expectedCapabilities[index]);
  const claudeEnvironmentMatches = selectedAgentSet.has("claude")
    ? environment.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC === "1" && environment.DISABLE_AUTOUPDATER === "1"
    : !Object.prototype.hasOwnProperty.call(environment, "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC")
      && !Object.prototype.hasOwnProperty.call(environment, "DISABLE_AUTOUPDATER");
  const requiredAgentDomains = selectedAgents.flatMap((agent) => agent === "codex"
    ? ["api.openai.com", "auth.openai.com", "chatgpt.com"]
    : ["api.anthropic.com", "claude.ai", "console.anthropic.com"]);
  const configuredDomains = new Set(allowedDomains.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  const allowedDomainsMatch = marker?.allowed_domains_sha256 === createHash("sha256").update(allowedDomains).digest("hex");
  const agentDomainsPresent = requiredAgentDomains.every((domain) => configuredDomains.has(domain)) && allowedDomainsMatch;
  const postCreateCommand = configObject?.postCreateCommand ?? "";
  const hardening = configObject?.remoteUser === "vscode"
    && configObject?.containerEnv?.ADW_MANAGED_DEVCONTAINER === "1"
    && /adw-init-firewall/.test(configObject?.postStartCommand ?? "")
    && postCreateCommand.indexOf("adw-init-firewall") !== -1
    && postCreateCommand.indexOf("adw-init-firewall") < postCreateCommand.indexOf("adw-project-setup")
    && /bubblewrap/.test(dockerfile)
    && Array.isArray(configObject?.runArgs)
    && configObject.runArgs.includes("--cap-drop=ALL")
    && minimumCapabilities
    && !configObject.runArgs.some((argument) => /SYS_ADMIN|SYS_PTRACE|NET_RAW|seccomp=unconfined|apparmor=unconfined/.test(argument))
    && environment.HTTP_PROXY === "http://127.0.0.1:18080"
    && environment.HTTPS_PROXY === "http://127.0.0.1:18080"
    && /COPY \.devcontainer\/egress-proxy\.mjs \/usr\/local\/bin\/adw-egress-proxy/.test(dockerfile)
    && /useradd --system --no-create-home --shell \/usr\/sbin\/nologin adw-egress/.test(dockerfile)
    && /ARG ADW_AGENT_TOOLS=both/.test(dockerfile)
    && /ARG ADW_WEB_ACCESS=public-pages/.test(dockerfile)
    && /case "\$ADW_AGENT_TOOLS" in/.test(dockerfile)
    && /> \/etc\/adw\/agent-tools/.test(dockerfile)
    && /> \/etc\/adw\/web-access/.test(dockerfile)
    && /chmod 0444 \/etc\/adw\/agent-tools \/etc\/adw\/web-access/.test(dockerfile)
    && /gpasswd -d vscode sudo/.test(dockerfile)
    && /chmod 0555 \/usr\/local\/bin\/adw-project-setup/.test(dockerfile)
    && /USER vscode/.test(dockerfile);
  const validMarker = marker?.schema === 2 && marker?.profile === "managed-devcontainer" && marker?.permission_profile === PERMISSION_PROFILE && validWebAccess && marker?.plugin_version === JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
  const requirementsDigest = createHash("sha256").update(readFileSync(join(directory, "project-requirements.json"))).digest("hex");
  const setupDigest = createHash("sha256").update(readFileSync(join(directory, "project-setup.sh"))).digest("hex");
  const generatedFilesMatch = marker?.requirements_schema === 1
    && marker?.project_requirements_sha256 === requirementsDigest
    && marker?.project_setup_sha256 === setupDigest
    && marker?.egress_proxy_sha256 === createHash("sha256").update(readFileSync(join(directory, "egress-proxy.mjs"))).digest("hex")
    && /^[a-z0-9+.-]*(?: [a-z0-9+.-]+)*$/.test(configObject?.build?.args?.ADW_PROJECT_APT_PACKAGES ?? "");
  const permissionFilesMatch = readFileSync(join(directory, "codex.rules"), "utf8") === CODEX_RULES
    && readFileSync(join(directory, "claude-settings.json"), "utf8") === managedClaudeSettings({ allowedDomains: [...configuredDomains], webAccess: marker.web_access })
    && readFileSync(join(directory, "claude-permission-hook.mjs"), "utf8") === readFileSync(join(pluginRoot, "templates/devcontainer/claude-permission-hook.mjs"), "utf8")
    && /COPY \.devcontainer\/codex\.rules/.test(dockerfile)
    && /managed-settings\.d\/20-adw\.json/.test(dockerfile)
    && /adw-claude-permission-hook/.test(dockerfile)
    && marker?.codex_rules_sha256 === createHash("sha256").update(readFileSync(join(directory, "codex.rules"))).digest("hex")
    && marker?.claude_settings_sha256 === createHash("sha256").update(readFileSync(join(directory, "claude-settings.json"))).digest("hex")
    && marker?.claude_hook_sha256 === createHash("sha256").update(readFileSync(join(directory, "claude-permission-hook.mjs"))).digest("hex");
  const mountsMatch = scopedVolumes && agentMountsMatch;
  checks.push(check("execution:managed-files", "pass", "all required managed devcontainer files are present and readable"));
  checks.push(check("execution:managed-marker", validMarker ? "pass" : "fail", validMarker ? "managed marker schema, profile, permission profile, and plugin version match" : "managed marker schema, profile, permission profile, or plugin version is invalid"));
  checks.push(check("execution:agent-profile", validAgentProfile ? "pass" : "fail", validAgentProfile ? `selected agent profile (${marker.agent_tools}) matches the container build` : "selected agent profile is missing, unsupported, or differs from the container build"));
  checks.push(check("execution:agent-versions", versionsMatch ? "pass" : "fail", versionsMatch ? "pinned Codex and Claude Code versions match the managed marker" : "pinned Codex or Claude Code versions are invalid or differ from the managed marker"));
  checks.push(check("execution:mounts", mountsMatch ? "pass" : "fail", mountsMatch ? "credential volumes are scoped to the selected agents" : "credential volumes are missing, not volumes, or expose an unselected agent"));
  checks.push(check("execution:extensions", agentExtensionsMatch ? "pass" : "fail", agentExtensionsMatch ? "editor extensions match the selected agents" : "editor extensions do not match the selected agents"));
  checks.push(check("execution:environment", claudeEnvironmentMatches ? "pass" : "fail", claudeEnvironmentMatches ? "agent-specific environment settings match the selected agents" : "Claude-specific environment settings are missing or exposed to an unselected profile"));
  checks.push(check("execution:domains", agentDomainsPresent ? "pass" : "fail", agentDomainsPresent ? "required selected-agent domains are present and the allowlist matches its managed digest" : "required selected-agent domains are missing or the allowlist differs from its managed digest"));
  checks.push(check("execution:hardening", hardening ? "pass" : "fail", hardening ? "managed devcontainer hardening is configured" : "managed devcontainer user, startup ordering, Dockerfile hardening, or setup command is invalid"));
  checks.push(check("execution:generated-files", generatedFilesMatch ? "pass" : "fail", generatedFilesMatch ? "generated project requirements and setup bytes match the managed marker" : "generated project requirements, setup bytes, schema, or package arguments differ from the managed marker"));
  checks.push(check("execution:permission-files", permissionFilesMatch ? "pass" : "fail", permissionFilesMatch ? "managed Codex and Claude permission payloads match their recorded digests" : "managed Codex or Claude permission payloads, installs, or recorded digests are invalid"));
  checks.push(check("execution:unsafe-mounts", unsafeMount ? "fail" : "pass", unsafeMount ? "a host credential directory or Docker socket is mounted into the container" : "no broad host credential or Docker socket mount was detected"));
  const active = process.env.ADW_MANAGED_DEVCONTAINER === "1";
  checks.push(check("execution:runtime", active ? "pass" : execution.enforcement === "required" ? "fail" : "warn", active ? "running inside the ADW managed devcontainer" : "ADW managed devcontainer is not the active execution environment"));
  return checks;
}

function executionChecks(projectRoot, execution) {
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

async function projectChecks(projectRoot) {
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
    let project;
    let schemaValidation;
    try {
      const loaded = await loadArtifactFile({ project_root: projectRoot, path: "adw.yaml", artifact: "project" });
      project = loaded.data;
      schemaValidation = loaded.validation;
    }
    catch (error) {
      checks.push(check("project-schema", "fail", error.message));
      return checks;
    }
    checks.push(check("project-schema", schemaValidation.valid ? "pass" : "fail", schemaValidation.valid ? "project schema 5 is valid" : "adw.yaml failed project schema validation", schemaValidation.valid ? {} : { errors: schemaValidation.errors }));
    checks.push(check("docs-config", project.documentation?.worktree === "worktrees/docs" && project.documentation?.branch === "docs" ? "pass" : "fail", project.documentation?.worktree === "worktrees/docs" && project.documentation?.branch === "docs" ? "docs branch and worktree use the fixed ADW locations" : "unexpected docs branch or worktree"));
    const componentPaths = Object.values(project.components ?? {}).map(({ path }) => path).filter(Boolean);
    const uniqueComponents = new Set(componentPaths).size === componentPaths.length;
    checks.push(check("components", uniqueComponents ? "pass" : "fail", uniqueComponents ? `${componentPaths.length} component path(s) have unambiguous ownership` : "duplicate component paths create ambiguous ownership"));
    checks.push(...executionChecks(projectRoot, project.execution ?? {}));
    const integrations = Object.entries(project.integrations ?? {}).map(([capability, declaration]) => ({ capability, ...declaration }));
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
    checks.push(...await workTrackerPolicyChecks(projectRoot, project));
  }

  const selectedAgents = permissionAgentsFromProject(projectRoot, { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join });
  const routingFiles = selectedAgents === "codex"
    ? ["AGENTS.md"]
    : selectedAgents === "claude" ? ["CLAUDE.md"] : ["AGENTS.md", "CLAUDE.md"];
  for (const path of routingFiles) {
    const [start, end] = ["<!-- ADW:START -->", "<!-- ADW:END -->"];
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
    let sync;
    try { sync = parseYaml(readFileSync(syncPath, "utf8"), "SYNC.yaml"); }
    catch (error) { checks.push(check("context-freshness", "fail", error.message)); sync = {}; }
    const reviewed = sync.reviewed_through;
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
  const checks = [manifestChecks(), ...await projectChecks(projectRoot)];
  const failed = checks.some(({ status }) => status === "fail");
  process.stdout.write(`${JSON.stringify({ ok: !failed, read_only: true, project_root: projectRoot, checks }, null, 2)}\n`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, read_only: true, error: error.message })}\n`);
  process.exitCode = 2;
}
