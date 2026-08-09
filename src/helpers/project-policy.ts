import { createHash } from "node:crypto";

export interface ResolvedValidation {
  command: string;
  cwd: string;
  timeout_ms: number;
  required: boolean;
  source: string;
}

type RecordValue = Record<string, any>;

function canonicalJson(value: any): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  throw new TypeError("policy values must be JSON-compatible");
}

export function computePolicyDigest(policy: unknown): string {
  return createHash("sha256").update("ADW-EFFECTIVE-POLICY-V1\0").update(canonicalJson(policy)).digest("hex");
}

function safePath(path: string, label: string): string {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\0") || path.split("/").includes("..")) throw new TypeError(`${label} must be a safe project-relative path`);
  return path.replace(/^\.\//, "").replace(/\/$/, "") || ".";
}

function matches(componentPath: string, affectedPath: string): boolean {
  return componentPath === "." || affectedPath === componentPath || affectedPath.startsWith(`${componentPath}/`);
}

function validationItem(item: any, sourcePath: string, defaultCwd = "."): ResolvedValidation {
  if (typeof item === "string") return { command: item, cwd: defaultCwd, timeout_ms: 120000, required: true, source: sourcePath };
  return { command: item.command, cwd: item.cwd ?? defaultCwd, timeout_ms: item.timeout_ms ?? 120000, required: item.required !== false, source: item.source };
}

export function validateWorkItemPayload(profile: RecordValue, payload: RecordValue): { valid: boolean; errors: string[]; normalized?: RecordValue } {
  const errors: string[] = [];
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { valid: false, errors: ["payload must be an object"] };
  if (payload.provider !== profile.provider) errors.push(`payload provider must be ${profile.provider}`);
  if (payload.object_type !== profile.object_type) errors.push(`payload object_type must be ${profile.object_type}`);
  if (!payload.fields || typeof payload.fields !== "object" || Array.isArray(payload.fields)) errors.push("payload fields must be an object");
  if (errors.length) return { valid: false, errors };
  const fields = { ...(profile.defaults ?? {}), ...payload.fields };
  const forbidden = /(?:password|passwd|token|api[_-]?key|secret|credential)/i;
  for (const field of profile.required_fields ?? []) if (!(field in fields)) errors.push(`required field is missing: ${field}`);
  const allowed = new Set([...(profile.required_fields ?? []), ...(profile.allowed_fields ?? []), ...Object.keys(profile.defaults ?? {})]);
  for (const field of Object.keys(fields)) if (!allowed.has(field)) errors.push(`field is not allowed by profile: ${field}`);
  for (const field of Object.keys(fields)) if (forbidden.test(field)) errors.push(`credential-like field is forbidden: ${field}`);
  for (const [field, value] of Object.entries(fields)) if (!(typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string")))) errors.push(`field value must be a scalar or string array: ${field}`);
  return errors.length ? { valid: false, errors } : { valid: true, errors: [], normalized: { provider: profile.provider, object_type: profile.object_type, fields } };
}

export function resolveProjectPolicy({ project, affected_paths, profiles = {} }: { project: RecordValue; affected_paths: string[]; profiles?: Record<string, RecordValue> }): RecordValue {
  if (!project || ![4, 5].includes(project.schema)) throw new TypeError("effective policy resolution requires project schema 4 or 5");
  if (!Array.isArray(affected_paths) || affected_paths.length === 0) throw new TypeError("affected_paths must be a non-empty array");
  const paths = [...new Set(affected_paths.map((path) => safePath(path, "affected path")))];
  const components = Object.entries(project.components ?? {}).map(([name, value]: [string, any]) => ({ name, ...value, path: safePath(value.path, `component ${name} path`) }));
  const selected = new Set<string>();
  const unownedPaths: string[] = [];
  for (const path of paths) {
    const candidates = components.filter((component) => matches(component.path, path));
    if (candidates.length === 0) { unownedPaths.push(path); continue; }
    const longest = Math.max(...candidates.map((component) => component.path === "." ? 0 : component.path.length));
    const owners = candidates.filter((component) => (component.path === "." ? 0 : component.path.length) === longest);
    if (owners.length !== 1) throw new TypeError(`affected path ${path} has ambiguous component ownership: ${owners.map(({ name }) => name).sort().join(", ")}`);
    selected.add(owners[0].name);
  }
  const validations: ResolvedValidation[] = [];
  for (const [index, item] of (project.validation?.default ?? []).entries()) validations.push(validationItem(item, `adw.yaml#validation.default[${index}]`));
  for (const name of [...selected].sort()) {
    const component = project.components[name];
    for (const [index, item] of (component.validation?.default ?? []).entries()) validations.push(validationItem(item, `adw.yaml#components.${name}.validation.default[${index}]`, component.path));
  }
  const deduplicated = new Map<string, ResolvedValidation>();
  for (const item of validations) {
    const key = `${item.cwd}\0${item.command}`;
    const previous = deduplicated.get(key);
    if (!previous) deduplicated.set(key, item);
    else if (item.required && !previous.required) deduplicated.set(key, { ...previous, required: true });
  }
  const effective: RecordValue = { components: [...selected].sort(), unowned_paths: unownedPaths.sort(), required_validation: [...deduplicated.values()] };
  const tracker = project.workflows?.work_tracker;
  if (tracker) {
    if (!project.integrations?.work_tracker || project.integrations.work_tracker.requirement === "disabled") throw new TypeError("work_tracker workflow requires an enabled work_tracker integration");
    if (tracker.binding === "required" && project.integrations.work_tracker.requirement !== "required") throw new TypeError("required work_tracker binding requires a required work_tracker integration");
    if (tracker.ensure === "create-or-link" && project.integrations.work_tracker.access !== "read-write") throw new TypeError("create-or-link work_tracker workflow requires read-write access");
    const resolvedTracker: RecordValue = { ...tracker };
    if (tracker.ensure === "create-or-link" && !tracker.profile) throw new TypeError("create-or-link work_tracker workflow requires a profile");
    if (tracker.profile) {
      const profile = profiles[tracker.profile];
      if (!profile) throw new TypeError(`work-item profile was not supplied: ${tracker.profile}`);
      if (profile.provider !== project.integrations.work_tracker.provider) throw new TypeError("work-item profile provider must match the configured work_tracker provider");
      resolvedTracker.profile_digest = computePolicyDigest(profile);
    }
    if (tracker.cardinality === "one-parent-plus-plan-tasks" && !tracker.child_profile) throw new TypeError("one-parent-plus-plan-tasks work_tracker workflow requires a child_profile");
    if (tracker.child_profile) {
      const childProfile = profiles[tracker.child_profile];
      if (!childProfile) throw new TypeError(`work-item child profile was not supplied: ${tracker.child_profile}`);
      if (childProfile.provider !== project.integrations.work_tracker.provider) throw new TypeError("work-item child profile provider must match the configured work_tracker provider");
      resolvedTracker.child_profile_digest = computePolicyDigest(childProfile);
    }
    effective.work_tracker = resolvedTracker;
  }
  return { ...effective, project_policy_digest: computePolicyDigest(effective) };
}

export function resolveValidationSet({ effective_policy, tasks }: { effective_policy: RecordValue; tasks: RecordValue[] }): ResolvedValidation[] {
  const candidates: ResolvedValidation[] = [...(effective_policy?.required_validation ?? [])];
  for (const task of tasks ?? []) for (const item of task.validation ?? []) candidates.push({ ...item, source: item.source ?? `plan task ${task.id}` });
  const resolved = new Map<string, ResolvedValidation>();
  for (const item of candidates) {
    const key = `${item.cwd}\0${item.command}`;
    const previous = resolved.get(key);
    if (!previous) resolved.set(key, { ...item });
    else resolved.set(key, { ...previous, required: previous.required || item.required, timeout_ms: Math.min(previous.timeout_ms, item.timeout_ms) });
  }
  return [...resolved.values()];
}
