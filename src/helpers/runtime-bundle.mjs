#!/usr/bin/env node
// Generated as a dependency-free Node.js 20+ runtime bundle for ADW skills.
import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { parseDocument } from "yaml";

export const EXIT = Object.freeze({ OK: 0, INPUT: 2, SCHEMA_INVALID: 3, APPROVAL_INVALID: 4, VALIDATION_FAILED: 5, PATH_VIOLATION: 7, ATOMIC_WRITE_FAILED: 8, INTERNAL: 9 });
export const ARTIFACT_SCHEMAS = Object.freeze({
  project: Object.freeze({ 5: new URL("../schemas/project.v5.schema.json", import.meta.url) }),
  plan: Object.freeze({ 2: new URL("../schemas/plan.v2.schema.json", import.meta.url) }),
  approval: Object.freeze({ 2: new URL("../schemas/approval.v2.schema.json", import.meta.url) }),
  validation: Object.freeze({ 1: new URL("../schemas/validation.v1.schema.json", import.meta.url) }),
  integration: Object.freeze({ 1: new URL("../schemas/integration.v1.schema.json", import.meta.url) }),
  "external-action": Object.freeze({ 1: new URL("../schemas/external-action.v1.schema.json", import.meta.url) }),
  "incident-report": Object.freeze({ 1: new URL("../schemas/incident-report.v1.schema.json", import.meta.url) }),
  "work-item-profile": Object.freeze({ 1: new URL("../schemas/work-item-profile.v1.schema.json", import.meta.url) })
});

const BUNDLE_DOMAIN = Buffer.from("ADW-APPROVAL-BUNDLE-V2\0", "utf8");
const REQUIREMENTS_DOMAIN = Buffer.from("ADW-INTEGRATION-REQUIREMENTS-V1\0", "utf8");
const AUTHORIZATION_DOMAIN = Buffer.from("ADW-EXTERNAL-AUTHORIZATION-V1\0", "utf8");
const schemaCache = new Map();
const validatorCache = new WeakMap();
const ajv = new Ajv2020({ allErrors: true, strict: true, addUsedSchema: false });
ajv.addFormat("date-time", (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value) && !Number.isNaN(Date.parse(value)));

function framedField(label, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return Buffer.concat([Buffer.from(`${label}:${bytes.length}\n`, "utf8"), bytes, Buffer.from("\n", "utf8")]);
}

function contentDigest(content) {
  if (!(typeof content === "string" || Buffer.isBuffer(content))) throw new TypeError("approval input content must be a string or buffer");
  return createHash("sha256").update(content).digest("hex");
}

function normalizeApprovalInputs(inputs) {
  if (!Array.isArray(inputs)) throw new TypeError("approval inputs must be an array");
  const expected = ["spec.md", "plan.yaml", "integrations.yaml"];
  if (inputs.length < 2 || inputs.length > 3) throw new TypeError("approval inputs must contain spec.md, plan.yaml, and optional integrations.yaml");
  return inputs.map((input, index) => {
    if (!input || input.path !== expected[index]) throw new TypeError(`approval input ${index + 1} must be ${expected[index]}`);
    return { path: input.path, content: input.content };
  });
}

export function computeApprovalBundle(inputs) {
  const normalized = normalizeApprovalInputs(inputs);
  const hash = createHash("sha256").update(BUNDLE_DOMAIN);
  const descriptors = normalized.map(({ path, content }) => {
    hash.update(framedField(path, content));
    return { path, digest: contentDigest(content) };
  });
  return { inputs: descriptors, digest: hash.digest("hex") };
}

export function createApprovalBundle({ approver, approved_at, plugin_version, docs_commit, inputs }) {
  const bundle = computeApprovalBundle(inputs);
  return { schema: 2, status: "active", approver, approved_at, plugin_version, docs_commit, digest_algorithm: "sha256", inputs: bundle.inputs, digest: bundle.digest };
}

export function verifyApprovalBundle(inputs, approval) {
  if (!approval || approval.schema !== 2 || approval.digest_algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(approval.digest ?? "")) return false;
  let bundle;
  try { bundle = computeApprovalBundle(inputs); } catch { return false; }
  if (JSON.stringify(bundle.inputs) !== JSON.stringify(approval.inputs)) return false;
  return timingSafeEqual(Buffer.from(bundle.digest, "hex"), Buffer.from(approval.digest, "hex"));
}

