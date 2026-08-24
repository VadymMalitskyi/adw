// Versioned, provider-neutral data contract for deterministic execution.
// This module deliberately has no runtime dependencies beyond safe-files.
import { ContractError, isObject, isSafeRelativePath, normalizeRelativePath } from "./safe-files.mjs";

export const EXECUTION_SCHEMA_VERSION = 1;
export const MAX_STRING_LENGTH = 16_384;
export const MAX_GROUPS = 32;
export const MAX_ARRAY_LENGTH = 128;

const packetKeys = ["schema_version", "phase_id", "groups"];
const groupKeys = ["group_id", "tasks", "affected_paths", "branch", "worktree", "validation", "review_level"];
const validationKeys = ["component", "cwd", "command"];
const envelopeKeys = ["schema_version", "packet", "targets", "coordinator", "non_targets"];
const targetKeys = ["group_id", "head", "status"];
const checkoutKeys = ["path", "head", "status"];
const providerKeys = ["schema_version", "provider", "groups"];
const providerGroupKeys = ["group_id", "status", "fix_cycles", "findings"];
const findingKeys = ["severity", "summary"];
const eventKeys = ["schema_version", "event", "group_id", "stage", "status", "duration_ms", "result"];
const finalKeys = ["schema_version", "status", "groups_passed", "groups_failed", "groups", "validations"];
const finalGroupKeys = ["group_id", "status", "reason"];
const finalValidationKeys = ["component", "cwd", "command", "source", "required", "exit_code", "signal", "timed_out", "duration_ms", "stdout_bytes", "stderr_bytes", "stdout_truncated", "stderr_truncated"];

function fail(message) { throw new ContractError(`execution contract: ${message}`); }
function object(value, name) { if (!isObject(value)) fail(`${name} must be an object`); return value; }
function keys(value, allowed, name) {
  object(value, name);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${name} contains unknown field: ${key}`);
}
function string(value, name, { min = 1, max = MAX_STRING_LENGTH } = {}) {
  if (typeof value !== "string" || value.length < min || value.length > max || value.includes("\0")) fail(`${name} must be a bounded string`);
  return value;
}
function integer(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer`);
  return value;
}
function array(value, name, { min = 0, max = MAX_ARRAY_LENGTH } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`${name} must be an array of bounded length`);
  return value;
}
function enumValue(value, name, values) { if (!values.includes(value)) fail(`${name} must be one of ${values.join(", ")}`); return value; }
function relativePath(value, name, { dot = false } = {}) {
  if (!isSafeRelativePath(value)) fail(`${name} must be a safe project-relative path`);
  const normalized = normalizeRelativePath(value);
  if ((!dot && normalized === ".") || normalized.split("/").includes("..")) fail(`${name} must not be the project root`);
  return normalized;
}
function exactKeys(value, expected, name) { keys(value, expected, name); for (const key of expected) if (!Object.hasOwn(value, key)) fail(`${name}.${key} is required`); }

export function isPathInScope(path, scope) {
  return path === scope || path.startsWith(`${scope}/`);
}

export function scopesOverlap(left, right) {
  return isPathInScope(left, right) || isPathInScope(right, left);
}

export function validateExecutionPacket(value) {
  exactKeys(value, packetKeys, "packet");
  if (value.schema_version !== EXECUTION_SCHEMA_VERSION) fail("packet.schema_version is unsupported");
  const phase_id = string(value.phase_id, "packet.phase_id", { max: 128 });
  const groups = array(value.groups, "packet.groups", { min: 1, max: MAX_GROUPS }).map((group, index) => validateExecutionGroup(group, `packet.groups[${index}]`));
  const ids = new Set(); const branches = new Set(); const worktrees = new Set();
  for (const group of groups) {
    if (ids.has(group.group_id) || branches.has(group.branch) || worktrees.has(group.worktree)) fail("packet groups must have unique group_id, branch, and worktree");
    ids.add(group.group_id); branches.add(group.branch); worktrees.add(group.worktree);
  }
  for (let index = 0; index < groups.length; index += 1) for (let other = index + 1; other < groups.length; other += 1) {
    for (const scope of groups[index].affected_paths) for (const candidate of groups[other].affected_paths) if (scopesOverlap(scope, candidate)) fail(`packet group scopes overlap: ${scope} and ${candidate}`);
  }
  return { schema_version: EXECUTION_SCHEMA_VERSION, phase_id, groups };
}

