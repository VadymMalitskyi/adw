// The stable ADW project contract.
//
// `adw.yaml` holds only settings that retained behavior actually reads: the
// base branch and group-branch convention, the isolation and web-access choices that shape the managed
// container, runtime versions the repository cannot pin itself, component
// paths with their project-owned validation commands, optional provider
// declarations. Anything else is rejected rather
// than ignored, so a stale field is a loud error instead of a silent no-op.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument } from "./vendor/yaml.mjs";
import { InputError, isObject, isSafeRelativePath, normalizeRelativePath, readProjectFile } from "./safe-files.mjs";
import { defaultPermissionPolicy, normalizePermissionPolicy } from "./permission-policy.mjs";

export const CONTRACT_VERSION = 1;
export const CAPABILITIES = Object.freeze(["work_tracker", "code_host", "observability", "knowledge"]);
export const ISOLATION_MODES = Object.freeze(["provider-sandbox", "project-devcontainer", "managed-devcontainer"]);
export const WEB_ACCESS_MODES = Object.freeze(["public-pages", "hosted-only"]);
export const RUNTIMES = Object.freeze(["node", "python", "go", "rust", "java", "ruby", "dotnet"]);
export const DEFAULT_TIMEOUT_MS = 120000;
export const DEFAULT_BRANCH_TEMPLATE = "adw/{change_id}/{group_id}";

const TRANSPORTS = new Set(["auto", "native", "mcp", "cli", "api"]);
const ACCESS_MODES = new Set(["read-only", "read-write"]);
const SECRET_LIKE_KEY = /(?:password|passwd|token|api[_-]?key|secret|credential|authorization|cookie|private[_-]?key)/i;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const PLACEHOLDER = /^\s*<[^>]+>\s*$/;
const PROJECT_KEYS = new Set(["adw", "git", "execution", "development", "components", "providers", "permissions"]);

export function defaultProjectConfig(baseBranch = "main") {
  return {
    adw: CONTRACT_VERSION,
    git: { base_branch: baseBranch, branch_template: DEFAULT_BRANCH_TEMPLATE },
    execution: { isolation: "provider-sandbox", web_access: "public-pages" },
    development: { runtime_versions: {} },
    components: {},
    providers: {},
    permissions: defaultPermissionPolicy(),
  };
}