function childPointer(path, part) {
  return `${path}/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

export function validateJsonSchema(schema, value) {
  let validate = validatorCache.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    validatorCache.set(schema, validate);
  }
  const valid = validate(value);
  const errors = (validate.errors ?? []).map((error) => {
    let path = error.instancePath || "";
    if (error.keyword === "required") path = childPointer(path, error.params.missingProperty);
    if (error.keyword === "additionalProperties") path = childPointer(path, error.params.additionalProperty);
    return { path: path || "/", keyword: error.keyword, message: error.message ?? "schema constraint failed" };
  });
  return { valid: Boolean(valid), errors };
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

export async function loadArtifactFile({ project_root, path, artifact }) {
  if (typeof project_root !== "string" || typeof path !== "string" || typeof artifact !== "string") throw new InputError("load-artifact-file requires project_root, path, and artifact");
  const target = await resolveProjectPath(project_root, path);
  let stat;
  try { stat = await lstat(target); }
  catch (error) { if (error.code === "ENOENT") throw new PathError(`artifact does not exist: ${path}`); throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new PathError(`artifact must be a regular non-symlink file: ${path}`);
  const bytes = await readFile(target);
  const data = parseYaml(bytes, path);
  const validation = await validateArtifact(artifact, data);
  return { data, validation, digest: contentDigest(bytes) };
}

export async function loadArtifactSchema(artifact, version) {
  const versions = ARTIFACT_SCHEMAS[artifact];
  if (!versions) throw new InputError(`unknown artifact ${JSON.stringify(artifact)}; expected ${Object.keys(ARTIFACT_SCHEMAS).join(", ")}`);
  const url = versions[version];
  if (!url) throw new InputError(`unsupported ${artifact} schema ${JSON.stringify(version)}; expected ${Object.keys(versions).join(", ")}`);
  const key = `${artifact}:${version}`;
  if (!schemaCache.has(key)) schemaCache.set(key, JSON.parse(await readFile(url, "utf8")));
  return schemaCache.get(key);
}

export async function validateArtifact(artifact, data) {
  if (!data || !Number.isInteger(data.schema)) return { valid: false, errors: [{ path: "/schema", keyword: "required", message: "must be an integer artifact schema version" }] };
  let schema;
  try { schema = await loadArtifactSchema(artifact, data.schema); }
  catch (error) { return { valid: false, errors: [{ path: "/schema", keyword: "version", message: error.message }] }; }
  const result = validateJsonSchema(schema, data);
  if (artifact === "plan" && Array.isArray(data?.tasks)) {
    data.tasks.forEach((task, index) => { if (task?.id !== index + 1) result.errors.push({ path: `/tasks/${index}/id`, keyword: "sequence", message: `must be ${index + 1} so tasks execute sequentially` }); });
    if (data.documentation?.impact !== "none" && Array.isArray(data.documentation?.files) && data.documentation.files.length === 0) result.errors.push({ path: "/documentation/files", keyword: "documentation", message: "must list files when documentation impact is update or new" });
    if (data.documentation?.impact === "none" && Array.isArray(data.documentation?.files) && data.documentation.files.length !== 0) result.errors.push({ path: "/documentation/files", keyword: "documentation", message: "must be empty when documentation impact is none" });
    const components = data.effective_policy?.components ?? [];
    if (new Set(components).size !== components.length) result.errors.push({ path: "/effective_policy/components", keyword: "unique", message: "components must be unique" });
    const unownedPaths = data.effective_policy?.unowned_paths ?? [];
    if (new Set(unownedPaths).size !== unownedPaths.length) result.errors.push({ path: "/effective_policy/unowned_paths", keyword: "unique", message: "unowned paths must be unique" });
    const tracker = data.effective_policy?.work_tracker;
    if (tracker && ((tracker.profile === undefined) !== (tracker.profile_digest === undefined))) result.errors.push({ path: "/effective_policy/work_tracker", keyword: "profile", message: "profile and profile_digest must appear together" });
    if (tracker && ((tracker.child_profile === undefined) !== (tracker.child_profile_digest === undefined))) result.errors.push({ path: "/effective_policy/work_tracker", keyword: "profile", message: "child_profile and child_profile_digest must appear together" });
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "validation") {
    const shouldFail = data.commands.some((item) => item.required && item.exit_code !== 0) || data.deferred.some((item) => item.required);
    if ((data.status === "failed") !== shouldFail) result.errors.push({ path: "/status", keyword: "evidence", message: `must be ${shouldFail ? "failed" : "passed"} based on required command results and deferrals` });
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "approval") {
    const invalidationFields = [data.invalidated_at, data.invalidation_reason, data.replaced_by].filter((value) => value !== undefined);
    if (data.status === "active" && invalidationFields.length !== 0) result.errors.push({ path: "/status", keyword: "lifecycle", message: "active approvals cannot contain invalidation fields" });
    if (data.status === "superseded" && (!data.invalidated_at || !data.invalidation_reason)) result.errors.push({ path: "/status", keyword: "lifecycle", message: "superseded approvals require invalidated_at and invalidation_reason" });
    const expectedPaths = ["spec.md", "plan.yaml", "integrations.yaml"];
    const paths = data.inputs.map(({ path }) => path);
    if (paths.some((path, index) => path !== expectedPaths[index])) result.errors.push({ path: "/inputs", keyword: "order", message: "must contain spec.md, plan.yaml, and optional integrations.yaml in canonical order" });
    if (new Set(paths).size !== paths.length) result.errors.push({ path: "/inputs", keyword: "unique", message: "must not contain duplicate paths" });
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "project") {
    const forbidden = /(?:password|passwd|token|api[_-]?key|secret|credential)/i;
    for (const [capability, integration] of Object.entries(data.integrations ?? {})) {
      for (const key of Object.keys(integration.settings ?? {})) {
        if (forbidden.test(key)) result.errors.push({ path: `/integrations/${capability}/settings/${key}`, keyword: "secret", message: "credential-like settings are forbidden; keep credentials in the provider or client credential store" });
      }
    }
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "project") {
    if (data.execution.isolation === "managed-devcontainer" && data.execution.enforcement !== "required") {
      result.errors.push({ path: "/execution/enforcement", keyword: "security", message: "managed-devcontainer isolation must be required" });
    }
    if (data.workflows?.work_tracker) {
      const tracker = data.workflows.work_tracker;
      if (!data.integrations?.work_tracker || data.integrations.work_tracker.requirement === "disabled") result.errors.push({ path: "/workflows/work_tracker", keyword: "capability", message: "requires an enabled integrations.work_tracker capability" });
      if (tracker.binding === "required" && data.integrations?.work_tracker?.requirement !== "required") result.errors.push({ path: "/workflows/work_tracker/binding", keyword: "capability", message: "required binding requires integrations.work_tracker.requirement to be required" });
      if (tracker.ensure === "create-or-link" && data.integrations?.work_tracker?.access !== "read-write") result.errors.push({ path: "/workflows/work_tracker/ensure", keyword: "access", message: "create-or-link requires read-write work_tracker access" });
      if (tracker.ensure === "create-or-link" && !tracker.profile) result.errors.push({ path: "/workflows/work_tracker/profile", keyword: "required", message: "is required when ensure is create-or-link" });
      if (tracker.cardinality === "one-parent-plus-plan-tasks" && !tracker.child_profile) result.errors.push({ path: "/workflows/work_tracker/child_profile", keyword: "required", message: "is required for one-parent-plus-plan-tasks" });
    }
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "integration") {
    const names = data.bindings.map(({ name }) => name);
    if (new Set(names).size !== names.length) result.errors.push({ path: "/bindings", keyword: "unique", message: "binding names must be unique" });
    for (const [index, binding] of data.bindings.entries()) {
      const hasDigest = binding.requirements_digest !== undefined;
      const hasFields = binding.requirement_fields !== undefined;
      if (hasDigest !== hasFields) result.errors.push({ path: `/bindings/${index}`, keyword: "requirements", message: "requirements_digest and requirement_fields must appear together" });
    }
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "external-action") {
    if (data.effect === "write" && (!data.authorized_by || !data.authorization_digest)) result.errors.push({ path: "/authorized_by", keyword: "authorization", message: "write actions require explicit authorization evidence" });
    if (data.status === "succeeded" && data.verified !== true) result.errors.push({ path: "/verified", keyword: "readback", message: "successful actions require verified readback" });
    if (data.status === "succeeded" && !data.readback_digest) result.errors.push({ path: "/readback_digest", keyword: "readback", message: "successful actions require a readback digest" });
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "incident-report") {
    const evidenceIds = data.evidence.map(({ id }) => id);
    const knownEvidenceIds = new Set(evidenceIds);
    if (knownEvidenceIds.size !== evidenceIds.length) result.errors.push({ path: "/evidence", keyword: "unique", message: "evidence ids must be unique" });
    if (Date.parse(data.source.window.from) > Date.parse(data.source.window.to)) result.errors.push({ path: "/source/window", keyword: "order", message: "from must not be later than to" });
    if (data.repository.deployed_revision_verified && data.repository.inspected_revision === null) result.errors.push({ path: "/repository/inspected_revision", keyword: "deployment", message: "a verified deployed revision must identify the inspected commit" });
    for (const [index, item] of data.timeline.entries()) {
      if (item.evidence_ref && !knownEvidenceIds.has(item.evidence_ref)) result.errors.push({ path: `/timeline/${index}/evidence_ref`, keyword: "reference", message: "must reference an evidence id in this report" });
    }
    for (const [index, hypothesis] of data.hypotheses.entries()) {
      for (const [referenceIndex, reference] of hypothesis.evidence_refs.entries()) {
        if (!knownEvidenceIds.has(reference)) result.errors.push({ path: `/hypotheses/${index}/evidence_refs/${referenceIndex}`, keyword: "reference", message: "must reference an evidence id in this report" });
      }
    }
    if (data.proposed_fix.needed === "no" && data.proposed_fix.route !== "none") result.errors.push({ path: "/proposed_fix/route", keyword: "routing", message: "must be none when no code fix is needed" });
    if (data.proposed_fix.needed === "yes" && data.proposed_fix.route === "none") result.errors.push({ path: "/proposed_fix/route", keyword: "routing", message: "must select adw:quick or adw:plan when a code fix is needed" });
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "work-item-profile") {
    for (const key of ["required_fields", "allowed_fields", "requirement_fields"]) {
      const values = data[key] ?? [];
      if (new Set(values).size !== values.length) result.errors.push({ path: `/${key}`, keyword: "unique", message: `${key} must be unique` });
    }
    const declared = new Set([...(data.required_fields ?? []), ...(data.allowed_fields ?? []), ...Object.keys(data.defaults ?? {})]);
    for (const field of data.requirement_fields ?? []) if (!declared.has(field)) result.errors.push({ path: "/requirement_fields", keyword: "declared", message: `requirement field is not declared by the profile: ${field}` });
    const forbidden = /(?:password|passwd|token|api[_-]?key|secret|credential)/i;
    for (const field of declared) if (forbidden.test(field)) result.errors.push({ path: "/required_fields", keyword: "secret", message: `credential-like work-item field is forbidden: ${field}` });
    result.valid = result.errors.length === 0;
  }
  return result;
}

function redactAndBound(text) {
  return String(text ?? "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .slice(-4000);
}

export function recordValidation({ change_id, plugin_version, code_commit, docs_commit, recorded_at, commands = [], deferred = [] }) {
  const normalized = commands.map((item) => ({ command: item.command, cwd: item.cwd, exit_code: item.exit_code, signal: item.signal ?? null, timed_out: item.timed_out === true, duration_ms: item.duration_ms, summary: redactAndBound(item.summary), required: item.required !== false }));
  const normalizedDeferred = deferred.map((item) => ({ command: item.command, reason: item.reason, required: item.required !== false }));
  const failed = normalized.some((item) => item.required && item.exit_code !== 0) || normalizedDeferred.some((item) => item.required);
  return { schema: 1, change_id, plugin_version, code_commit, docs_commit, recorded_at, status: failed ? "failed" : "passed", commands: normalized, deferred: normalizedDeferred };
}

function jsonDigest(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(",")}}`;
  }
  throw new InputError("requirements fields must contain only JSON-compatible values");
}

