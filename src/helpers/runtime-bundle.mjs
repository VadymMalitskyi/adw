#!/usr/bin/env node
// Generated as a dependency-free Node.js 20+ runtime bundle for ADW skills.
import { createHash, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const EXIT = Object.freeze({ OK: 0, INPUT: 2, SCHEMA_INVALID: 3, APPROVAL_INVALID: 4, VALIDATION_FAILED: 5, INCOMPATIBLE: 6, PATH_VIOLATION: 7, MIGRATION_FAILED: 8, INTERNAL: 9 });
export const ARTIFACT_SCHEMAS = Object.freeze({
  project: Object.freeze({
    1: new URL("../schemas/project.v1.schema.json", import.meta.url),
    2: new URL("../schemas/project.v2.schema.json", import.meta.url),
    3: new URL("../schemas/project.v3.schema.json", import.meta.url)
  }),
  plan: Object.freeze({ 1: new URL("../schemas/plan.v1.schema.json", import.meta.url) }),
  approval: Object.freeze({
    1: new URL("../schemas/approval.v1.schema.json", import.meta.url),
    2: new URL("../schemas/approval.v2.schema.json", import.meta.url)
  }),
  validation: Object.freeze({ 1: new URL("../schemas/validation.v1.schema.json", import.meta.url) }),
  integration: Object.freeze({ 1: new URL("../schemas/integration.v1.schema.json", import.meta.url) }),
  "external-action": Object.freeze({ 1: new URL("../schemas/external-action.v1.schema.json", import.meta.url) }),
  "incident-report": Object.freeze({ 1: new URL("../schemas/incident-report.v1.schema.json", import.meta.url) })
});

const DOMAIN = Buffer.from("ADW-APPROVAL-DIGEST-V1\0", "utf8");
const BUNDLE_DOMAIN = Buffer.from("ADW-APPROVAL-BUNDLE-V2\0", "utf8");
const REQUIREMENTS_DOMAIN = Buffer.from("ADW-INTEGRATION-REQUIREMENTS-V1\0", "utf8");
const schemaCache = new Map();

function framedField(label, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return Buffer.concat([Buffer.from(`${label}:${bytes.length}\n`, "utf8"), bytes, Buffer.from("\n", "utf8")]);
}

export function computeApprovalDigest(spec, plan) {
  if (!(typeof spec === "string" || Buffer.isBuffer(spec)) || !(typeof plan === "string" || Buffer.isBuffer(plan))) throw new TypeError("spec and plan must be strings or buffers");
  return createHash("sha256").update(DOMAIN).update(framedField("spec", spec)).update(framedField("plan", plan)).digest("hex");
}

export function verifyApprovalDigest(spec, plan, approval) {
  if (!approval || approval.digest_algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(approval.digest ?? "")) return false;
  return timingSafeEqual(Buffer.from(computeApprovalDigest(spec, plan), "hex"), Buffer.from(approval.digest, "hex"));
}

export function createApproval({ approver, approved_at, plugin_version, docs_commit, spec, plan }) {
  return { schema: 1, status: "active", approver, approved_at, plugin_version, docs_commit, digest_algorithm: "sha256", digest: computeApprovalDigest(spec, plan) };
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

function typeMatches(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

function childPointer(path, part) {
  return `${path}/${String(part).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}

function resolveReference(root, reference) {
  if (!reference.startsWith("#/")) return undefined;
  let current = root;
  for (const raw of reference.slice(2).split("/")) {
    if (current === null || typeof current !== "object") return undefined;
    current = current[raw.replaceAll("~1", "/").replaceAll("~0", "~")];
  }
  return current !== null && typeof current === "object" ? current : undefined;
}

export function validateJsonSchema(schema, value) {
  const errors = [];
  const add = (path, keyword, message) => errors.push({ path: path || "/", keyword, message });
  function visit(rule, candidate, path) {
    if (typeof rule.$ref === "string") {
      const resolved = resolveReference(schema, rule.$ref);
      if (resolved) visit(resolved, candidate, path); else add(path, "$ref", `unresolvable schema reference ${rule.$ref}`);
      return;
    }
    if (Array.isArray(rule.anyOf)) {
      if (!rule.anyOf.some((branch) => branchValid(branch, candidate))) add(path, "anyOf", "must match at least one allowed shape");
      return;
    }
    if (Object.hasOwn(rule, "const") && !Object.is(candidate, rule.const)) { add(path, "const", `must equal ${JSON.stringify(rule.const)}`); return; }
    if (Array.isArray(rule.enum) && !rule.enum.some((item) => Object.is(item, candidate))) { add(path, "enum", `must be one of ${rule.enum.map(String).join(", ")}`); return; }
    if (typeof rule.type === "string" && !typeMatches(candidate, rule.type)) {
      add(path, "type", `must be ${rule.type}; received ${candidate === null ? "null" : Array.isArray(candidate) ? "array" : typeof candidate}`);
      return;
    }
    if (typeof candidate === "string") {
      if (typeof rule.minLength === "number" && candidate.length < rule.minLength) add(path, "minLength", `must contain at least ${rule.minLength} character(s)`);
      if (typeof rule.maxLength === "number" && candidate.length > rule.maxLength) add(path, "maxLength", `must contain no more than ${rule.maxLength} character(s)`);
      if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(candidate)) add(path, "pattern", `must match ${rule.pattern}`);
      if (rule.format === "date-time" && (Number.isNaN(Date.parse(candidate)) || !/^\d{4}-\d\d-\d\dT/.test(candidate))) add(path, "format", "must be an ISO 8601 date-time");
    }
    if (typeof candidate === "number" && typeof rule.minimum === "number" && candidate < rule.minimum) add(path, "minimum", `must be at least ${rule.minimum}`);
    if (Array.isArray(candidate)) {
      if (typeof rule.minItems === "number" && candidate.length < rule.minItems) add(path, "minItems", `must contain at least ${rule.minItems} item(s)`);
      if (rule.items && typeof rule.items === "object") candidate.forEach((item, index) => visit(rule.items, item, childPointer(path, index)));
    }
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      if (typeof rule.minProperties === "number" && Object.keys(candidate).length < rule.minProperties) add(path, "minProperties", `must contain at least ${rule.minProperties} property/properties`);
      if (Array.isArray(rule.required)) for (const key of rule.required) if (!(key in candidate)) add(childPointer(path, key), "required", "is required");
      const properties = rule.properties && typeof rule.properties === "object" ? rule.properties : {};
      for (const [key, item] of Object.entries(candidate)) {
        if (properties[key]) visit(properties[key], item, childPointer(path, key));
        else if (rule.additionalProperties === false) add(childPointer(path, key), "additionalProperties", "is not allowed");
        else if (rule.additionalProperties && typeof rule.additionalProperties === "object") visit(rule.additionalProperties, item, childPointer(path, key));
      }
    }
  }
  function branchValid(rule, candidate) {
    const before = errors.length;
    visit(rule, candidate, "");
    const valid = errors.length === before;
    errors.splice(before);
    return valid;
  }
  visit(schema, value, "");
  return { valid: errors.length === 0, errors };
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
    if (data.schema === 2) {
      const expectedPaths = ["spec.md", "plan.yaml", "integrations.yaml"];
      const paths = data.inputs.map(({ path }) => path);
      if (paths.some((path, index) => path !== expectedPaths[index])) result.errors.push({ path: "/inputs", keyword: "order", message: "must contain spec.md, plan.yaml, and optional integrations.yaml in canonical order" });
      if (new Set(paths).size !== paths.length) result.errors.push({ path: "/inputs", keyword: "unique", message: "must not contain duplicate paths" });
    }
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "project" && (data.schema === 2 || data.schema === 3)) {
    const forbidden = /(?:password|passwd|token|api[_-]?key|secret|credential)/i;
    for (const [capability, integration] of Object.entries(data.integrations ?? {})) {
      for (const key of Object.keys(integration.settings ?? {})) {
        if (forbidden.test(key)) result.errors.push({ path: `/integrations/${capability}/settings/${key}`, keyword: "secret", message: "credential-like settings are forbidden; keep credentials in the provider or client credential store" });
      }
    }
    result.valid = result.errors.length === 0;
  }
  if (result.valid && artifact === "project" && data.schema === 3) {
    if (data.execution.isolation === "managed-devcontainer" && data.execution.enforcement !== "required") {
      result.errors.push({ path: "/execution/enforcement", keyword: "security", message: "managed-devcontainer isolation must be required" });
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

export function computeRequirementsDigest(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new InputError("requirements fields must be a JSON object");
  return createHash("sha256").update(REQUIREMENTS_DOMAIN).update(canonicalJson(fields)).digest("hex");
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
  if (input.authorization_digest !== undefined) receipt.authorization_digest = input.authorization_digest;
  for (const key of ["external_id", "url", "before_revision", "after_revision"]) if (input[key] !== undefined) receipt[key] = input[key];
  return receipt;
}

export async function runValidationCommand(input, cwd) {
  if (!input || typeof input.command !== "string" || input.command.length === 0) throw new InputError("each validation command requires a non-empty command string");
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

export function checkCompatibility({ project_schema, supported_project_schemas, plugin_version, artifact_plugin_version }) {
  const semverMajor = (version) => { const match = /^(\d+)\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.exec(version ?? ""); return match ? Number(match[1]) : undefined; };
  const installedMajor = semverMajor(plugin_version);
  if (installedMajor === undefined) return { compatible: false, migration_required: false, reason: "plugin_version must be semantic version x.y.z" };
  if (!Number.isInteger(project_schema) || project_schema < 1) return { compatible: false, migration_required: false, reason: "project_schema must be a positive integer" };
  if (!Array.isArray(supported_project_schemas) || !supported_project_schemas.every((item) => Number.isInteger(item) && item > 0)) return { compatible: false, migration_required: false, reason: "supported_project_schemas must contain positive integers" };
  if (!supported_project_schemas.includes(project_schema)) {
    const target = Math.max(...supported_project_schemas);
    return { compatible: false, migration_required: Number.isFinite(target) && project_schema < target, reason: `project schema ${project_schema} is not supported; supported schemas: ${supported_project_schemas.join(", ") || "none"}` };
  }
  if (artifact_plugin_version !== undefined) {
    const artifactMajor = semverMajor(artifact_plugin_version);
    if (artifactMajor === undefined) return { compatible: false, migration_required: false, reason: "artifact_plugin_version must be semantic version x.y.z" };
    if (artifactMajor > installedMajor) return { compatible: false, migration_required: false, reason: `artifact requires plugin major ${artifactMajor}, installed major is ${installedMajor}` };
  }
  return { compatible: true, migration_required: false, reason: "project artifacts are compatible" };
}

export async function resolveProjectPath(projectRoot, explicitRelativePath) {
  if (typeof projectRoot !== "string" || typeof explicitRelativePath !== "string" || !projectRoot || !explicitRelativePath || isAbsolute(explicitRelativePath) || explicitRelativePath.includes("\0")) throw new PathError("migration paths must be explicit project-relative paths");
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

export async function applyAtomicMigration(projectRoot, operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new InputError("migration requires at least one explicit write operation");
  for (const operation of operations) if (!operation || typeof operation.path !== "string" || typeof operation.content !== "string") throw new InputError("each migration operation requires string path and content fields");
  const destinations = await Promise.all(operations.map((operation) => resolveProjectPath(projectRoot, operation.path)));
  if (new Set(destinations).size !== destinations.length) throw new InputError("migration contains duplicate destination paths");
  const root = await realpath(projectRoot);
  const transaction = await mkdtemp(resolve(root, ".adw-migration-"));
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
      if (Object.hasOwn(operation, "expected_content") && operation.expected_content !== previous) throw new MigrationError(`precondition failed for ${operation.path}`);
      const staged = resolve(transaction, `new-${index}`);
      await writeFile(staged, operation.content, { encoding: "utf8", mode: destinationStat?.mode ?? 0o644, flag: "wx" });
      await mkdir(dirname(destination), { recursive: true });
      // Re-resolve immediately before mutation so a replaced parent symlink is caught.
      if (await resolveProjectPath(projectRoot, operation.path) !== destination) throw new PathError(`path changed while migration was prepared: ${operation.path}`);
      let backup;
      try {
        const currentStat = await lstat(destination);
        if (!destinationStat || currentStat.isSymbolicLink() || currentStat.dev !== destinationStat.dev || currentStat.ino !== destinationStat.ino) throw new MigrationError(`destination changed while migration was prepared: ${operation.path}`);
        backup = resolve(transaction, `old-${index}`);
        await rename(destination, backup);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (destinationStat) throw new MigrationError(`destination changed while migration was prepared: ${operation.path}`);
      }
      originals.push({ destination, backup });
      await rename(staged, destination);
    }
  } catch (error) {
    for (const original of originals.reverse()) {
      await rm(original.destination, { force: true });
      if (original.backup) await rename(original.backup, original.destination);
    }
    if (error instanceof InputError || error instanceof PathError || error instanceof MigrationError) throw error;
    throw new MigrationError(error.message, { cause: error });
  } finally {
    await rm(transaction, { recursive: true, force: true });
  }
}

class CodedError extends Error { constructor(message, code, options) { super(message, options); this.code = code; } }
export class InputError extends CodedError { constructor(message, options) { super(message, EXIT.INPUT, options); } }
export class PathError extends CodedError { constructor(message, options) { super(message, EXIT.PATH_VIOLATION, options); } }
export class MigrationError extends CodedError { constructor(message, options) { super(message, EXIT.MIGRATION_FAILED, options); } }

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
    case "digest":
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", digest: computeApprovalDigest(input.spec, input.plan) } };
    case "digest-bundle": {
      const bundle = computeApprovalBundle(input.inputs);
      return { exitCode: EXIT.OK, body: { ok: true, algorithm: "sha256", ...bundle } };
    }
    case "create-approval": {
      const approval = createApproval(input);
      const validation = await validateArtifact("approval", approval);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: validation.valid ? { ok: true, approval } : { ok: false, errors: validation.errors } };
    }
    case "create-approval-bundle": {
      const approval = createApprovalBundle(input);
      const validation = await validateArtifact("approval", approval);
      return { exitCode: validation.valid ? EXIT.OK : EXIT.SCHEMA_INVALID, body: validation.valid ? { ok: true, approval } : { ok: false, errors: validation.errors } };
    }
    case "verify-approval": {
      const validation = await validateArtifact("approval", input.approval);
      const commitMatches = input.docs_commit === undefined || input.docs_commit === input.approval?.docs_commit;
      const verified = validation.valid && input.approval.status === "active" && commitMatches && verifyApprovalDigest(input.spec, input.plan, input.approval);
      const reason = verified ? "approval matches exact spec, plan, and docs commit" : !validation.valid ? "approval artifact is invalid" : input.approval.status !== "active" ? "approval has been superseded" : !commitMatches ? "approval is bound to a different docs commit" : "approval digest does not match exact spec and plan content";
      return { exitCode: verified ? EXIT.OK : EXIT.APPROVAL_INVALID, body: { ok: verified, verified, errors: validation.errors, reason } };
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
    case "check-compatibility": {
      const compatibility = checkCompatibility(input);
      return { exitCode: compatibility.compatible ? EXIT.OK : EXIT.INCOMPATIBLE, body: { ok: compatibility.compatible, ...compatibility } };
    }
    case "migrate":
      await applyAtomicMigration(input.project_root, input.operations);
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