// A missing project policy is intentional. Git remains the source of truth for
// its default branch, so ADW derives it instead of requiring every repository
// to repeat it in YAML.
function inferredBaseBranch(projectRoot) {
  const git = (args) => spawnSync("git", args, { cwd: projectRoot, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  const remote = git(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (remote.status === 0) {
    const branch = remote.stdout.trim().replace(/^origin\//, "");
    if (isValidBranchName(branch)) return branch;
  }
  for (const candidate of ["main", "master"]) {
    if (git(["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`]).status === 0) return candidate;
  }
  const current = git(["branch", "--show-current"]);
  return current.status === 0 && isValidBranchName(current.stdout.trim()) ? current.stdout.trim() : "main";
}

function inferredExecution(projectRoot) {
  const markerPath = join(projectRoot, ".devcontainer", "adw-managed.json");
  if (!existsSync(markerPath)) return { isolation: "provider-sandbox", web_access: "public-pages" };
  try {
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    if (marker?.profile === "managed-devcontainer" && WEB_ACCESS_MODES.includes(marker.web_access)) {
      return { isolation: "managed-devcontainer", web_access: marker.web_access };
    }
  } catch { /* A malformed marker is handled by doctor when it validates the container. */ }
  return { isolation: "managed-devcontainer", web_access: "public-pages" };
}

export function parseYaml(source, label = "YAML document") {
  if (typeof source !== "string" && !Buffer.isBuffer(source)) throw new InputError(`${label} must be UTF-8 text`);
  let text;
  try { text = Buffer.isBuffer(source) ? new TextDecoder("utf-8", { fatal: true }).decode(source) : source; }
  catch (error) { throw new InputError(`${label} is not valid UTF-8: ${error.message}`, { cause: error }); }
  const document = parseDocument(text, { merge: false, prettyErrors: false, strict: true, uniqueKeys: true, version: "1.2" });
  if (document.errors.length > 0) throw new InputError(`${label} is invalid: ${document.errors.map(({ message }) => message).join("; ")}`);
  const data = document.toJS({ maxAliasCount: 100 });
  if (!isObject(data)) throw new InputError(`${label} must contain one mapping object`);
  return data;
}

class Errors {
  constructor() { this.items = []; }
  add(path, message) { this.items.push({ path, message }); return false; }
  get valid() { return this.items.length === 0; }
}

// Rejects C0 control characters and DEL without writing them literally into
// this source file.
function hasControlCharacters(value) {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

function checkObject(errors, value, path) {
  if (!isObject(value)) return errors.add(path, "must be a mapping object");
  return true;
}

function checkKnownKeys(errors, value, allowed, path) {
  let ok = true;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) ok = errors.add(`${path}/${key}`, `is not a supported key; expected one of: ${[...allowed].join(", ")}`);
  }
  return ok;
}

function checkNonEmptyString(errors, value, path, maximum = 4000) {
  if (typeof value !== "string" || value.length === 0) return errors.add(path, "must be a non-empty string");
  if (value.length > maximum) return errors.add(path, `must be at most ${maximum} characters`);
  if (value.includes("\0")) return errors.add(path, "must not contain NUL bytes");
  return true;
}

function checkSingleLine(errors, value, path, maximum = 2000) {
  if (!checkNonEmptyString(errors, value, path, maximum)) return false;
  if (hasControlCharacters(value)) return errors.add(path, "must be a single-line string without control characters");
  return true;
}

function checkRelativePath(errors, value, path) {
  if (!checkNonEmptyString(errors, value, path, 1024)) return false;
  if (!isSafeRelativePath(value)) return errors.add(path, "must be a forward-slash project-relative path without `..` segments");
  return true;
}

export function isValidBranchName(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return false;
  if (/\s/.test(value)) return false;
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".lock")) return false;
  if (value.includes("..") || value.includes("//") || value.includes("@{")) return false;
  return !/[~^:?*[\\]/.test(value) && !hasControlCharacters(value);
}

// Branch templates are intentionally narrow: the two identifiers distinguish
// every prepared group, while the surrounding literal establishes a project
// convention.  Keeping the template declarative prevents arbitrary commands
// or path-like interpolation from entering the worktree protocol.
export function isValidBranchTemplate(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return false;
  if (!value.includes("{change_id}") || !value.includes("{group_id}")) return false;
  const literals = value.replaceAll("{change_id}", "").replaceAll("{group_id}", "");
  if (literals.includes("{") || literals.includes("}")) return false;
  return isValidBranchName(renderBranchTemplate(value, "change", "group"));
}

export function renderBranchTemplate(template, changeId, groupId) {
  return template.replaceAll("{change_id}", changeId).replaceAll("{group_id}", groupId);
}

function checkBranchName(errors, value, path) {
  if (!checkNonEmptyString(errors, value, path, 255)) return false;
  if (!isValidBranchName(value)) return errors.add(path, "is not a valid Git branch name");
  return true;
}

// Configuration never contains credentials. This walks the whole document so a
// secret cannot hide under an otherwise valid section.
function checkNoSecretLikeKeys(errors, value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => checkNoSecretLikeKeys(errors, item, `${path}/${index}`));
    return errors.valid;
  }
  if (!isObject(value)) return true;
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_LIKE_KEY.test(key)) errors.add(`${path}/${key}`, "credential-like keys are forbidden; keep credentials in provider clients or credential stores");
    checkNoSecretLikeKeys(errors, nested, `${path}/${key}`);
  }
  return errors.valid;
}

function validateValidationCommand(errors, item, path, componentPath) {
  if (typeof item === "string") {
    if (!checkNonEmptyString(errors, item, path)) return null;
    if (PLACEHOLDER.test(item)) return errors.add(path, "must be a real command, not an unresolved placeholder") && null;
    return { command: item, cwd: componentPath, timeout_ms: DEFAULT_TIMEOUT_MS, required: true };
  }
  if (!checkObject(errors, item, path)) return null;
  checkKnownKeys(errors, item, new Set(["command", "cwd", "timeout_ms", "required", "source"]), path);
  if (!checkNonEmptyString(errors, item.command, `${path}/command`)) return null;
  if (PLACEHOLDER.test(item.command)) return errors.add(`${path}/command`, "must be a real command, not an unresolved placeholder") && null;
  let cwd = componentPath;
  if (item.cwd !== undefined) {
    if (!checkRelativePath(errors, item.cwd, `${path}/cwd`)) return null;
    cwd = normalizeRelativePath(item.cwd);
  }
  let timeout = DEFAULT_TIMEOUT_MS;
  if (item.timeout_ms !== undefined) {
    if (!Number.isInteger(item.timeout_ms) || item.timeout_ms < 1) return errors.add(`${path}/timeout_ms`, "must be a positive integer") && null;
    timeout = item.timeout_ms;
  }
  if (item.required !== undefined && typeof item.required !== "boolean") return errors.add(`${path}/required`, "must be a boolean") && null;
  if (item.source !== undefined) checkSingleLine(errors, item.source, `${path}/source`);
  const normalized = { command: item.command, cwd, timeout_ms: timeout, required: item.required !== false };
  if (item.source !== undefined) normalized.source = item.source;
  return normalized;
}

function validateComponents(errors, value, normalized) {
  if (!checkObject(errors, value, "/components")) return;
  const entries = Object.entries(value);
  if (entries.length === 0) return void errors.add("/components", "must declare at least one component");
  const paths = new Map();
  for (const [id, raw] of entries) {
    const path = `/components/${id}`;
    if (!IDENTIFIER.test(id)) { errors.add(path, "component id must be lowercase alphanumeric with `-` or `_` separators"); continue; }
    if (!checkObject(errors, raw, path)) continue;
    checkKnownKeys(errors, raw, new Set(["path", "validate"]), path);
    if (!checkRelativePath(errors, raw.path, `${path}/path`)) continue;
    const componentPath = normalizeRelativePath(raw.path);
    if (paths.has(componentPath)) errors.add(`${path}/path`, `duplicates the path already owned by component ${paths.get(componentPath)}`);
    else paths.set(componentPath, id);
    const commands = [];
    if (raw.validate !== undefined) {
      if (!Array.isArray(raw.validate)) { errors.add(`${path}/validate`, "must be an array of commands"); continue; }
      for (const [index, item] of raw.validate.entries()) {
        const command = validateValidationCommand(errors, item, `${path}/validate/${index}`, componentPath);
        if (command) commands.push(command);
      }
    }
    normalized.components[id] = { path: componentPath, validate: commands };
  }
}

function validateProviders(errors, value, normalized) {
  if (!checkObject(errors, value, "/providers")) return;
  checkKnownKeys(errors, value, new Set(CAPABILITIES), "/providers");
  for (const [capability, raw] of Object.entries(value)) {
    const path = `/providers/${capability}`;
    if (!CAPABILITIES.includes(capability)) continue;
    if (!checkObject(errors, raw, path)) continue;
    checkKnownKeys(errors, raw, new Set(["provider", "required", "transport", "access", "domains", "settings"]), path);
    if (!checkSingleLine(errors, raw.provider, `${path}/provider`, 100)) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.provider)) { errors.add(`${path}/provider`, "must be a lowercase provider name such as github"); continue; }
    const entry = { provider: raw.provider, required: false, domains: [] };
    if (raw.required !== undefined) {
      if (typeof raw.required !== "boolean") { errors.add(`${path}/required`, "must be a boolean"); continue; }
      entry.required = raw.required;
    }
    if (raw.transport !== undefined) {
      if (!TRANSPORTS.has(raw.transport)) { errors.add(`${path}/transport`, `must be one of: ${[...TRANSPORTS].join(", ")}`); continue; }
      entry.transport = raw.transport;
    }
    if (raw.access !== undefined) {
      if (!ACCESS_MODES.has(raw.access)) { errors.add(`${path}/access`, `must be one of: ${[...ACCESS_MODES].join(", ")}`); continue; }
      entry.access = raw.access;
    }
    // Provider domains feed the managed container's egress allowlist, so they
    // are validated here rather than trusted from a skill's free text.
    if (raw.domains !== undefined) {
      if (!Array.isArray(raw.domains)) { errors.add(`${path}/domains`, "must be an array of hostnames"); continue; }
      for (const [index, domain] of raw.domains.entries()) {
        if (!isValidDomain(domain)) { errors.add(`${path}/domains/${index}`, "must be a plain lowercase hostname such as api.github.com"); continue; }
        if (!entry.domains.includes(domain)) entry.domains.push(domain);
      }
      entry.domains.sort();
    }
    if (raw.settings !== undefined) {
      if (!checkObject(errors, raw.settings, `${path}/settings`)) continue;
      entry.settings = {};
      // Unknown provider-specific keys are allowed only here, and never secret-like.
      for (const [key, setting] of Object.entries(raw.settings)) {
        if (SECRET_LIKE_KEY.test(key)) { errors.add(`${path}/settings/${key}`, "credential-like settings are forbidden; keep credentials in the provider or client credential store"); continue; }
        if (typeof setting === "string" || typeof setting === "number" || typeof setting === "boolean") entry.settings[key] = setting;
        else errors.add(`${path}/settings/${key}`, "must be a string, number, or boolean");
      }
    }
    normalized.providers[capability] = entry;
  }
}