export function validateExecutionGroup(value, name = "group") {
  exactKeys(value, groupKeys, name);
  const group_id = string(value.group_id, `${name}.group_id`, { max: 128 });
  if (!/^[a-z0-9][a-z0-9-]*$/.test(group_id)) fail(`${name}.group_id must be lowercase kebab-case`);
  const affected_paths = array(value.affected_paths, `${name}.affected_paths`, { min: 1 }).map((path, index) => relativePath(path, `${name}.affected_paths[${index}]`));
  if (new Set(affected_paths).size !== affected_paths.length) fail(`${name}.affected_paths must be unique`);
  for (let index = 0; index < affected_paths.length; index += 1) for (let other = index + 1; other < affected_paths.length; other += 1) if (scopesOverlap(affected_paths[index], affected_paths[other])) fail(`${name}.affected_paths must not overlap`);
  const validation = array(value.validation, `${name}.validation`).map((entry, index) => validateValidationReference(entry, `${name}.validation[${index}]`));
  const references = new Set(validation.map((entry) => `${entry.component}\u0000${entry.cwd}\u0000${entry.command}`));
  if (references.size !== validation.length) fail(`${name}.validation must be unique`);
  return {
    group_id,
    tasks: string(value.tasks, `${name}.tasks`),
    affected_paths,
    branch: string(value.branch, `${name}.branch`, { max: 256 }),
    worktree: relativePath(value.worktree, `${name}.worktree`),
    validation,
    review_level: enumValue(value.review_level, `${name}.review_level`, ["full", "mechanical"]),
  };
}

export function validateValidationReference(value, name = "validation") {
  exactKeys(value, validationKeys, name);
  const component = string(value.component, `${name}.component`, { max: 128 });
  if (!/^[a-z][a-z0-9-]*$/.test(component)) fail(`${name}.component is invalid`);
  return { component, cwd: relativePath(value.cwd, `${name}.cwd`, { dot: true }), command: string(value.command, `${name}.command`, { max: 4096 }) };
}

export function validateExecutionEnvelope(value) {
  exactKeys(value, envelopeKeys, "envelope");
  if (value.schema_version !== EXECUTION_SCHEMA_VERSION) fail("envelope.schema_version is unsupported");
  const packet = validateExecutionPacket(value.packet);
  const targets = array(value.targets, "envelope.targets", { min: packet.groups.length, max: MAX_GROUPS }).map((target, index) => {
    exactKeys(target, targetKeys, `envelope.targets[${index}]`);
    return { group_id: string(target.group_id, "envelope target group_id", { max: 128 }), head: string(target.head, "envelope target head", { max: 128 }), status: string(target.status, "envelope target status", { min: 0, max: 1_048_576 }) };
  });
  if (new Set(targets.map(({ group_id }) => group_id)).size !== targets.length || targets.length !== packet.groups.length || !targets.every(({ group_id }) => packet.groups.some((group) => group.group_id === group_id))) fail("envelope targets must exactly match packet groups");
  const checkout = (value, name) => { exactKeys(value, checkoutKeys, name); return { path: relativePath(value.path, `${name}.path`, { dot: true }), head: string(value.head, `${name}.head`, { max: 128 }), status: string(value.status, `${name}.status`, { min: 0, max: 1_048_576 }) }; };
  const coordinator = checkout(value.coordinator, "envelope.coordinator");
  const non_targets = array(value.non_targets, "envelope.non_targets", { max: MAX_GROUPS }).map((entry, index) => checkout(entry, `envelope.non_targets[${index}]`));
  return { schema_version: EXECUTION_SCHEMA_VERSION, packet, targets, coordinator, non_targets };
}

