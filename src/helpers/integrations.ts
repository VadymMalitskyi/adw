import { createHash } from "node:crypto";

const REQUIREMENTS_DOMAIN = Buffer.from("ADW-INTEGRATION-REQUIREMENTS-V1\0", "utf8");

function jsonDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function redactAndBound(text: unknown): string {
  return String(text ?? "")
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .slice(-4000);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError("requirements fields must contain only JSON-compatible values");
}

export function computeRequirementsDigest(fields: Record<string, unknown>): string {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new TypeError("requirements fields must be a JSON object");
  return createHash("sha256").update(REQUIREMENTS_DOMAIN).update(canonicalJson(fields)).digest("hex");
}

export function recordExternalAction(input: Record<string, unknown>): Record<string, unknown> {
  const authorization = input.authorized_by ?? input.authorization;
  const receipt: Record<string, unknown> = {
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
    summary: redactAndBound(input.summary),
  };
  if (authorization !== undefined) receipt.authorized_by = typeof authorization === "string" ? authorization : (authorization as Record<string, unknown>).actor;
  if (input.authorization_digest !== undefined) receipt.authorization_digest = input.authorization_digest;
  for (const key of ["external_id", "url", "before_revision", "after_revision"]) if (input[key] !== undefined) receipt[key] = input[key];
  return receipt;
}