function validatePermissionAccess(errors, rawPermissions, normalized) {
  for (const [provider, declaration] of Object.entries(rawPermissions?.providers ?? {})) {
    for (const [operation, decision] of Object.entries(declaration?.operations ?? {})) {
      if (operation === "read" || decision !== "allow") continue;
      if (normalized.permissions.providers[provider]?.operations[operation] !== "allow") continue;
      const writeCapable = Object.values(normalized.providers).some((configured) => configured.provider === provider && configured.access === "read-write");
      if (!writeCapable) errors.add(`/permissions/providers/${provider}/operations/${operation}`, `allow requires a configured ${provider} provider with access: read-write`);
    }
  }
}

export function isValidDomain(value) {
  return typeof value === "string" && /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(value);
}

export function validateProjectConfig(data, inferredBase = "main") {
  const errors = new Errors();
  if (!checkObject(errors, data, "/")) return { valid: false, errors: errors.items };
  checkKnownKeys(errors, data, PROJECT_KEYS, "");
  checkNoSecretLikeKeys(errors, data, "");
  if (data.adw !== CONTRACT_VERSION) errors.add("/adw", `must equal ${CONTRACT_VERSION}`);

  const normalized = defaultProjectConfig(inferredBase);

  if (data.git !== undefined && checkObject(errors, data.git, "/git")) {
    checkKnownKeys(errors, data.git, new Set(["base_branch", "branch_template"]), "/git");
    if (data.git.base_branch !== undefined && checkBranchName(errors, data.git.base_branch, "/git/base_branch")) normalized.git.base_branch = data.git.base_branch;
    if (data.git.branch_template !== undefined) {
      if (!isValidBranchTemplate(data.git.branch_template)) errors.add("/git/branch_template", "must include {change_id} and {group_id} and render to a valid Git branch name");
      else normalized.git.branch_template = data.git.branch_template;
    }
  }

  if (data.execution !== undefined && checkObject(errors, data.execution, "/execution")) {
    checkKnownKeys(errors, data.execution, new Set(["isolation", "web_access"]), "/execution");
    if (!ISOLATION_MODES.includes(data.execution.isolation)) errors.add("/execution/isolation", `must be one of: ${ISOLATION_MODES.join(", ")}`);
    else normalized.execution.isolation = data.execution.isolation;
    if (data.execution.web_access !== undefined) {
      if (!WEB_ACCESS_MODES.includes(data.execution.web_access)) errors.add("/execution/web_access", `must be one of: ${WEB_ACCESS_MODES.join(", ")}`);
      else normalized.execution.web_access = data.execution.web_access;
    }
  }

  if (data.development !== undefined && checkObject(errors, data.development, "/development")) {
    checkKnownKeys(errors, data.development, new Set(["runtime_versions"]), "/development");
    if (data.development.runtime_versions !== undefined && checkObject(errors, data.development.runtime_versions, "/development/runtime_versions")) {
      for (const [runtime, version] of Object.entries(data.development.runtime_versions)) {
        const path = `/development/runtime_versions/${runtime}`;
        if (!RUNTIMES.includes(runtime)) { errors.add(path, `is not a supported runtime; expected one of: ${RUNTIMES.join(", ")}`); continue; }
        if (typeof version !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(version)) { errors.add(path, "must be a numeric version such as 8 or 8.0.408"); continue; }
        normalized.development.runtime_versions[runtime] = version;
      }
    }
  }

  if (data.components !== undefined) validateComponents(errors, data.components, normalized);

  if (data.providers !== undefined) validateProviders(errors, data.providers, normalized);

  if (data.permissions !== undefined) {
    normalized.permissions = normalizePermissionPolicy(data.permissions, (path, message) => errors.add(path, message));
    validatePermissionAccess(errors, data.permissions, normalized);
  }

  return errors.valid ? { valid: true, errors: [], data: normalized } : { valid: false, errors: errors.items };
}

