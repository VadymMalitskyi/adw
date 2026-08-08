export type ArtifactKind = "project" | "plan" | "approval" | "validation" | "integration" | "external-action" | "incident-report";

export interface ValidationIssue {
  path: string;
  keyword: string;
  message: string;
}

export interface SchemaValidationResult {
  valid: boolean;
  errors: ValidationIssue[];
}

type JsonSchema = Record<string, unknown>;

function typeMatches(value: unknown, type: string): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return typeof value === "number" && Number.isInteger(value);
  return typeof value === type;
}

function pointer(path: string, part: string | number): string {
  const escaped = String(part).replaceAll("~", "~0").replaceAll("/", "~1");
  return `${path}/${escaped}`;
}

function resolveReference(root: JsonSchema, reference: string): JsonSchema | undefined {
  if (!reference.startsWith("#/")) return undefined;
  let current: unknown = root;
  for (const raw of reference.slice(2).split("/")) {
    const key = raw.replaceAll("~1", "/").replaceAll("~0", "~");
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current !== null && typeof current === "object" ? current as JsonSchema : undefined;
}

/** Validate the JSON Schema subset used by ADW's checked-in artifact contracts. */
export function validateJsonSchema(schema: JsonSchema, value: unknown): SchemaValidationResult {
  const errors: ValidationIssue[] = [];

  function issue(path: string, keyword: string, message: string): void {
    errors.push({ path: path || "/", keyword, message });
  }

  function visit(rule: JsonSchema, candidate: unknown, path: string): void {
    if (typeof rule.$ref === "string") {
      const resolved = resolveReference(schema, rule.$ref);
      if (!resolved) issue(path, "$ref", `unresolvable schema reference ${rule.$ref}`);
      else visit(resolved, candidate, path);
      return;
    }
    if (Array.isArray(rule.anyOf)) {
      if (!rule.anyOf.some((branch) => validateBranch(branch as JsonSchema, candidate))) {
        issue(path, "anyOf", "must match at least one allowed shape");
      }
      return;
    }
    if ("const" in rule && !Object.is(candidate, rule.const)) {
      issue(path, "const", `must equal ${JSON.stringify(rule.const)}`);
      return;
    }
    if (Array.isArray(rule.enum) && !rule.enum.some((item) => Object.is(item, candidate))) {
      issue(path, "enum", `must be one of ${rule.enum.map(String).join(", ")}`);
      return;
    }
    if (typeof rule.type === "string" && !typeMatches(candidate, rule.type)) {
      issue(path, "type", `must be ${rule.type}; received ${candidate === null ? "null" : Array.isArray(candidate) ? "array" : typeof candidate}`);
      return;
    }
    if (typeof candidate === "string") {
      if (typeof rule.minLength === "number" && candidate.length < rule.minLength) issue(path, "minLength", `must contain at least ${rule.minLength} character(s)`);
      if (typeof rule.maxLength === "number" && candidate.length > rule.maxLength) issue(path, "maxLength", `must contain no more than ${rule.maxLength} character(s)`);
      if (typeof rule.pattern === "string" && !new RegExp(rule.pattern).test(candidate)) issue(path, "pattern", `must match ${rule.pattern}`);
      if (rule.format === "date-time" && (Number.isNaN(Date.parse(candidate)) || !/^\d{4}-\d\d-\d\dT/.test(candidate))) issue(path, "format", "must be an ISO 8601 date-time");
    }
    if (typeof candidate === "number" && typeof rule.minimum === "number" && candidate < rule.minimum) issue(path, "minimum", `must be at least ${rule.minimum}`);
    if (Array.isArray(candidate)) {
      if (typeof rule.minItems === "number" && candidate.length < rule.minItems) issue(path, "minItems", `must contain at least ${rule.minItems} item(s)`);
      if (rule.items && typeof rule.items === "object") candidate.forEach((item, index) => visit(rule.items as JsonSchema, item, pointer(path, index)));
    }
    if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>;
      if (typeof rule.minProperties === "number" && Object.keys(record).length < rule.minProperties) issue(path, "minProperties", `must contain at least ${rule.minProperties} property/properties`);
      if (Array.isArray(rule.required)) {
        for (const key of rule.required) if (typeof key === "string" && !(key in record)) issue(pointer(path, key), "required", "is required");
      }
      const properties = rule.properties && typeof rule.properties === "object" ? rule.properties as Record<string, JsonSchema> : {};
      for (const [key, item] of Object.entries(record)) {
        if (properties[key]) visit(properties[key], item, pointer(path, key));
        else if (rule.additionalProperties === false) issue(pointer(path, key), "additionalProperties", "is not allowed");
        else if (rule.additionalProperties && typeof rule.additionalProperties === "object") visit(rule.additionalProperties as JsonSchema, item, pointer(path, key));
      }
    }
  }

  function validateBranch(rule: JsonSchema, candidate: unknown): boolean {
    const before = errors.length;
    visit(rule, candidate, "");
    const valid = errors.length === before;
    errors.splice(before);
    return valid;
  }

  visit(schema, value, "");
  return { valid: errors.length === 0, errors };
}

export function assertSchema(result: SchemaValidationResult, label = "artifact"): void {
  if (result.valid) return;
  const detail = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
  throw new Error(`${label} failed schema validation: ${detail}`);
}
