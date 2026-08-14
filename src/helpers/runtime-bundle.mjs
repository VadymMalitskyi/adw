#!/usr/bin/env node
// Generated as a dependency-free Node.js 20+ runtime bundle for ADW skills.
import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

export const EXIT = Object.freeze({ OK: 0, INPUT: 2, CONTRACT_INVALID: 3, APPROVAL_INVALID: 4, VALIDATION_FAILED: 5, PATH_VIOLATION: 7, ATOMIC_WRITE_FAILED: 8, INTERNAL: 9 });

export const CAPABILITIES = Object.freeze(["work_tracker", "code_host", "observability", "knowledge"]);
export const EXECUTION_MODES = Object.freeze(["orchestrated", "sequential"]);
export const ISOLATION_MODES = Object.freeze(["provider-sandbox", "project-devcontainer", "managed-devcontainer"]);
export const GROUP_STATUSES = Object.freeze(["prepared", "implementing", "reviewing", "validating", "passed", "failed", "blocked"]);
export const PHASE_STATUSES = Object.freeze(["running", "passed", "failed", "blocked"]);

const WEB_ACCESS_MODES = new Set(["public-pages", "hosted-only"]);
const TRANSPORTS = new Set(["auto", "native", "mcp", "cli", "api"]);
const ACCESS_MODES = new Set(["read-only", "read-write"]);
const RUNTIMES = new Set(["node", "python", "go", "rust", "java", "ruby", "dotnet"]);
const SECRET_LIKE_KEY = /(?:password|passwd|token|api[_-]?key|secret|credential|authorization|cookie|private[_-]?key)/i;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const CHANGE_ID = /^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-]+)*$/;
const SHA256 = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
const PLACEHOLDER = /^\s*<[^>]+>\s*$/;
const MAX_PARALLEL = 16;
const DEFAULT_TIMEOUT_MS = 120000;
const VALIDATION_TERMINATION_GRACE_MS = 250;
const VALIDATION_PIPE_CLOSE_GRACE_MS = 100;
const APPROVAL_DOMAIN = Buffer.from("ADW-PLAN-APPROVAL-V1\0", "utf8");

// ---------------------------------------------------------------------------
// Digests and YAML
// ---------------------------------------------------------------------------

export function computeDigest(content) {
  if (!(typeof content === "string" || Buffer.isBuffer(content))) throw new InputError("digest input must be a string or buffer");
  return createHash("sha256").update(content).digest("hex");
}

export function parseYaml(source, label = "YAML document") {
  if (typeof source !== "string" && !Buffer.isBuffer(source)) throw new InputError(`${label} must be UTF-8 text`);
  let text;
  try { text = Buffer.isBuffer(source) ? new TextDecoder("utf-8", { fatal: true }).decode(source) : source; }
  catch (error) { throw new InputError(`${label} is not valid UTF-8: ${error.message}`, { cause: error }); }
  const document = parseDocument(text, { merge: false, prettyErrors: false, strict: true, uniqueKeys: true, version: "1.2" });
  if (document.errors.length > 0) throw new InputError(`${label} is invalid: ${document.errors.map(({ message }) => message).join("; ")}`);
  const data = document.toJS({ maxAliasCount: 100 });
  if (data === null || typeof data !== "object" || Array.isArray(data)) throw new InputError(`${label} must contain one mapping object`);
  return data;
}

// ---------------------------------------------------------------------------
// Shared handwritten validation primitives
// ---------------------------------------------------------------------------

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class Errors {
  constructor() { this.items = []; }
  add(path, message) { this.items.push({ path, message }); return false; }
  get valid() { return this.items.length === 0; }
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
  if (/[\u0000-\u001f\u007f]/.test(value)) return errors.add(path, "must be a single-line string without control characters");
  return true;
}

// Project-relative, traversal-free, NUL-free, and never absolute.
function checkRelativePath(errors, value, path) {
  if (!checkNonEmptyString(errors, value, path, 1024)) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return errors.add(path, "must be a project-relative path, not an absolute path");
  if (value.includes("\\")) return errors.add(path, "must use forward slashes");
  const segments = value.split("/");
  if (segments.includes("..")) return errors.add(path, "must not contain a `..` segment");
  return true;
}

function normalizeRelativePath(value) {
  const trimmed = value.replace(/^\.\//, "").replace(/\/+$/, "");
  return trimmed.length === 0 ? "." : trimmed;
}

function checkBranchName(errors, value, path) {
  if (!checkNonEmptyString(errors, value, path, 255)) return false;
  if (/\s/.test(value)) return errors.add(path, "must not contain whitespace");
  if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".lock")) return errors.add(path, "is not a valid Git branch name");
  if (value.includes("..") || value.includes("//") || value.includes("@{")) return errors.add(path, "is not a valid Git branch name");
  if (/[~^:?*[\\\u007f]/.test(value)) return errors.add(path, "is not a valid Git branch name");
  return true;
}

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

function checkIsoTimestamp(errors, value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || Number.isNaN(Date.parse(value))) {
    return errors.add(path, "must be an ISO 8601 timestamp");
  }
  return true;
}

// ---------------------------------------------------------------------------
// Project configuration: the handwritten `adw: 1` contract
// ---------------------------------------------------------------------------