export async function loadProjectConfig(projectRoot, path = "adw.yaml") {
  const bytes = await readProjectFile(projectRoot, path);
  if (bytes === null) {
    const data = defaultProjectConfig(inferredBaseBranch(projectRoot));
    data.execution = inferredExecution(projectRoot);
    return {
      data,
      valid: true,
      errors: [],
      source: "defaults",
    };
  }
  const raw = parseYaml(bytes, path);
  const validation = validateProjectConfig(raw, inferredBaseBranch(projectRoot));
  return { data: validation.data ?? raw, valid: validation.valid, errors: validation.errors, source: "adw.yaml" };
}

// Every configured validation command, deduplicated conservatively: the
// strictest `required` flag and the shortest timeout win.
export function validationCommands(config) {
  const resolved = new Map();
  for (const [id, component] of Object.entries(config.components ?? {})) {
    for (const item of component.validate ?? []) {
      const key = `${item.cwd}\0${item.command}`;
      const previous = resolved.get(key);
      if (!previous) resolved.set(key, { ...item, component: id });
      else resolved.set(key, { ...previous, required: previous.required || item.required, timeout_ms: Math.min(previous.timeout_ms, item.timeout_ms) });
    }
  }
  return [...resolved.values()];
}

// Configured provider domains reach the managed container's allowlist. Skills
// never hand raw text to the renderer; it comes from the validated contract.
export function providerDomains(config) {
  return [...new Set(Object.values(config.providers ?? {}).flatMap(({ domains }) => domains ?? []))].sort();
}
