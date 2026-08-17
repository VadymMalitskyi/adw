// Deterministic local readiness checks.
//
// Everything here is read-only and answerable from bytes on disk: the plugin
// manifests agree, `adw.yaml` matches the contract, the permission policy is
// present and current, and — when a managed container is configured — its
// generated files still match the digests recorded in their own marker.
// Provider authentication and availability are deliberately absent: those are
// live questions the doctor skill asks with real provider commands.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProjectConfig } from "./config.mjs";
import { PERMISSION_FILES, PERMISSION_PROFILE, managedClaudeSettings, mergeClaudeSettings, mergeCodexConfig, renderCodexRules } from "./permissions.mjs";
import { defaultPermissionPolicy, permissionPolicyJson } from "./permission-policy.mjs";
import { MANAGED_FILES } from "./managed-environment.mjs";

const pluginRoot = resolve(fileURLToPath(import.meta.url), "../..");

function git(projectRoot, args) {
  return spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

// A passing check reports only its summary. Digests and container wiring are
// attached to failures, or to every check when a diagnosis asks for details.
function makeCheck(details) {
  return (id, status, summary, extra = {}) => (status === "pass" && !details ? { id, status, summary } : { id, status, summary, ...extra });
}

function regularProjectFile(projectRoot, relativePath) {
  const path = join(projectRoot, relativePath);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) return false;
  const rel = relative(realpathSync(projectRoot), realpathSync(path));
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel);
}

function manifestCheck(check) {
  try {
    const codex = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));
    const claude = JSON.parse(readFileSync(join(pluginRoot, ".claude-plugin/plugin.json"), "utf8"));
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

// Both providers run the same skills, so both policy files must be present and
// byte-current. This is also the cheap pre-execution gate: a workflow can call
// it alone and fail closed on drift.
export function permissionChecks(projectRoot, policy = defaultPermissionPolicy()) {
  const check = makeCheck(false);
  const missing = PERMISSION_FILES.filter((path) => !regularProjectFile(projectRoot, path));
  if (missing.length === PERMISSION_FILES.length) {
    return [check("permissions:configuration", "fail", `no ${PERMISSION_PROFILE} permission files were found; run adw:init or use adw:doctor repair`)];
  }
  const checks = [check("permissions:configuration", missing.length === 0 ? "pass" : "fail", missing.length === 0 ? `${PERMISSION_PROFILE} permission files are in effect` : `missing permission files: ${missing.join(", ")}`)];
  let codexValid = regularProjectFile(projectRoot, ".codex/config.toml") && regularProjectFile(projectRoot, ".codex/rules/adw.rules");
  if (codexValid) {
    const config = readFileSync(join(projectRoot, ".codex/config.toml"), "utf8");
    codexValid = readFileSync(join(projectRoot, ".codex/rules/adw.rules"), "utf8") === renderCodexRules(policy);
    try { codexValid = codexValid && mergeCodexConfig(config, policy) === config; } catch { codexValid = false; }
  }
  checks.push(check("permissions:codex", codexValid ? "pass" : "fail", codexValid ? "Codex uses workspace-write, on-request, and the current generated command/app policy" : "Codex permission configuration is missing, unsafe, or drifted"));
  let claudeValid = regularProjectFile(projectRoot, ".claude/settings.json");
  if (claudeValid) {
    try {
      const current = JSON.parse(readFileSync(join(projectRoot, ".claude/settings.json"), "utf8"));
      claudeValid = JSON.stringify(current) === JSON.stringify(JSON.parse(mergeClaudeSettings(JSON.stringify(current), policy)));
    } catch { claudeValid = false; }
  }
  checks.push(check("permissions:claude", claudeValid ? "pass" : "fail", claudeValid ? "Claude Code auto-allows sandboxed Bash and keeps the ADW hook plus ask/deny backstops" : "Claude Code permission configuration is missing, unsafe, or drifted"));
  return checks;
}