export function computePolicyDigest(policy) {
  return createHash("sha256").update("ADW-EFFECTIVE-POLICY-V1\0").update(canonicalJson(policy)).digest("hex");
}

function safePolicyPath(path, label) {
  if (typeof path !== "string" || path.length === 0 || path.startsWith("/") || path.includes("\0") || path.split("/").includes("..")) throw new InputError(`${label} must be a safe project-relative path`);
  return path.replace(/^\.\//, "").replace(/\/$/, "") || ".";
}

function componentMatches(componentPath, affectedPath) {
  return componentPath === "." || affectedPath === componentPath || affectedPath.startsWith(`${componentPath}/`);
}

function resolvedValidation(item, sourcePath, defaultCwd = ".") {
  const command = typeof item === "string" ? item : item.command;
  if (typeof command !== "string" || command.length === 0 || /^\s*<[^>]+>\s*$/.test(command)) throw new InputError(`validation command from ${sourcePath} is unresolved or invalid`);
  if (typeof item === "string") return { command, cwd: defaultCwd, timeout_ms: 120000, required: true, source: sourcePath };
  return { command, cwd: item.cwd ?? defaultCwd, timeout_ms: item.timeout_ms ?? 120000, required: item.required !== false, source: item.source };
}

export function validateWorkItemPayload(profile, payload) {
  const errors = [];
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

export function resolveProjectPolicy({ project, affected_paths, profiles = {} }) {
  if (!project || project.schema !== 5) throw new InputError("effective policy resolution requires project schema 5");
  if (!Array.isArray(affected_paths) || affected_paths.length === 0) throw new InputError("affected_paths must be a non-empty array");
  const paths = [...new Set(affected_paths.map((path) => safePolicyPath(path, "affected path")))];
  const components = Object.entries(project.components ?? {}).map(([name, value]) => ({ name, ...value, path: safePolicyPath(value.path, `component ${name} path`) }));
  const selected = new Set();
  const unownedPaths = [];
  for (const path of paths) {
    const candidates = components.filter((component) => componentMatches(component.path, path));
    if (candidates.length === 0) { unownedPaths.push(path); continue; }
    const longest = Math.max(...candidates.map((component) => component.path === "." ? 0 : component.path.length));
    const owners = candidates.filter((component) => (component.path === "." ? 0 : component.path.length) === longest);
    if (owners.length !== 1) throw new InputError(`affected path ${path} has ambiguous component ownership: ${owners.map(({ name }) => name).sort().join(", ")}`);
    selected.add(owners[0].name);
  }
  const validations = [];
  for (const [index, item] of (project.validation?.default ?? []).entries()) validations.push(resolvedValidation(item, `adw.yaml#validation.default[${index}]`));
  for (const name of [...selected].sort()) {
    const component = project.components[name];
    for (const [index, item] of (component.validation?.default ?? []).entries()) validations.push(resolvedValidation(item, `adw.yaml#components.${name}.validation.default[${index}]`, component.path));
  }
  const deduplicated = new Map();
  for (const item of validations) {
    const key = `${item.cwd}\0${item.command}`;
    const previous = deduplicated.get(key);
    if (!previous) deduplicated.set(key, item);
    else if (item.required && !previous.required) deduplicated.set(key, { ...previous, required: true });
  }
  const effective = { components: [...selected].sort(), unowned_paths: unownedPaths.sort(), required_validation: [...deduplicated.values()] };
  const tracker = project.workflows?.work_tracker;
  if (tracker) {
    if (!project.integrations?.work_tracker || project.integrations.work_tracker.requirement === "disabled") throw new InputError("work_tracker workflow requires an enabled work_tracker integration");
    if (tracker.binding === "required" && project.integrations.work_tracker.requirement !== "required") throw new InputError("required work_tracker binding requires a required work_tracker integration");
    if (tracker.ensure === "create-or-link" && project.integrations.work_tracker.access !== "read-write") throw new InputError("create-or-link work_tracker workflow requires read-write access");
    const resolvedTracker = { ...tracker };
    if (tracker.ensure === "create-or-link" && !tracker.profile) throw new InputError("create-or-link work_tracker workflow requires a profile");
    if (tracker.profile) {
      const profile = profiles[tracker.profile];
      if (!profile) throw new InputError(`work-item profile was not supplied: ${tracker.profile}`);
      if (profile.provider !== project.integrations.work_tracker.provider) throw new InputError("work-item profile provider must match the configured work_tracker provider");
      resolvedTracker.profile_digest = computePolicyDigest(profile);
    }
    if (tracker.cardinality === "one-parent-plus-plan-tasks" && !tracker.child_profile) throw new InputError("one-parent-plus-plan-tasks work_tracker workflow requires a child_profile");
    if (tracker.child_profile) {
      const childProfile = profiles[tracker.child_profile];
      if (!childProfile) throw new InputError(`work-item child profile was not supplied: ${tracker.child_profile}`);
      if (childProfile.provider !== project.integrations.work_tracker.provider) throw new InputError("work-item child profile provider must match the configured work_tracker provider");
      resolvedTracker.child_profile_digest = computePolicyDigest(childProfile);
    }
    effective.work_tracker = resolvedTracker;
  }
  return { ...effective, project_policy_digest: computePolicyDigest(effective) };
}

export function resolveValidationSet({ effective_policy, tasks }) {
  const candidates = [...(effective_policy?.required_validation ?? [])];
  for (const task of tasks ?? []) for (const item of task.validation ?? []) candidates.push({ ...item, source: item.source ?? `plan task ${task.id}` });
  const resolved = new Map();
  for (const item of candidates) {
    const key = `${item.cwd}\0${item.command}`;
    const previous = resolved.get(key);
    if (!previous) resolved.set(key, { ...item });
    else resolved.set(key, { ...previous, required: previous.required || item.required, timeout_ms: Math.min(previous.timeout_ms, item.timeout_ms) });
  }
  return [...resolved.values()];
}

export function computeRequirementsDigest(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new InputError("requirements fields must be a JSON object");
  return createHash("sha256").update(REQUIREMENTS_DOMAIN).update(canonicalJson(fields)).digest("hex");
}

export function computeAuthorizationDigest({ target, operation, payload }) {
  if (typeof target !== "string" || target.length === 0 || typeof operation !== "string" || operation.length === 0) throw new InputError("authorization digest requires target and operation");
  return createHash("sha256").update(AUTHORIZATION_DOMAIN).update(canonicalJson({ target, operation, payload: payload ?? null })).digest("hex");
}

export function recordExternalAction(input) {
  const authorization = input.authorized_by ?? input.authorization;
  const receipt = {
    schema: 1,
    change_id: input.change_id,
    sequence: input.sequence,
    capability: input.capability,
    provider: input.provider,
    transport: input.transport,
    operation: input.operation,
    effect: input.effect,
    target: input.target,
    idempotency_key: input.idempotency_key,
    requested_at: input.requested_at,
    status: input.status ?? "succeeded",
    request_digest: input.request_digest ?? jsonDigest(input.payload),
    readback_digest: input.readback_digest ?? jsonDigest(input.readback),
    verified: input.verified === true,
    summary: redactAndBound(input.summary)
  };
  if (authorization !== undefined) receipt.authorized_by = typeof authorization === "string" ? authorization : authorization.actor;
  if (input.effect === "write") {
    if (typeof input.authorization_digest === "string") {
      const expected = computeAuthorizationDigest(input);
      if (input.authorization_digest !== expected) throw new InputError("authorization digest does not match the exact target, operation, and payload");
      receipt.authorization_digest = expected;
    }
  } else if (input.authorization_digest !== undefined) receipt.authorization_digest = input.authorization_digest;
  for (const key of ["external_id", "url", "before_revision", "after_revision"]) if (input[key] !== undefined) receipt[key] = input[key];
  return receipt;
}

export async function runValidationCommand(input, cwd) {
  if (!input || typeof input.command !== "string" || input.command.length === 0 || /^\s*<[^>]+>\s*$/.test(input.command)) throw new InputError("each validation command requires a resolved non-placeholder command string");
  const started = Date.now();
  if (input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 1)) throw new InputError("timeout_ms must be a positive integer");
  return await new Promise((done) => {
    const child = spawn(input.command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); done(result); };
    const timer = input.timeout_ms ? setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, input.timeout_ms) : undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ command: input.command, cwd, exit_code: 1, signal: null, timed_out: timedOut, duration_ms: Date.now() - started, summary: redactAndBound(error.message), required: input.required !== false }));
    child.on("close", (code, signal) => finish({ command: input.command, cwd, exit_code: code, signal, timed_out: timedOut, duration_ms: Date.now() - started, summary: redactAndBound(`${stdout}${stderr}`.trim() || (signal ? `terminated by ${signal}` : "")), required: input.required !== false }));
  });
}

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
        await rename(destination, backup);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (destinationStat) throw new AtomicWriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
      }
      originals.push({ destination, backup });
      await rename(staged, destination);
    }
  } catch (error) {
    for (const original of originals.reverse()) {
      await rm(original.destination, { force: true });
      if (original.backup) await rename(original.backup, original.destination);
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
    case "validate": {
      const validation = await validateArtifact(input.artifact, input.data);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: { ok: validation.valid, artifact: input.artifact, errors: validation.errors } };
    }
    case "load-artifact-file": {
      const loaded = await loadArtifactFile(input);
      return { exitCode: loaded.validation.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: { ok: loaded.validation.valid, artifact: input.artifact, data: loaded.data, digest: loaded.digest, errors: loaded.validation.errors } };
    }
    case "digest-bundle": {
      const bundle = computeApprovalBundle(input.inputs);
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", ...bundle } };
    }
    case "create-approval-bundle": {
      const approval = createApprovalBundle(input);
      const validation = await validateArtifact("approval", approval);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: validation.valid ? { ok: true, approval } : { ok: false, errors: validation.errors } };
    }
    case "verify-approval-bundle": {
      const validation = await validateArtifact("approval", input.approval);
      const commitMatches = input.docs_commit === undefined || input.docs_commit === input.approval?.docs_commit;
      const verified = validation.valid && input.approval.status === "active" && commitMatches && verifyApprovalBundle(input.inputs, input.approval);
      const reason = verified ? "approval matches the exact input bundle and docs commit" : !validation.valid ? "approval artifact is invalid" : input.approval.status !== "active" ? "approval has been superseded" : !commitMatches ? "approval is bound to a different docs commit" : "approval digest does not match the exact input bundle";
      return { exitCode: verified ? EXIT.OK : EXIT.APPROVAL_INVALID, body: { ok: verified, verified, errors: validation.errors, reason } };
    }
    case "record-validation": {
      const evidence = recordValidation(input);
      const validation = await validateArtifact("validation", evidence);
      if (!validation.valid) return { exitCode: EXIT.SCHEMA_INVALID, body: { ok: false, errors: validation.errors } };
      return { exitCode: evidence.status === "passed" ? EXIT.OK : EXIT.VALIDATION_FAILED, body: { ok: evidence.status === "passed", evidence } };
    }
    case "run-validation": {
      if (typeof input.project_root !== "string") throw new InputError("project_root is required");
      const commands = [];
      for (const item of input.commands ?? []) {
        const relativeCwd = item.cwd ?? input.cwd ?? ".";
        const cwd = await resolveProjectDirectory(input.project_root, relativeCwd);
        commands.push(await runValidationCommand(item, cwd));
      }
      const evidence = recordValidation({ change_id: input.change_id, plugin_version: input.plugin_version, code_commit: input.code_commit, docs_commit: input.docs_commit, recorded_at: input.recorded_at, commands, deferred: input.deferred ?? [] });
      const validation = await validateArtifact("validation", evidence);
      if (!validation.valid) return { exitCode: EXIT.SCHEMA_INVALID, body: { ok: false, errors: validation.errors } };
      return { exitCode: evidence.status === "passed" ? EXIT.OK : EXIT.VALIDATION_FAILED, body: { ok: evidence.status === "passed", evidence } };
    }
    case "record-external-action": {
      const receipt = recordExternalAction(input);
      const validation = await validateArtifact("external-action", receipt);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: validation.valid ? { ok: true, receipt } : { ok: false, errors: validation.errors } };
    }
    case "digest-requirements":
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", digest: computeRequirementsDigest(input.fields) } };
    case "digest-authorization":
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", digest: computeAuthorizationDigest(input) } };
    case "resolve-project-policy": {
      const projectValidation = await validateArtifact("project", input.project);
      if (!projectValidation.valid) return { exitCode: EXIT.SCHEMA_INVALID, body: { ok: false, errors: projectValidation.errors } };
      for (const [path, profile] of Object.entries(input.profiles ?? {})) {
        const profileValidation = await validateArtifact("work-item-profile", profile);
        if (!profileValidation.valid) return { exitCode: EXIT.SCHEMA_INVALID, body: { ok: false, profile: path, errors: profileValidation.errors } };
      }
      const policy = resolveProjectPolicy(input);
      return { exitCode: EXIT.OK, body: { ok: true, policy } };
    }
    case "digest-policy":
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", digest: computePolicyDigest(input.policy) } };
    case "resolve-validation-set":
      return { exitCode: EXIT.OK, body: { ok: true, commands: resolveValidationSet(input) } };
    case "validate-work-item-payload": {
      const profileValidation = await validateArtifact("work-item-profile", input.profile);
      if (!profileValidation.valid) return { exitCode: EXIT.SCHEMA_INVALID, body: { ok: false, errors: profileValidation.errors } };
      const result = validateWorkItemPayload(input.profile, input.payload);
      return { exitCode: result.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: { ok: result.valid, ...result } };
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