export function validateProviderResult(value) {
  exactKeys(value, providerKeys, "provider result");
  if (value.schema_version !== EXECUTION_SCHEMA_VERSION) fail("provider result.schema_version is unsupported");
  const provider = enumValue(value.provider, "provider result.provider", ["codex", "claude"]);
  const groups = array(value.groups, "provider result.groups", { min: 1, max: MAX_GROUPS }).map((group, index) => {
    exactKeys(group, providerGroupKeys, `provider result.groups[${index}]`);
    const findings = array(group.findings, `provider result.groups[${index}].findings`).map((finding, findingIndex) => { exactKeys(finding, findingKeys, "finding"); return { severity: enumValue(finding.severity, "finding.severity", ["high", "medium", "low"]), summary: string(finding.summary, `finding[${findingIndex}].summary`, { max: 2048 }) }; });
    return { group_id: string(group.group_id, "provider result group_id", { max: 128 }), status: enumValue(group.status, "provider result group status", ["passed", "failed"]), fix_cycles: integer(group.fix_cycles, "provider result fix_cycles", { max: 2 }), findings };
  });
  if (new Set(groups.map(({ group_id }) => group_id)).size !== groups.length) fail("provider result group ids must be unique");
  return { schema_version: EXECUTION_SCHEMA_VERSION, provider, groups };
}

export function validateLifecycleEvent(value) {
  keys(value, eventKeys, "lifecycle event");
  if (value.schema_version !== EXECUTION_SCHEMA_VERSION) fail("lifecycle event.schema_version is unsupported");
  const normalized = { schema_version: EXECUTION_SCHEMA_VERSION, event: enumValue(value.event, "lifecycle event.event", ["workflow.started", "group.started", "stage.completed", "group.completed", "workflow.completed"]) };
  for (const field of ["group_id", "stage", "status"]) if (Object.hasOwn(value, field)) normalized[field] = string(value[field], `lifecycle event.${field}`, { max: 128 });
  if (Object.hasOwn(value, "duration_ms")) normalized.duration_ms = integer(value.duration_ms, "lifecycle event.duration_ms", { max: 86_400_000 });
  if (Object.hasOwn(value, "result")) normalized.result = validateProviderResult(value.result);
  return normalized;
}

export function validateFinalResult(value) {
  exactKeys(value, finalKeys, "final result");
  if (value.schema_version !== EXECUTION_SCHEMA_VERSION) fail("final result.schema_version is unsupported");
  const groups = array(value.groups, "final result.groups", { max: MAX_GROUPS }).map((group, index) => { exactKeys(group, finalGroupKeys, `final result.groups[${index}]`); return { group_id: string(group.group_id, "final result group_id", { max: 128 }), status: enumValue(group.status, "final result group status", ["passed", "failed"]), reason: string(group.reason, "final result group reason", { min: 0, max: 2048 }) }; });
  const passed = array(value.groups_passed, "final result.groups_passed", { max: MAX_GROUPS }).map((id) => string(id, "final result group id", { max: 128 }));
  const failed = array(value.groups_failed, "final result.groups_failed", { max: MAX_GROUPS }).map((id) => string(id, "final result group id", { max: 128 }));
  if (new Set([...passed, ...failed]).size !== passed.length + failed.length || groups.length !== passed.length + failed.length) fail("final result group summaries must be disjoint and complete");
  const validations = array(value.validations, "final result.validations").map((validation, index) => { exactKeys(validation, finalValidationKeys, `final result.validations[${index}]`); return Object.fromEntries(finalValidationKeys.map((key) => [key, validation[key]])); });
  for (const validation of validations) {
    validateValidationReference(validation);
    string(validation.source, "validation.source", { min: 0, max: 512 });
    if (typeof validation.required !== "boolean" || typeof validation.timed_out !== "boolean" || typeof validation.stdout_truncated !== "boolean" || typeof validation.stderr_truncated !== "boolean") fail("validation boolean metadata is invalid");
    if (validation.exit_code !== null) integer(validation.exit_code, "validation.exit_code", { max: 255 });
    if (validation.signal !== null) string(validation.signal, "validation.signal", { max: 64 });
    for (const key of ["duration_ms", "stdout_bytes", "stderr_bytes"]) integer(validation[key], `validation.${key}`, { max: Number.MAX_SAFE_INTEGER });
  }
  return { schema_version: EXECUTION_SCHEMA_VERSION, status: enumValue(value.status, "final result.status", ["passed", "failed"]), groups_passed: passed, groups_failed: failed, groups, validations };
}

// Normalizer aliases make callers state their intent while retaining fail-closed
// validation semantics.
export const normalizeExecutionPacket = validateExecutionPacket;
export const normalizeExecutionEnvelope = validateExecutionEnvelope;