const PROJECT_KEYS = new Set(["adw", "git", "docs", "execution", "development", "components", "providers", "conventions"]);

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
    checkKnownKeys(errors, raw, new Set(["provider", "required", "transport", "access", "settings"]), path);
    if (!checkSingleLine(errors, raw.provider, `${path}/provider`, 100)) continue;
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.provider)) { errors.add(`${path}/provider`, "must be a lowercase provider name such as github"); continue; }
    const entry = { provider: raw.provider, required: false };
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

export function validateProjectConfig(data) {
  const errors = new Errors();
  if (!checkObject(errors, data, "/")) return { valid: false, errors: errors.items };
  checkKnownKeys(errors, data, PROJECT_KEYS, "");
  checkNoSecretLikeKeys(errors, data, "");
  if (data.adw !== 1) errors.add("/adw", "must equal 1");

  const normalized = {
    adw: 1,
    git: { base_branch: "main" },
    docs: { branch: "docs", worktree: "worktrees/docs", sync_marker: "SYNC.yaml" },
    execution: { mode: "sequential", max_parallel: 1, isolation: "provider-sandbox" },
    development: { runtime_versions: {} },
    components: {},
    providers: {},
    conventions: {},
  };

  if (data.git === undefined) errors.add("/git", "is required");
  else if (checkObject(errors, data.git, "/git")) {
    checkKnownKeys(errors, data.git, new Set(["base_branch"]), "/git");
    if (checkBranchName(errors, data.git.base_branch, "/git/base_branch")) normalized.git.base_branch = data.git.base_branch;
  }

  if (data.docs === undefined) errors.add("/docs", "is required");
  else if (checkObject(errors, data.docs, "/docs")) {
    checkKnownKeys(errors, data.docs, new Set(["branch", "worktree", "sync_marker"]), "/docs");
    if (checkBranchName(errors, data.docs.branch, "/docs/branch")) normalized.docs.branch = data.docs.branch;
    if (checkRelativePath(errors, data.docs.worktree, "/docs/worktree")) {
      normalized.docs.worktree = normalizeRelativePath(data.docs.worktree);
      if (normalized.docs.worktree === ".") errors.add("/docs/worktree", "must be a dedicated directory inside the project, not the project root");
    }
    if (data.docs.sync_marker !== undefined) {
      if (checkRelativePath(errors, data.docs.sync_marker, "/docs/sync_marker")) normalized.docs.sync_marker = normalizeRelativePath(data.docs.sync_marker);
    }
  }

  if (data.execution === undefined) errors.add("/execution", "is required");
  else if (checkObject(errors, data.execution, "/execution")) {
    checkKnownKeys(errors, data.execution, new Set(["mode", "max_parallel", "isolation", "web_access"]), "/execution");
    if (!EXECUTION_MODES.includes(data.execution.mode)) errors.add("/execution/mode", `must be one of: ${EXECUTION_MODES.join(", ")}`);
    else normalized.execution.mode = data.execution.mode;
    if (!ISOLATION_MODES.includes(data.execution.isolation)) errors.add("/execution/isolation", `must be one of: ${ISOLATION_MODES.join(", ")}`);
    else normalized.execution.isolation = data.execution.isolation;
    if (data.execution.max_parallel === undefined) normalized.execution.max_parallel = normalized.execution.mode === "orchestrated" ? 3 : 1;
    else if (!Number.isInteger(data.execution.max_parallel) || data.execution.max_parallel < 1 || data.execution.max_parallel > MAX_PARALLEL) {
      errors.add("/execution/max_parallel", `must be an integer between 1 and ${MAX_PARALLEL}`);
    } else normalized.execution.max_parallel = data.execution.max_parallel;
    if (data.execution.web_access !== undefined) {
      if (!WEB_ACCESS_MODES.has(data.execution.web_access)) errors.add("/execution/web_access", `must be one of: ${[...WEB_ACCESS_MODES].join(", ")}`);
      else normalized.execution.web_access = data.execution.web_access;
    }
  }

  if (data.development !== undefined && checkObject(errors, data.development, "/development")) {
    checkKnownKeys(errors, data.development, new Set(["runtime_versions"]), "/development");
    if (data.development.runtime_versions !== undefined && checkObject(errors, data.development.runtime_versions, "/development/runtime_versions")) {
      for (const [runtime, version] of Object.entries(data.development.runtime_versions)) {
        const path = `/development/runtime_versions/${runtime}`;
        if (!RUNTIMES.has(runtime)) { errors.add(path, `is not a supported runtime; expected one of: ${[...RUNTIMES].join(", ")}`); continue; }
        if (typeof version !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(version)) { errors.add(path, "must be a numeric version such as 8 or 8.0.408"); continue; }
        normalized.development.runtime_versions[runtime] = version;
      }
    }
  }

  if (data.components === undefined) errors.add("/components", "is required");
  else validateComponents(errors, data.components, normalized);

  if (data.providers !== undefined) validateProviders(errors, data.providers, normalized);

  if (data.conventions !== undefined && checkObject(errors, data.conventions, "/conventions")) {
    for (const [key, value] of Object.entries(data.conventions)) {
      const path = `/conventions/${key}`;
      if (!/^[a-z][a-z0-9_]*$/.test(key)) { errors.add(path, "must be a snake_case convention name"); continue; }
      if (checkSingleLine(errors, value, path)) normalized.conventions[key] = value;
    }
  }

  return errors.valid ? { valid: true, errors: [], data: normalized } : { valid: false, errors: errors.items };
}

