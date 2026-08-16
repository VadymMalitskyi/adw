#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig, parseYaml, validatePlanTemplate } from "../../../lib/adw-helper.mjs";
import { CODEX_RULES, PERMISSION_PROFILE, managedClaudeSettings, mergeClaudeSettings, mergeCodexConfig, permissionAgentsFromProject } from "../../../execution/managed-development.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");
const ISOLATIONS = new Set(["provider-sandbox", "project-devcontainer", "managed-devcontainer"]);

function parseArguments(argv) {
  const index = argv.indexOf("--project-root");
  if (index === -1 || !argv[index + 1]) throw new Error("--project-root is required");
  // `--details` is a diagnosis switch. Ordinary contributors see only concise
  // pass/fail summaries; marker digests and container internals stay hidden.
  // `--checks permissions` is the cheap pre-execution gate: it inspects only the
  // project permission policy so a workflow can fail closed on drift without
  // paying for Git, docs, container, and manifest inspection.
  const selection = argv.indexOf("--checks");
  const checks = selection === -1 ? "all" : argv[selection + 1];
  if (!["all", "permissions"].includes(checks)) throw new Error("--checks must be all or permissions");
  return { projectRoot: realpathSync(argv[index + 1]), details: argv.includes("--details"), checks };
}

function git(projectRoot, args) {
  return spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

let detailedOutput = false;

// A passing check reports only its concise summary. Marker digests, container
// wiring, and other internals are attached to failures, or to every check when
// `--details` is requested for diagnosis.
function check(id, status, summary, details = {}) {
  if (status === "pass" && !detailedOutput) return { id, status, summary };
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

// The permission profile is not a configured field. It is a release-owned
// constant that an ADW initialization workflow writes for every isolation mode, and the managed
// devcontainer additionally enforces it from root-owned container policy.
function permissionChecks(projectRoot) {
  const checks = [];
  const agentTools = permissionAgentsFromProject(projectRoot, { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join });
  if (agentTools === "unknown") {
    return [check("permissions:configuration", "fail", `no ${PERMISSION_PROFILE} permission files were found; run adw:update to restore them`)];
  }
  checks.push(check("permissions:configuration", "pass", `${PERMISSION_PROFILE} permission files are in effect`, { agent_tools: agentTools }));
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

function managedDevcontainerChecks(projectRoot, execution) {
  const checks = [];
  const directory = join(projectRoot, ".devcontainer");
  const required = ["devcontainer.json", "Dockerfile", "allowed-domains.txt", "egress-proxy.mjs", "init-firewall.sh", "post-create.sh", "codex.rules", "git-wrapper.sh", "claude-settings.json", "claude-permission-hook.mjs", "project-requirements.json", "project-setup.sh", "adw-managed.json"];
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
    && /npm install -g "@openai\/codex@\$\{CODEX_VERSION\}" "@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}"/.test(dockerfile)
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
    && /COPY \.devcontainer\/git-wrapper\.sh \/usr\/local\/bin\/git/.test(dockerfile)
    && /managed-settings\.d\/20-adw\.json/.test(dockerfile)
    && /adw-claude-permission-hook/.test(dockerfile)
    && marker?.codex_rules_sha256 === createHash("sha256").update(readFileSync(join(directory, "codex.rules"))).digest("hex")
    && marker?.git_wrapper_sha256 === createHash("sha256").update(readFileSync(join(directory, "git-wrapper.sh"))).digest("hex")
    && marker?.claude_settings_sha256 === createHash("sha256").update(readFileSync(join(directory, "claude-settings.json"))).digest("hex")
    && marker?.claude_hook_sha256 === createHash("sha256").update(readFileSync(join(directory, "claude-permission-hook.mjs"))).digest("hex");
  const mountsMatch = scopedVolumes && agentMountsMatch;
  checks.push(check("execution:managed-files", "pass", "all required managed devcontainer files are present and readable"));
  checks.push(check("execution:managed-marker", validMarker ? "pass" : "fail", validMarker ? "managed marker schema, profile, permission profile, and plugin version match" : "managed marker schema, profile, permission profile, or plugin version is invalid"));
  checks.push(check("execution:agent-profile", validAgentProfile ? "pass" : "fail", validAgentProfile ? `recorded managed agent profile (${marker.agent_tools}) matches the container build` : "recorded managed agent profile is missing, unsupported, or differs from the container build"));
  checks.push(check("execution:agent-versions", versionsMatch ? "pass" : "fail", versionsMatch ? "pinned Codex and Claude Code versions match the managed marker" : "pinned Codex or Claude Code versions are invalid or differ from the managed marker"));
  checks.push(check("execution:mounts", mountsMatch ? "pass" : "fail", mountsMatch ? "credential volumes are scoped to the recorded managed agent profile" : "credential volumes are missing, not volumes, or exceed the recorded managed agent profile"));
  checks.push(check("execution:extensions", agentExtensionsMatch ? "pass" : "fail", agentExtensionsMatch ? "editor extensions match the recorded managed agent profile" : "editor extensions do not match the recorded managed agent profile"));
  checks.push(check("execution:environment", claudeEnvironmentMatches ? "pass" : "fail", claudeEnvironmentMatches ? "agent-specific environment settings match the recorded managed agent profile" : "Claude-specific environment settings are missing or exceed the recorded managed agent profile"));
  checks.push(check("execution:domains", agentDomainsPresent ? "pass" : "fail", agentDomainsPresent ? "required managed-agent domains are present and the allowlist matches its managed digest" : "required managed-agent domains are missing or the allowlist differs from its managed digest"));
  checks.push(check("execution:hardening", hardening ? "pass" : "fail", hardening ? "managed devcontainer hardening is configured" : "managed devcontainer user, startup ordering, Dockerfile hardening, or setup command is invalid"));
  checks.push(check("execution:generated-files", generatedFilesMatch ? "pass" : "fail", generatedFilesMatch ? "generated project requirements and setup bytes match the managed marker" : "generated project requirements, setup bytes, schema, or package arguments differ from the managed marker"));
  checks.push(check("execution:permission-files", permissionFilesMatch ? "pass" : "fail", permissionFilesMatch ? "managed Codex and Claude permission payloads match their recorded digests" : "managed Codex or Claude permission payloads, installs, or recorded digests are invalid"));
  checks.push(check("execution:unsafe-mounts", unsafeMount ? "fail" : "pass", unsafeMount ? "a host credential directory or Docker socket is mounted into the container" : "no broad host credential or Docker socket mount was detected"));
  const active = process.env.ADW_MANAGED_DEVCONTAINER === "1";
  checks.push(check("execution:runtime", active ? "pass" : "fail", active ? "running inside the ADW managed devcontainer" : "ADW managed devcontainer is not the active execution environment"));
  return checks;
}

// Only the configured isolation is inspected. A provider-sandbox project is
// never probed for Docker, container markers, or firewall wiring.
function executionChecks(projectRoot, execution) {
  const isolation = execution.isolation;
  if (!ISOLATIONS.has(isolation)) {
    return [check("execution:configuration", "fail", `unsupported execution isolation: ${isolation ?? "missing"}`)];
  }
  const mode = execution.mode ?? "sequential";
  const checks = [
    check("execution:configuration", "pass", `${isolation} isolation, ${mode} execution`, { isolation, mode }),
    ...permissionChecks(projectRoot),
  ];
  if (isolation === "managed-devcontainer") return [...checks, ...managedDevcontainerChecks(projectRoot, execution)];
  if (isolation === "project-devcontainer") {
    const configured = existsSync(join(projectRoot, ".devcontainer/devcontainer.json"));
    const active = process.env.ADW_PROJECT_DEVCONTAINER === "1" || process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true";
    checks.push(check("execution:project-files", configured ? "pass" : "fail", configured ? "project-owned devcontainer is present" : "project-devcontainer is selected but devcontainer.json is missing"));
    checks.push(check("execution:runtime", active ? "pass" : "fail", active ? "project devcontainer runtime marker is active" : "project devcontainer runtime could not be verified; set ADW_PROJECT_DEVCONTAINER=1 inside it"));
  } else {
    checks.push(check("execution:runtime", "info", "provider sandbox strength must be verified by the active agent; this script cannot attest host policy"));
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
  let docsWorktree = "worktrees/docs";
  let isolation = null;
  const top = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== projectRoot) {
    return { checks: [check("repository", "fail", "project root is not the Git top level")], isolation };
  }
  checks.push(check("repository", "pass", "project root is a Git repository"));

  const configPath = join(projectRoot, "adw.yaml");
  if (!existsSync(configPath)) {
    checks.push(check("project-contract", "fail", "adw.yaml is missing; a project maintainer must use adw:init-greenfield or adw:init-brownfield"));
  } else {
    let project;
    let validation;
    try {
      const loaded = await loadProjectConfig({ project_root: projectRoot, path: "adw.yaml" });
      project = loaded.data;
      validation = loaded.validation;
    }
    catch (error) {
      checks.push(check("project-contract", "fail", error.message));
      return { checks, isolation };
    }
    checks.push(check("project-contract", validation.valid ? "pass" : "fail", validation.valid ? "adw.yaml matches the adw: 1 project contract" : "adw.yaml does not match the adw: 1 project contract", validation.valid ? {} : { errors: validation.errors }));
    if (!validation.valid) return { checks, isolation };
    docsWorktree = project.docs.worktree;
    isolation = project.execution.isolation;
    const docsFixed = project.docs?.worktree === "worktrees/docs" && project.docs?.branch === "docs";
    checks.push(check("docs-config", docsFixed ? "pass" : "warn", docsFixed ? "docs branch and worktree use the default ADW locations" : `docs branch ${project.docs?.branch} is checked out at ${project.docs?.worktree}`));
    const componentPaths = Object.values(project.components ?? {}).map(({ path }) => path).filter(Boolean);
    const uniqueComponents = new Set(componentPaths).size === componentPaths.length;
    checks.push(check("components", uniqueComponents ? "pass" : "fail", uniqueComponents ? `${componentPaths.length} component path(s) have unambiguous ownership` : "duplicate component paths create ambiguous ownership"));
    if (project.planning === null) {
      checks.push(check("planning-templates", "info", "no project templates configured; planning uses the bundled compatibility fallback"));
    } else {
      for (const [name, path] of Object.entries(project.planning.templates)) {
        const target = resolve(projectRoot, path);
        const tracked = git(projectRoot, ["ls-files", "--error-unmatch", "--", path]).status === 0;
        let validation = { valid: false, errors: [{ path: "/template", message: "file is missing, unsafe, or not a regular file" }] };
        if (regularFile(target, projectRoot)) {
          try { validation = validatePlanTemplate(readFileSync(target)); }
          catch (error) { validation = { valid: false, errors: [{ path: "/template", message: error.message }] }; }
        }
        const status = !validation.valid ? "fail" : tracked ? "pass" : "warn";
        checks.push(check(
          `planning-template:${name}`,
          status,
          !validation.valid
            ? `${path} must contain the required ADW plan markers`
            : tracked ? `${path} is a tracked valid ADW plan template` : `${path} is valid but not yet tracked; commit initialization before planning`,
          status === "pass" ? {} : { tracked, errors: validation.errors },
        ));
      }
    }
    checks.push(...executionChecks(projectRoot, project.execution ?? {}));
    const providers = Object.entries(project.providers ?? {});
    if (providers.length === 0) {
      checks.push(check("providers", "info", "no providers configured; the lightweight workflow is enabled"));
    } else {
      for (const [capability, declaration] of providers) {
        checks.push(check(
          `provider:${capability}`,
          "info",
          `${declaration.provider} is ${declaration.required ? "required" : "optional"}; runtime capability probe is required`,
          { capability, provider: declaration.provider, required: declaration.required === true, transport: declaration.transport ?? "auto", availability: "not-probed" },
        ));
      }
    }
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
  const hasDocs = worktrees.status === 0 && /(?:^|\n)branch refs\/heads\/docs(?:\n|$)/.test(worktrees.stdout) && worktrees.stdout.split(/\n\n+/).some((record) => record.includes(`worktree ${join(projectRoot, docsWorktree)}`) && record.includes("branch refs/heads/docs"));
  checks.push(check("docs-worktree", hasDocs ? "pass" : "fail", hasDocs ? `docs branch is attached at ${docsWorktree}` : `docs branch is not attached at ${docsWorktree}`));

  const syncPath = join(projectRoot, docsWorktree, "SYNC.yaml");
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
  checks.push(check("code-host:origin", origin.status === 0 ? "pass" : "info", origin.status === 0 ? "origin remote is configured" : "origin remote is optional and not configured"));
  return { checks, isolation };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const projectRoot = args.projectRoot;
  detailedOutput = args.details;
  const project = args.checks === "permissions"
    ? { checks: permissionChecks(projectRoot), isolation: null }
    : await projectChecks(projectRoot);
  const checks = args.checks === "permissions" ? project.checks : [manifestChecks(), ...project.checks];
  const failed = checks.some(({ status }) => status === "fail");
  process.stdout.write(`${JSON.stringify({ ok: !failed, read_only: true, project_root: projectRoot, isolation: project.isolation, checks }, null, 2)}\n`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, read_only: true, error: error.message })}\n`);
  process.exitCode = 2;
}