function managedDevcontainerChecks(projectRoot, execution, policy, check) {
  const directory = join(projectRoot, ".devcontainer");
  const missing = MANAGED_FILES.filter((name) => !existsSync(join(directory, name)));
  if (missing.length > 0) return [check("execution:managed-files", "fail", `managed devcontainer is missing: ${missing.join(", ")}`)];

  let config;
  let configObject;
  let dockerfile;
  let allowedDomains;
  let marker;
  try {
    config = readFileSync(join(directory, "devcontainer.json"), "utf8");
    configObject = JSON.parse(config);
    dockerfile = readFileSync(join(directory, "Dockerfile"), "utf8");
    allowedDomains = readFileSync(join(directory, "allowed-domains.txt"), "utf8");
    marker = JSON.parse(readFileSync(join(directory, "adw-managed.json"), "utf8"));
  } catch (error) {
    return [check("execution:managed-files", "fail", `cannot inspect managed devcontainer: ${error.message}`)];
  }

  const checks = [check("execution:managed-files", "pass", "all required managed devcontainer files are present and readable")];

  const expectedWebAccess = execution.web_access;
  const validMarker = marker?.schema === 3
    && marker?.profile === "managed-devcontainer"
    && marker?.permission_profile === PERMISSION_PROFILE
    && marker?.web_access === expectedWebAccess
    && configObject?.build?.args?.ADW_WEB_ACCESS === marker.web_access
    && marker?.plugin_version === JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
  checks.push(check("execution:managed-marker", validMarker ? "pass" : "fail", validMarker ? "managed marker schema, profile, web access, permission profile, and plugin version match" : "managed marker schema, profile, web access, permission profile, or plugin version is invalid"));

  const versionsMatch = configObject?.build?.args?.CODEX_VERSION === marker?.codex_version
    && configObject?.build?.args?.CLAUDE_CODE_VERSION === marker?.claude_code_version
    && /^\d+\.\d+\.\d+$/.test(marker?.codex_version ?? "")
    && /^\d+\.\d+\.\d+$/.test(marker?.claude_code_version ?? "");
  checks.push(check("execution:agent-versions", versionsMatch ? "pass" : "fail", versionsMatch ? "pinned Codex and Claude Code versions match the managed marker" : "pinned Codex or Claude Code versions are invalid or differ from the managed marker"));

  // Codex, Claude, and `gh` credentials live only in named volumes scoped to
  // this devcontainer. The host's real Codex/Claude home directories are
  // staged read-only at /mnt/host-*: post-create copies just the one auth
  // file each tool needs into its isolated volume, so a host login carries
  // over without sharing live session state, sockets, or host-only config.
  const CREDENTIAL_VOLUME_TARGETS = ["/home/vscode/.codex", "/home/vscode/.claude", "/home/vscode/.config/gh"];
  const HOST_STAGING_TARGETS = { "/mnt/host-codex": ".codex", "/mnt/host-claude": ".claude" };
  const mounts = (configObject?.mounts ?? []).filter((mount) => typeof mount === "string");
  const mountField = (mount, key) => mount.split(",").map((part) => part.split("=")).find(([name]) => name === key)?.[1];
  const hasMountFlag = (mount, flag) => mount.split(",").includes(flag);
  const hasMountTarget = (target) => mounts.some((mount) => mountField(mount, "target") === target);
  const credentialVolumesMatch = CREDENTIAL_VOLUME_TARGETS.every((target) => mounts.some((mount) => mountField(mount, "target") === target && mountField(mount, "type") === "volume" && /\$\{devcontainerId\}/.test(mountField(mount, "source") ?? "")));
  const hostStagingMatch = Object.entries(HOST_STAGING_TARGETS).every(([target, suffix]) => mounts.some((mount) => mountField(mount, "target") === target && mountField(mount, "type") === "bind" && mountField(mount, "source") === `\${localEnv:HOME}/${suffix}` && hasMountFlag(mount, "readonly")));
  const mountsMatch = mounts.length > 0 && CREDENTIAL_VOLUME_TARGETS.every(hasMountTarget) && credentialVolumesMatch && hostStagingMatch;
  checks.push(check("execution:mounts", mountsMatch ? "pass" : "fail", mountsMatch ? "agent credentials live in project-scoped named volumes, seeded by a read-only host staging mount used only to copy in authentication" : "credential mounts are missing or are not the expected named-volume/read-only-staging configuration"));

  const unsafeMount = /docker\.sock|(?:source|target)=[^,\n]*(?:\.ssh|\.aws|\.azure|\.config\/gcloud)/i.test(config)
    || mounts.some((mount) => /localEnv:HOME/.test(mountField(mount, "source") ?? "") && (!Object.hasOwn(HOST_STAGING_TARGETS, mountField(mount, "target")) || !hasMountFlag(mount, "readonly")));
  checks.push(check("execution:unsafe-mounts", unsafeMount ? "fail" : "pass", unsafeMount ? "a host credential directory or Docker socket is mounted into the container" : "no broad host credential or Docker socket mount was detected beyond the read-only Codex/Claude auth staging mounts"));

  const environment = configObject?.containerEnv ?? {};
  const expectedCapabilities = ["CHOWN", "KILL", "NET_ADMIN", "SETGID", "SETUID"];
  const configuredCapabilities = Array.isArray(configObject?.runArgs)
    ? configObject.runArgs.filter((argument) => argument.startsWith("--cap-add=")).map((argument) => argument.slice("--cap-add=".length)).sort()
    : [];
  const postCreateCommand = configObject?.postCreateCommand ?? "";
  const hardening = configObject?.remoteUser === "vscode"
    && environment.ADW_MANAGED_DEVCONTAINER === "1"
    && environment.HTTP_PROXY === "http://127.0.0.1:18080"
    && environment.HTTPS_PROXY === "http://127.0.0.1:18080"
    && /adw-init-firewall/.test(configObject?.postStartCommand ?? "")
    && postCreateCommand.indexOf("adw-init-firewall") !== -1
    && postCreateCommand.indexOf("adw-init-firewall") < postCreateCommand.indexOf("adw-project-setup")
    && Array.isArray(configObject?.runArgs)
    && configObject.runArgs.includes("--cap-drop=ALL")
    && configuredCapabilities.length === expectedCapabilities.length
    && configuredCapabilities.every((capability, index) => capability === expectedCapabilities[index])
    && !configObject.runArgs.some((argument) => /SYS_ADMIN|SYS_PTRACE|NET_RAW|seccomp=unconfined|apparmor=unconfined/.test(argument))
    && /bubblewrap/.test(dockerfile)
    && /COPY \.devcontainer\/egress-proxy\.mjs \/usr\/local\/bin\/adw-egress-proxy/.test(dockerfile)
    && /useradd --system --no-create-home --shell \/usr\/sbin\/nologin adw-egress/.test(dockerfile)
    && /ARG ADW_WEB_ACCESS=public-pages/.test(dockerfile)
    && /npm install -g "@openai\/codex@\$\{CODEX_VERSION\}" "@anthropic-ai\/claude-code@\$\{CLAUDE_CODE_VERSION\}"/.test(dockerfile)
    && /> \/etc\/adw\/web-access/.test(dockerfile)
    && /gpasswd -d vscode sudo/.test(dockerfile)
    && /chmod 0555 \/usr\/local\/bin\/adw-project-setup/.test(dockerfile)
    && /USER vscode/.test(dockerfile);
  checks.push(check("execution:hardening", hardening ? "pass" : "fail", hardening ? "managed devcontainer hardening is configured" : "managed devcontainer user, startup ordering, capabilities, proxy, or Dockerfile hardening is invalid"));

  const configuredDomains = new Set(allowedDomains.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  const requiredAgentDomains = ["api.openai.com", "auth.openai.com", "chatgpt.com", "api.anthropic.com", "claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com"];
  const domainsValid = requiredAgentDomains.every((domain) => configuredDomains.has(domain)) && marker?.allowed_domains_sha256 === sha256(allowedDomains);
  checks.push(check("execution:domains", domainsValid ? "pass" : "fail", domainsValid ? "required agent domains are present and the allowlist matches its managed digest" : "required agent domains are missing or the allowlist differs from its managed digest"));

  const generatedValid = marker?.requirements_schema === 1
    && marker?.project_requirements_sha256 === sha256(readFileSync(join(directory, "project-requirements.json")))
    && marker?.project_setup_sha256 === sha256(readFileSync(join(directory, "project-setup.sh")))
    && marker?.egress_proxy_sha256 === sha256(readFileSync(join(directory, "egress-proxy.mjs")))
    && /^[a-z0-9+.-]*(?: [a-z0-9+.-]+)*$/.test(configObject?.build?.args?.ADW_PROJECT_APT_PACKAGES ?? "");
  checks.push(check("execution:generated-files", generatedValid ? "pass" : "fail", generatedValid ? "generated project requirements and setup bytes match the managed marker" : "generated project requirements, setup bytes, schema, or package arguments differ from the managed marker"));

  const permissionsValid = readFileSync(join(directory, "codex.rules"), "utf8") === renderCodexRules(policy)
    && readFileSync(join(directory, "permission-policy.json"), "utf8") === permissionPolicyJson(policy)
    && readFileSync(join(directory, "claude-settings.json"), "utf8") === managedClaudeSettings({ allowedDomains: [...configuredDomains], webAccess: marker.web_access, policy })
    && readFileSync(join(directory, "claude-permission-hook.mjs"), "utf8") === readFileSync(join(pluginRoot, "templates/devcontainer/claude-permission-hook.mjs"), "utf8")
    && /COPY \.devcontainer\/codex\.rules/.test(dockerfile)
    && /COPY \.devcontainer\/git-wrapper\.sh \/usr\/local\/bin\/git/.test(dockerfile)
    && /COPY \.devcontainer\/codex-wrapper\.sh \/usr\/local\/bin\/codex/.test(dockerfile)
    && /managed-settings\.d\/20-adw\.json/.test(dockerfile)
    && /adw-claude-permission-hook/.test(dockerfile)
    && marker?.codex_rules_sha256 === sha256(readFileSync(join(directory, "codex.rules")))
    && marker?.permission_policy_sha256 === sha256(readFileSync(join(directory, "permission-policy.json")))
    && marker?.git_wrapper_sha256 === sha256(readFileSync(join(directory, "git-wrapper.sh")))
    && marker?.codex_wrapper_sha256 === sha256(readFileSync(join(directory, "codex-wrapper.sh")))
    && marker?.claude_settings_sha256 === sha256(readFileSync(join(directory, "claude-settings.json")))
    && marker?.claude_hook_sha256 === sha256(readFileSync(join(directory, "claude-permission-hook.mjs")));
  checks.push(check("execution:permission-files", permissionsValid ? "pass" : "fail", permissionsValid ? "managed Codex and Claude permission payloads match their recorded digests" : "managed Codex or Claude permission payloads, installs, or recorded digests are invalid"));

  const active = process.env.ADW_MANAGED_DEVCONTAINER === "1";
  checks.push(check("execution:runtime", active ? "pass" : "fail", active ? "running inside the ADW managed devcontainer" : "the ADW managed devcontainer is not the active execution environment"));
  return checks;
}

// Documentation and plans live on their own branch, checked out in a worktree.
// Doctor never creates it — `adw:init` does, and re-running that flow is a
// reviewed decision rather than a silent repair.
function docsCheck(projectRoot, docs, check) {
  const details = { branch: docs.branch, worktree: docs.worktree };
  if (git(projectRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${docs.branch}`]).status !== 0) {
    return check("docs:branch", "info", `the ${docs.branch} branch does not exist yet; adw:init creates it, and adw:plan and adw:generate-docs need it`, details);
  }
  const list = git(projectRoot, ["worktree", "list", "--porcelain"]);
  const target = resolve(projectRoot, docs.worktree);
  const attached = list.status === 0 && list.stdout.split(/\r?\n/).some((line) => {
    if (!line.startsWith("worktree ")) return false;
    const path = line.slice("worktree ".length);
    try { return realpathSync(path) === realpathSync(target); }
    catch { return resolve(path) === target; }
  });
  return check("docs:worktree", attached ? "pass" : "fail", attached
    ? `the ${docs.branch} branch is checked out at ${docs.worktree}`
    : `the ${docs.branch} branch exists but is not checked out at ${docs.worktree}; attach it with git worktree add ${docs.worktree} ${docs.branch}`, details);
}

function executionChecks(projectRoot, execution, policy, check) {
  const checks = [check("execution:configuration", "pass", `${execution.isolation} isolation`, { isolation: execution.isolation })];
  checks.push(...permissionChecks(projectRoot, policy));
  if (execution.isolation === "managed-devcontainer") return [...checks, ...managedDevcontainerChecks(projectRoot, execution, policy, check)];
  if (execution.isolation === "project-devcontainer") {
    const configured = existsSync(join(projectRoot, ".devcontainer/devcontainer.json"));
    const active = process.env.ADW_PROJECT_DEVCONTAINER === "1" || process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true";
    checks.push(check("execution:project-files", configured ? "pass" : "fail", configured ? "project-owned devcontainer is present" : "project-devcontainer is selected but devcontainer.json is missing"));
    checks.push(check("execution:runtime", active ? "pass" : "fail", active ? "project devcontainer runtime marker is active" : "project devcontainer runtime could not be verified; set ADW_PROJECT_DEVCONTAINER=1 inside it"));
  } else {
    checks.push(check("execution:runtime", "info", "provider sandbox strength must be verified by the active agent; this check cannot attest host policy"));
  }
  return checks;
}

export async function runDoctor(directory, { details = false, checks: selection = "all" } = {}) {
  const projectRoot = realpathSync(directory);
  const check = makeCheck(details);
  if (selection === "permissions") {
    let config;
    try { config = await loadProjectConfig(projectRoot); }
    catch (error) { return { ok: false, read_only: true, project_root: projectRoot, checks: [check("permissions:configuration", "fail", error.message)] }; }
    if (!config.valid) return { ok: false, read_only: true, project_root: projectRoot, checks: [check("permissions:configuration", "fail", "adw.yaml does not match the project policy contract", { errors: config.errors })] };
    const checks = permissionChecks(projectRoot, config.data.permissions);
    return { ok: !checks.some(({ status }) => status === "fail"), read_only: true, project_root: projectRoot, checks };
  }

  const checks = [manifestCheck(check)];
  const top = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== projectRoot) {
    checks.push(check("repository", "fail", "project root is not the Git top level"));
    return { ok: false, read_only: true, project_root: projectRoot, isolation: null, checks };
  }
  checks.push(check("repository", "pass", "project root is a Git repository"));

  let config;
  try { config = await loadProjectConfig(projectRoot); }
  catch (error) {
    checks.push(check("project-contract", "fail", error.message));
    return { ok: false, read_only: true, project_root: projectRoot, isolation: null, checks };
  }
  checks.push(check("project-contract", config.valid ? "pass" : "fail", config.valid ? (config.source === "defaults" ? "no adw.yaml; using repository discovery and ADW defaults" : "adw.yaml matches the adw: 1 project policy contract") : "adw.yaml does not match the adw: 1 project policy contract", config.valid ? { source: config.source } : { errors: config.errors }));
  if (!config.valid) return { ok: false, read_only: true, project_root: projectRoot, isolation: null, checks };

  const project = config.data;
  const componentPaths = Object.values(project.components).map(({ path }) => path);
  const uniqueComponents = new Set(componentPaths).size === componentPaths.length;
  checks.push(check("components", uniqueComponents ? "info" : "fail", componentPaths.length === 0 ? "component boundaries are discovered from repository evidence" : `${componentPaths.length} component override(s) have unambiguous ownership`, uniqueComponents ? {} : { paths: componentPaths }));

  checks.push(...executionChecks(projectRoot, project.execution, project.permissions, check));

  const providers = Object.entries(project.providers);
  if (providers.length === 0) checks.push(check("providers", "info", "no providers configured; the lightweight workflow is enabled"));
  else {
    for (const [capability, declaration] of providers) {
      checks.push(check(`provider:${capability}`, "info", `${declaration.provider} is ${declaration.required ? "required" : "optional"}; the doctor skill probes live availability`, {
        capability,
        provider: declaration.provider,
        required: declaration.required,
        transport: declaration.transport ?? "auto",
        availability: "not-probed",
      }));
    }
  }

  const ignored = git(projectRoot, ["check-ignore", "--no-index", "--quiet", "worktrees/probe"]).status === 0;
  checks.push(check("ignore:worktrees", ignored ? "pass" : "fail", ignored ? "worktrees/ is ignored" : "worktrees/ is not ignored; prepared group worktrees would be committed"));

  checks.push(docsCheck(projectRoot, project.docs, check));

  const origin = git(projectRoot, ["remote", "get-url", "origin"]);
  checks.push(check("code-host:origin", origin.status === 0 ? "pass" : "info", origin.status === 0 ? "origin remote is configured" : "origin remote is optional and not configured"));

  return {
    ok: !checks.some(({ status }) => status === "fail"),
    read_only: true,
    project_root: projectRoot,
    isolation: project.execution.isolation,
    checks,
  };
}