export async function loadProjectConfig({ project_root, path = "adw.yaml" }) {
  if (typeof project_root !== "string" || typeof path !== "string") throw new InputError("load-project requires project_root and path");
  const target = await resolveProjectPath(project_root, path);
  let stat;
  try { stat = await lstat(target); }
  catch (error) { if (error.code === "ENOENT") throw new PathError(`project configuration does not exist: ${path}`); throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new PathError(`project configuration must be a regular non-symlink file: ${path}`);
  const bytes = await readFile(target);
  const raw = parseYaml(bytes, path);
  const validation = validateProjectConfig(raw);
  return { data: validation.data ?? raw, validation: { valid: validation.valid, errors: validation.errors }, digest: computeDigest(bytes) };
}

// ---------------------------------------------------------------------------
// Plan approval: exact plan bytes bound to a docs commit
// ---------------------------------------------------------------------------

function approvalDigest(planDigest) {
  return createHash("sha256").update(APPROVAL_DOMAIN).update(planDigest, "utf8").digest("hex");
}

export function validatePlanApproval(approval) {
  const errors = new Errors();
  if (!checkObject(errors, approval, "/")) return { valid: false, errors: errors.items };
  checkKnownKeys(errors, approval, new Set(["version", "change_id", "plan_path", "plan_digest", "plan_commit", "approved_by", "approved_at", "status", "superseded_at", "superseded_reason"]), "");
  if (approval.version !== 1) errors.add("/version", "must equal 1");
  if (typeof approval.change_id !== "string" || !CHANGE_ID.test(approval.change_id)) errors.add("/change_id", "must be a safe change id");
  if (checkRelativePath(errors, approval.plan_path, "/plan_path") && approval.plan_path !== `changes/${approval.change_id}/plan.md`) {
    errors.add("/plan_path", "must be changes/<change-id>/plan.md");
  }
  if (typeof approval.plan_digest !== "string" || !SHA256.test(approval.plan_digest)) errors.add("/plan_digest", "must be a sha256 hex digest of the exact plan bytes");
  if (typeof approval.plan_commit !== "string" || !COMMIT.test(approval.plan_commit)) errors.add("/plan_commit", "must be a 40-hex docs commit");
  checkSingleLine(errors, approval.approved_by, "/approved_by", 200);
  checkIsoTimestamp(errors, approval.approved_at, "/approved_at");
  if (approval.status !== "active" && approval.status !== "superseded") errors.add("/status", "must be active or superseded");
  if (approval.status === "active" && (approval.superseded_at !== undefined || approval.superseded_reason !== undefined)) {
    errors.add("/status", "active approvals must not carry supersession fields");
  }
  if (approval.status === "superseded") {
    checkIsoTimestamp(errors, approval.superseded_at, "/superseded_at");
    checkSingleLine(errors, approval.superseded_reason, "/superseded_reason", 1000);
  }
  return { valid: errors.valid, errors: errors.items };
}

export function createPlanApproval({ change_id, plan_path, plan_digest, plan_commit, approved_by, approved_at }) {
  const approval = {
    version: 1,
    change_id,
    plan_path: plan_path ?? `changes/${change_id}/plan.md`,
    plan_digest,
    plan_commit,
    approved_by,
    approved_at,
    status: "active",
  };
  const validation = validatePlanApproval(approval);
  if (!validation.valid) throw new InputError(`approval is invalid: ${validation.errors.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
  return approval;
}

export function supersedePlanApproval(approval, { reason, superseded_at }) {
  const current = validatePlanApproval(approval);
  if (!current.valid) throw new InputError("cannot supersede an invalid approval");
  if (approval.status !== "active") throw new InputError("only an active approval can be superseded");
  if (typeof reason !== "string" || reason.trim().length === 0) throw new InputError("supersession requires a specific human-provided reason");
  const superseded = { ...approval, status: "superseded", superseded_at, superseded_reason: reason };
  const validation = validatePlanApproval(superseded);
  if (!validation.valid) throw new InputError(`superseded approval is invalid: ${validation.errors.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
  return superseded;
}

// `plan_bytes` (exact file content) or a precomputed `plan_digest` proves the
// plan; `plan_commit` proves the docs commit that contained those exact bytes.
export function verifyPlanApproval({ approval, plan_bytes, plan_digest, plan_commit, change_id, plan_path }) {
  const validation = validatePlanApproval(approval);
  if (!validation.valid) return { verified: false, reason: "approval record is invalid", errors: validation.errors };
  if (approval.status !== "active") return { verified: false, reason: "approval has been superseded", errors: [] };
  const currentDigest = plan_bytes !== undefined ? computeDigest(plan_bytes) : plan_digest;
  if (typeof currentDigest !== "string" || !SHA256.test(currentDigest)) return { verified: false, reason: "current plan digest is missing or malformed", errors: [] };
  if (!timingSafeEqual(Buffer.from(approvalDigest(currentDigest), "hex"), Buffer.from(approvalDigest(approval.plan_digest), "hex"))) {
    return { verified: false, reason: "plan bytes changed after approval; run adw:amend and reapprove", errors: [] };
  }
  if (change_id !== undefined && change_id !== approval.change_id) return { verified: false, reason: "approval belongs to a different change", errors: [] };
  if (plan_path !== undefined && plan_path !== approval.plan_path) return { verified: false, reason: "approval binds a different plan path", errors: [] };
  if (plan_commit !== undefined && plan_commit !== approval.plan_commit) return { verified: false, reason: "approval is bound to a different docs commit", errors: [] };
  return { verified: true, reason: "approval matches the exact plan bytes and docs commit", errors: [] };
}

// ---------------------------------------------------------------------------
// Phase run records: machine-generated execution state
// ---------------------------------------------------------------------------

const GROUP_KEYS = new Set(["branch", "worktree", "tasks", "affected_paths", "tracker", "pull_request", "implementation_commit", "review", "validation", "status"]);
const REVIEW_STATUSES = new Set(["pending", "passed", "failed"]);
const VALIDATION_STATUSES = new Set(["pending", "passed", "failed"]);
const GROUP_PROGRESS = new Map(GROUP_STATUSES.map((status, index) => [status, index]));

function validateCommandEvidence(errors, item, path) {
  if (!checkObject(errors, item, path)) return;
  checkKnownKeys(errors, item, new Set(["command", "cwd", "exit_code", "signal", "timed_out", "duration_ms", "summary", "required"]), path);
  checkNonEmptyString(errors, item.command, `${path}/command`);
  if (item.cwd !== undefined) checkRelativePath(errors, item.cwd, `${path}/cwd`);
  if (!(item.exit_code === null || Number.isInteger(item.exit_code))) errors.add(`${path}/exit_code`, "must be an integer or null");
  if (!(item.signal === null || typeof item.signal === "string")) errors.add(`${path}/signal`, "must be a string or null");
  if (typeof item.timed_out !== "boolean") errors.add(`${path}/timed_out`, "must be a boolean");
  if (item.required !== undefined && typeof item.required !== "boolean") errors.add(`${path}/required`, "must be a boolean");
  if (item.summary !== undefined && typeof item.summary !== "string") errors.add(`${path}/summary`, "must be a string");
}

function commandFailed(item) {
  return item.required !== false && (item.exit_code !== 0 || item.signal !== null || item.timed_out === true);
}

function validateGroupRecord(errors, group, path) {
  if (!checkObject(errors, group, path)) return;
  checkKnownKeys(errors, group, GROUP_KEYS, path);
  checkBranchName(errors, group.branch, `${path}/branch`);
  checkRelativePath(errors, group.worktree, `${path}/worktree`);
  if (!Array.isArray(group.tasks)) errors.add(`${path}/tasks`, "must be an array of interpreted directives");
  else group.tasks.forEach((task, index) => checkNonEmptyString(errors, task, `${path}/tasks/${index}`));
  if (!Array.isArray(group.affected_paths)) errors.add(`${path}/affected_paths`, "must be an array of project-relative paths");
  else group.affected_paths.forEach((item, index) => checkRelativePath(errors, item, `${path}/affected_paths/${index}`));
  if (group.tracker !== null && group.tracker !== undefined) {
    if (checkObject(errors, group.tracker, `${path}/tracker`)) {
      checkKnownKeys(errors, group.tracker, new Set(["provider", "operation", "external_id", "url", "status"]), `${path}/tracker`);
      checkSingleLine(errors, group.tracker.provider, `${path}/tracker/provider`, 100);
      checkNoSecretLikeKeys(errors, group.tracker, `${path}/tracker`);
    }
  }
  if (group.pull_request !== null && group.pull_request !== undefined) {
    if (checkObject(errors, group.pull_request, `${path}/pull_request`)) {
      checkKnownKeys(errors, group.pull_request, new Set(["provider", "url", "number", "state"]), `${path}/pull_request`);
      checkSingleLine(errors, group.pull_request.provider, `${path}/pull_request/provider`, 100);
      checkNoSecretLikeKeys(errors, group.pull_request, `${path}/pull_request`);
    }
  }
  if (!(group.implementation_commit === null || (typeof group.implementation_commit === "string" && COMMIT.test(group.implementation_commit)))) {
    errors.add(`${path}/implementation_commit`, "must be a 40-hex commit or null");
  }
  if (checkObject(errors, group.review, `${path}/review`)) {
    checkKnownKeys(errors, group.review, new Set(["status", "high_findings"]), `${path}/review`);
    if (!REVIEW_STATUSES.has(group.review.status)) errors.add(`${path}/review/status`, `must be one of: ${[...REVIEW_STATUSES].join(", ")}`);
    if (!Array.isArray(group.review.high_findings)) errors.add(`${path}/review/high_findings`, "must be an array");
    else group.review.high_findings.forEach((item, index) => checkNonEmptyString(errors, item, `${path}/review/high_findings/${index}`));
  }
  if (checkObject(errors, group.validation, `${path}/validation`)) {
    checkKnownKeys(errors, group.validation, new Set(["status", "commands", "deferred", "recorded_at"]), `${path}/validation`);
    if (!VALIDATION_STATUSES.has(group.validation.status)) errors.add(`${path}/validation/status`, `must be one of: ${[...VALIDATION_STATUSES].join(", ")}`);
    if (!Array.isArray(group.validation.commands)) errors.add(`${path}/validation/commands`, "must be an array");
    else group.validation.commands.forEach((item, index) => validateCommandEvidence(errors, item, `${path}/validation/commands/${index}`));
    const deferred = group.validation.deferred ?? [];
    if (!Array.isArray(deferred)) errors.add(`${path}/validation/deferred`, "must be an array");
    // A passing validation may never contain a required failure, signal,
    // timeout, or deferral. This is the truthful-evidence invariant.
    if (group.validation.status === "passed") {
      if (Array.isArray(group.validation.commands) && group.validation.commands.some(commandFailed)) {
        errors.add(`${path}/validation/status`, "cannot be passed while a required command failed, was signaled, or timed out");
      }
      if (Array.isArray(deferred) && deferred.some((item) => item?.required !== false)) {
        errors.add(`${path}/validation/status`, "cannot be passed while a required check is deferred");
      }
    }
  }
  if (!GROUP_PROGRESS.has(group.status)) errors.add(`${path}/status`, `must be one of: ${GROUP_STATUSES.join(", ")}`);
  if (group.status === "passed") {
    if (group.review?.status !== "passed") errors.add(`${path}/status`, "cannot be passed before independent review passes");
    if (group.validation?.status !== "passed") errors.add(`${path}/status`, "cannot be passed before validation passes");
  }
}

export function validateRunRecord(record) {
  const errors = new Errors();
  if (!checkObject(errors, record, "/")) return { valid: false, errors: errors.items };
  checkKnownKeys(errors, record, new Set(["version", "change_id", "phase_id", "plan_digest", "base_branch", "base_commit", "started_at", "completed_at", "status", "groups"]), "");
  if (record.version !== 1) errors.add("/version", "must equal 1");
  if (typeof record.change_id !== "string" || !CHANGE_ID.test(record.change_id)) errors.add("/change_id", "must be a safe change id");
  if (typeof record.phase_id !== "string" || !IDENTIFIER.test(record.phase_id)) errors.add("/phase_id", "must be a safe phase id");
  if (typeof record.plan_digest !== "string" || !SHA256.test(record.plan_digest)) errors.add("/plan_digest", "must be the sha256 digest of the approved plan bytes");
  checkBranchName(errors, record.base_branch, "/base_branch");
  if (typeof record.base_commit !== "string" || !COMMIT.test(record.base_commit)) errors.add("/base_commit", "must be a 40-hex commit");
  checkIsoTimestamp(errors, record.started_at, "/started_at");
  if (!PHASE_STATUSES.includes(record.status)) errors.add("/status", `must be one of: ${PHASE_STATUSES.join(", ")}`);
  if (record.status === "running") {
    if (record.completed_at !== null) errors.add("/completed_at", "must be null while the phase is running");
  } else checkIsoTimestamp(errors, record.completed_at, "/completed_at");

  if (!checkObject(errors, record.groups, "/groups")) return { valid: errors.valid, errors: errors.items };
  const groupIds = Object.keys(record.groups);
  if (groupIds.length === 0) errors.add("/groups", "must contain at least one group");
  const branches = new Set();
  const worktrees = new Set();
  for (const [id, group] of Object.entries(record.groups)) {
    const path = `/groups/${id}`;
    if (!IDENTIFIER.test(id)) { errors.add(path, "group id must be lowercase alphanumeric with `-` or `_` separators"); continue; }
    validateGroupRecord(errors, group, path);
    if (typeof group?.branch === "string") {
      if (branches.has(group.branch)) errors.add(`${path}/branch`, "duplicates another group's branch");
      branches.add(group.branch);
    }
    if (typeof group?.worktree === "string") {
      const normalizedWorktree = normalizeRelativePath(group.worktree);
      if (worktrees.has(normalizedWorktree)) errors.add(`${path}/worktree`, "duplicates another group's worktree");
      worktrees.add(normalizedWorktree);
    }
  }
  if (record.status === "passed" && Object.values(record.groups).some((group) => group?.status !== "passed")) {
    errors.add("/status", "cannot be passed while a group has not passed");
  }
  return { valid: errors.valid, errors: errors.items };
}

export function createRunRecord({ change_id, phase_id, plan_digest, base_branch, base_commit, started_at, groups }) {
  if (!Array.isArray(groups) || groups.length === 0) throw new InputError("a phase run record requires at least one group");
  const record = {
    version: 1,
    change_id,
    phase_id,
    plan_digest,
    base_branch,
    base_commit,
    started_at,
    completed_at: null,
    status: "running",
    groups: {},
  };
  for (const group of groups) {
    if (!isObject(group) || typeof group.group_id !== "string") throw new InputError("each group requires a group_id");
    if (Object.hasOwn(record.groups, group.group_id)) throw new InputError(`duplicate group id: ${group.group_id}`);
    record.groups[group.group_id] = {
      branch: group.branch ?? `adw/${change_id}/${group.group_id}`,
      worktree: group.worktree ?? `worktrees/${change_id}/${group.group_id}`,
      tasks: [...(group.tasks ?? [])],
      affected_paths: [...(group.affected_paths ?? [])],
      tracker: group.tracker ?? null,
      pull_request: group.pull_request ?? null,
      implementation_commit: null,
      review: { status: "pending", high_findings: [] },
      validation: { status: "pending", commands: [] },
      status: "prepared",
    };
  }
  const validation = validateRunRecord(record);
  if (!validation.valid) throw new InputError(`run record is invalid: ${validation.errors.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
  return record;
}

// Group status may only move forward through the pipeline, or terminate in
// `failed`/`blocked`. Phases may only move out of `running`.
function assertGroupTransition(id, from, to) {
  if (from === to) return;
  if (to === "failed" || to === "blocked") return;
  if (from === "failed" || from === "blocked") throw new InputError(`group ${id} cannot leave the terminal status ${from}`);
  if (from === "passed") throw new InputError(`group ${id} cannot leave the terminal status passed`);
  if (GROUP_PROGRESS.get(to) <= GROUP_PROGRESS.get(from)) throw new InputError(`group ${id} cannot move backwards from ${from} to ${to}`);
}

export function updateRunRecord(record, update) {
  const current = validateRunRecord(record);
  if (!current.valid) throw new InputError(`cannot update an invalid run record: ${current.errors.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
  if (!isObject(update)) throw new InputError("run-record update must be an object");
  const next = structuredClone(record);
  if (update.status !== undefined) {
    if (record.status !== "running" && update.status !== record.status) throw new InputError(`phase ${record.phase_id} cannot leave the terminal status ${record.status}`);
    next.status = update.status;
  }
  if (update.completed_at !== undefined) next.completed_at = update.completed_at;
  if (next.status !== "running" && next.completed_at === null) throw new InputError("a finished phase requires completed_at");
  for (const [id, patch] of Object.entries(update.groups ?? {})) {
    const group = next.groups[id];
    if (!group) throw new InputError(`unknown group: ${id}`);
    if (!isObject(patch)) throw new InputError(`group ${id} update must be an object`);
    for (const key of Object.keys(patch)) if (!GROUP_KEYS.has(key)) throw new InputError(`group ${id} update contains an unsupported field: ${key}`);
    if (patch.branch !== undefined && patch.branch !== group.branch) throw new InputError(`group ${id} branch is immutable once prepared`);
    if (patch.worktree !== undefined && patch.worktree !== group.worktree) throw new InputError(`group ${id} worktree is immutable once prepared`);
    if (patch.status !== undefined) {
      if (!GROUP_PROGRESS.has(patch.status)) throw new InputError(`group ${id} status is not a known status: ${patch.status}`);
      assertGroupTransition(id, group.status, patch.status);
    }
    Object.assign(group, patch);
  }
  const validation = validateRunRecord(next);
  if (!validation.valid) throw new InputError(`run record update is invalid: ${validation.errors.map(({ path, message }) => `${path} ${message}`).join("; ")}`);
  return next;
}

// ---------------------------------------------------------------------------
// Validation evidence
// ---------------------------------------------------------------------------

function redactAndBound(text) {
  return String(text ?? "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .slice(-4000);
}

export function recordValidation({ recorded_at, commands = [], deferred = [] }) {
  const normalized = commands.map((item) => ({
    command: item.command,
    cwd: item.cwd,
    exit_code: item.exit_code ?? null,
    signal: item.signal ?? null,
    timed_out: item.timed_out === true,
    duration_ms: item.duration_ms,
    summary: redactAndBound(item.summary),
    required: item.required !== false,
  }));
  const normalizedDeferred = deferred.map((item) => ({ command: item.command, reason: item.reason, required: item.required !== false }));
  const failed = normalized.some(commandFailed) || normalizedDeferred.some((item) => item.required);
  return { recorded_at, status: failed ? "failed" : "passed", commands: normalized, deferred: normalizedDeferred };
}

// Deduplicate identical command/cwd pairs conservatively: the strictest
// `required` flag and the shortest timeout win.
export function resolveValidationCommands(sources) {
  const resolved = new Map();
  for (const item of sources ?? []) {
    if (typeof item?.command !== "string" || item.command.length === 0) throw new InputError("each validation entry requires a command");
    const cwd = item.cwd ?? ".";
    const key = `${cwd}\0${item.command}`;
    const timeout = item.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const required = item.required !== false;
    const previous = resolved.get(key);
    if (!previous) resolved.set(key, { command: item.command, cwd, timeout_ms: timeout, required, ...(item.source ? { source: item.source } : {}) });
    else resolved.set(key, { ...previous, required: previous.required || required, timeout_ms: Math.min(previous.timeout_ms, timeout) });
  }
  return [...resolved.values()];
}

export async function runValidationCommand(input, cwd) {
  if (!input || typeof input.command !== "string" || input.command.length === 0 || PLACEHOLDER.test(input.command)) throw new InputError("each validation command requires a resolved non-placeholder command string");
  const started = Date.now();
  if (input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 1)) throw new InputError("timeout_ms must be a positive integer");
  return await new Promise((done) => {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn(input.command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"], detached: useProcessGroup });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let exitCode = null;
    let exitSignal = null;
    let timeoutTimer;
    let escalationTimer;
    let forceFinishTimer;
    const clearTimers = () => {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (escalationTimer) clearTimeout(escalationTimer);
      if (forceFinishTimer) clearTimeout(forceFinishTimer);
    };
    const result = (error) => ({
      command: input.command,
      cwd,
      exit_code: error ? 1 : exitCode,
      signal: error ? null : exitSignal,
      timed_out: timedOut,
      duration_ms: Date.now() - started,
      summary: redactAndBound(error?.message ?? (`${stdout}${stderr}`.trim() || (exitSignal ? `terminated by ${exitSignal}` : ""))),
      required: input.required !== false
    });
    const finish = (error) => { if (settled) return; settled = true; clearTimers(); done(result(error)); };
    const signalTree = (signal) => {
      try {
        if (useProcessGroup && child.pid !== undefined) process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch (error) {
        if (error.code !== "ESRCH") stderr += `${stderr ? "\n" : ""}could not send ${signal}: ${error.message}`;
      }
    };
    const processTreeExists = () => {
      if (!useProcessGroup || child.pid === undefined) return child.exitCode === null && child.signalCode === null;
      try { process.kill(-child.pid, 0); return true; }
      catch (error) { return error.code !== "ESRCH"; }
    };
    timeoutTimer = input.timeout_ms ? setTimeout(() => {
      timedOut = true;
      signalTree("SIGTERM");
      escalationTimer = setTimeout(() => {
        signalTree("SIGKILL");
        // Descendants can keep the inherited pipes open after the shell exits. Do
        // not let those pipes make the validation promise unbounded.
        child.stdout.destroy();
        child.stderr.destroy();
        forceFinishTimer = setTimeout(() => {
          exitSignal ??= "SIGKILL";
          finish();
        }, VALIDATION_PIPE_CLOSE_GRACE_MS);
      }, VALIDATION_TERMINATION_GRACE_MS);
    }, input.timeout_ms) : undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => { exitCode = code; exitSignal = signal; });
    child.on("close", (code, signal) => {
      exitCode = code;
      exitSignal = signal;
      if (!timedOut || !processTreeExists()) finish();
    });
  });
}

// ---------------------------------------------------------------------------
// Confined paths and atomic managed-file writes
// ---------------------------------------------------------------------------

export async function resolveProjectPath(projectRoot, explicitRelativePath) {
  if (typeof projectRoot !== "string" || typeof explicitRelativePath !== "string" || !projectRoot || !explicitRelativePath || isAbsolute(explicitRelativePath) || explicitRelativePath.includes("\0")) throw new PathError("paths must be explicit project-relative paths");
  const root = await realpath(projectRoot);
  const target = resolve(root, explicitRelativePath);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new PathError(`path escapes the project root: ${explicitRelativePath}`);
  let ancestor = dirname(target);
  while (true) {
    try {
      const actual = await realpath(ancestor);
      const actualRel = relative(root, actual);
      if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new PathError(`path resolves outside the project root: ${explicitRelativePath}`);
      break;
    } catch (error) {
      if (error instanceof PathError || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return target;
}

export async function resolveProjectDirectory(projectRoot, explicitRelativePath) {
  const root = await realpath(projectRoot);
  const target = explicitRelativePath === "." ? root : await resolveProjectPath(projectRoot, explicitRelativePath);
  let targetStat;
  try { targetStat = await lstat(target); }
  catch (error) { if (error.code === "ENOENT") throw new PathError(`validation cwd does not exist: ${explicitRelativePath}`); throw error; }
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new PathError(`validation cwd must be a real project directory: ${explicitRelativePath}`);
  const actual = await realpath(target);
  const actualRel = relative(root, actual);
  if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new PathError(`validation cwd resolves outside the project root: ${explicitRelativePath}`);
  return actual;
}

export async function applyAtomicWrites(projectRoot, operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new InputError("atomic write requires at least one explicit operation");
  for (const operation of operations) if (!operation || typeof operation.path !== "string" || typeof operation.content !== "string") throw new InputError("each atomic write operation requires string path and content fields");
  const destinations = await Promise.all(operations.map((operation) => resolveProjectPath(projectRoot, operation.path)));
  if (new Set(destinations).size !== destinations.length) throw new InputError("atomic write contains duplicate destination paths");
  const root = await realpath(projectRoot);
  const transaction = await mkdtemp(resolve(root, ".adw-atomic-write-"));
  const originals = [];
  try {
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const destination = destinations[index];
      let previous = null;
      let destinationStat;
      try {
        destinationStat = await lstat(destination);
        if (destinationStat.isSymbolicLink()) throw new PathError(`destination is a symbolic link: ${operation.path}`);
        previous = await readFile(destination, "utf8");
      } catch (error) { if (error instanceof PathError || error.code !== "ENOENT") throw error; }
      if (Object.hasOwn(operation, "expected_content") && operation.expected_content !== previous) throw new AtomicWriteError(`precondition failed for ${operation.path}`);
      const staged = resolve(transaction, `new-${index}`);
      await writeFile(staged, operation.content, { encoding: "utf8", mode: destinationStat?.mode ?? 0o644, flag: "wx" });
      await mkdir(dirname(destination), { recursive: true });
      // Re-resolve immediately before mutation so a replaced parent symlink is caught.
      if (await resolveProjectPath(projectRoot, operation.path) !== destination) throw new PathError(`path changed while atomic writes were prepared: ${operation.path}`);
      let backup;
      try {
        const currentStat = await lstat(destination);
        if (!destinationStat || currentStat.isSymbolicLink() || currentStat.dev !== destinationStat.dev || currentStat.ino !== destinationStat.ino) throw new AtomicWriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
        backup = resolve(transaction, `old-${index}`);
        // Preserve the old inode for rollback without first removing its
        // destination name. The following rename can therefore replace the
        // destination atomically instead of exposing an absent-path window.
        await link(destination, backup);
        const backupStat = await lstat(backup);
        const latestStat = await lstat(destination);
        if (backupStat.isSymbolicLink() || latestStat.isSymbolicLink() || backupStat.dev !== destinationStat.dev || backupStat.ino !== destinationStat.ino || latestStat.dev !== destinationStat.dev || latestStat.ino !== destinationStat.ino) throw new AtomicWriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (destinationStat) throw new AtomicWriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
      }
      const original = { destination, backup, committed: false };
      originals.push(original);
      await rename(staged, destination);
      original.committed = true;
    }
  } catch (error) {
    for (const original of originals.reverse()) {
      if (!original.committed) continue;
      if (original.backup) await rename(original.backup, original.destination);
      else await rm(original.destination, { force: true });
    }
    if (error instanceof InputError || error instanceof PathError || error instanceof AtomicWriteError) throw error;
    throw new AtomicWriteError(error.message, { cause: error });
  } finally {
    await rm(transaction, { recursive: true, force: true });
  }
}

class CodedError extends Error { constructor(message, code, options) { super(message, options); this.code = code; } }
export class InputError extends CodedError { constructor(message, options) { super(message, EXIT.INPUT, options); } }
export class PathError extends CodedError { constructor(message, options) { super(message, EXIT.PATH_VIOLATION, options); } }
export class AtomicWriteError extends CodedError { constructor(message, options) { super(message, EXIT.ATOMIC_WRITE_FAILED, options); } }

function requireObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new InputError("input must be a JSON object");
  return value;
}

export async function dispatch(command, rawInput) {
  const input = requireObject(rawInput);
  switch (command) {
    case "digest": {
      if (typeof input.content === "string") return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", digest: computeDigest(input.content) } };
      if (typeof input.project_root !== "string" || typeof input.path !== "string") throw new InputError("digest requires content or project_root and path");
      const target = await resolveProjectPath(input.project_root, input.path);
      const stat = await lstat(target);
      if (stat.isSymbolicLink() || !stat.isFile()) throw new PathError(`digest target must be a regular non-symlink file: ${input.path}`);
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", path: input.path, digest: computeDigest(await readFile(target)) } };
    }
    case "validate-project": {
      const validation = validateProjectConfig(input.data);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.CONTRACT_INVALID, body: { ok: validation.valid, errors: validation.errors, ...(validation.valid ? { data: validation.data } : {}) } };
    }
    case "load-project": {
      const loaded = await loadProjectConfig(input);
      return { exitCode: loaded.validation.valid ? EXIT.OK : EXIT.CONTRACT_INVALID, body: { ok: loaded.validation.valid, data: loaded.data, digest: loaded.digest, errors: loaded.validation.errors } };
    }
    case "create-approval": {
      const approval = createPlanApproval(input);
      return { exitCode: EXIT.OK, body: { ok: true, approval } };
    }
    case "validate-approval": {
      const validation = validatePlanApproval(input.approval);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.CONTRACT_INVALID, body: { ok: validation.valid, errors: validation.errors } };
    }
    case "verify-approval": {
      const result = verifyPlanApproval(input);
      return { exitCode: result.verified ? EXIT.OK : EXIT.APPROVAL_INVALID, body: { ok: result.verified, ...result } };
    }
    case "supersede-approval": {
      const approval = supersedePlanApproval(input.approval, { reason: input.reason, superseded_at: input.superseded_at });
      return { exitCode: EXIT.OK, body: { ok: true, approval, history_path: `approval-history/${approval.plan_digest}.json` } };
    }
    case "create-run-record": {
      const record = createRunRecord(input);
      return { exitCode: EXIT.OK, body: { ok: true, record } };
    }
    case "validate-run-record": {
      const validation = validateRunRecord(input.record);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.CONTRACT_INVALID, body: { ok: validation.valid, errors: validation.errors } };
    }
    case "update-run-record": {
      const record = updateRunRecord(input.record, input.update);
      return { exitCode: EXIT.OK, body: { ok: true, record } };
    }
    case "resolve-validation":
      return { exitCode: EXIT.OK, body: { ok: true, commands: resolveValidationCommands(input.commands) } };
    case "record-validation": {
      const evidence = recordValidation(input);
      return { exitCode: evidence.status === "passed" ? EXIT.OK : EXIT.VALIDATION_FAILED, body: { ok: evidence.status === "passed", evidence } };
    }
    case "run-validation": {
      if (typeof input.project_root !== "string") throw new InputError("project_root is required");
      const resolved = resolveValidationCommands(input.commands);
      const commands = [];
      for (const item of resolved) {
        const cwd = await resolveProjectDirectory(input.project_root, item.cwd ?? input.cwd ?? ".");
        // Report the project-relative cwd rather than the absolute local path.
        commands.push({ ...(await runValidationCommand(item, cwd)), cwd: item.cwd ?? "." });
      }
      const evidence = recordValidation({ recorded_at: input.recorded_at, commands, deferred: input.deferred ?? [] });
      return { exitCode: evidence.status === "passed" ? EXIT.OK : EXIT.VALIDATION_FAILED, body: { ok: evidence.status === "passed", evidence } };
    }
    case "apply-atomic-writes":
      await applyAtomicWrites(input.project_root, input.operations);
      return { exitCode: EXIT.OK, body: { ok: true, written: input.operations.map((operation) => operation.path) } };
    default:
      throw new InputError(`unknown command ${JSON.stringify(command)}`);
  }
}

async function main() {
  const command = process.argv[2];
  if (!command) throw new InputError("missing internal helper command");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  let input;
  try { input = JSON.parse(text || "{}"); } catch (error) { throw new InputError(`stdin is not valid JSON: ${error.message}`, { cause: error }); }
  return await dispatch(command, input);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await main();
    process.stdout.write(`${JSON.stringify(result.body)}\n`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const exitCode = Number.isInteger(error.code) ? error.code : EXIT.INTERNAL;
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: exitCode, message: error.message } })}\n`);
    process.exitCode = exitCode;
  }
}
