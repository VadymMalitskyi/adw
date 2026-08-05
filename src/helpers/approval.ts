import { createHash, timingSafeEqual } from "node:crypto";

export interface ApprovalEvidence {
  schema: 1;
  status: "active" | "superseded";
  approver: string;
  approved_at: string;
  plugin_version: string;
  docs_commit: string;
  digest_algorithm: "sha256";
  digest: string;
  invalidated_at?: string;
  invalidation_reason?: string;
  replaced_by?: string;
}

const DOMAIN = Buffer.from("ADW-APPROVAL-DIGEST-V1\0", "utf8");
const BUNDLE_DOMAIN = Buffer.from("ADW-APPROVAL-BUNDLE-V2\0", "utf8");

function field(label: string, content: string | Buffer): Buffer {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  return Buffer.concat([Buffer.from(`${label}:${bytes.length}\n`, "utf8"), bytes, Buffer.from("\n", "utf8")]);
}

/** Digest exact spec and plan bytes; length framing prevents concatenation ambiguity. */
export function computeApprovalDigest(spec: string | Buffer, plan: string | Buffer): string {
  return createHash("sha256").update(DOMAIN).update(field("spec", spec)).update(field("plan", plan)).digest("hex");
}

export function verifyApprovalDigest(spec: string | Buffer, plan: string | Buffer, approval: Pick<ApprovalEvidence, "digest_algorithm" | "digest">): boolean {
  if (approval.digest_algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(approval.digest)) return false;
  const actual = Buffer.from(computeApprovalDigest(spec, plan), "hex");
  return timingSafeEqual(actual, Buffer.from(approval.digest, "hex"));
}

export function verifyApproval(spec: string | Buffer, plan: string | Buffer, expectedDocsCommit: string, approval: ApprovalEvidence): boolean {
  return approval.status === "active" && approval.docs_commit === expectedDocsCommit && verifyApprovalDigest(spec, plan, approval);
}

export function createApproval(input: Omit<ApprovalEvidence, "schema" | "status" | "digest_algorithm" | "digest" | "invalidated_at" | "invalidation_reason" | "replaced_by">, spec: string | Buffer, plan: string | Buffer): ApprovalEvidence {
  return { schema: 1, status: "active", ...input, digest_algorithm: "sha256", digest: computeApprovalDigest(spec, plan) };
}

export interface ApprovalInput {
  path: "spec.md" | "plan.yaml" | "integrations.yaml";
  content: string | Buffer;
}

export interface ApprovalBundleEvidence {
  schema: 2;
  status: "active" | "superseded";
  approver: string;
  approved_at: string;
  plugin_version: string;
  docs_commit: string;
  digest_algorithm: "sha256";
  inputs: Array<{ path: ApprovalInput["path"]; digest: string }>;
  digest: string;
  invalidated_at?: string;
  invalidation_reason?: string;
  replaced_by?: string;
}

function normalizeApprovalInputs(inputs: ApprovalInput[]): ApprovalInput[] {
  const expected = ["spec.md", "plan.yaml", "integrations.yaml"];
  if (!Array.isArray(inputs) || inputs.length < 2 || inputs.length > 3) throw new TypeError("approval inputs must contain spec.md, plan.yaml, and optional integrations.yaml");
  return inputs.map((input, index) => {
    if (!input || input.path !== expected[index]) throw new TypeError(`approval input ${index + 1} must be ${expected[index]}`);
    if (!(typeof input.content === "string" || Buffer.isBuffer(input.content))) throw new TypeError("approval input content must be a string or buffer");
    return input;
  });
}

export function computeApprovalBundle(inputs: ApprovalInput[]): Pick<ApprovalBundleEvidence, "inputs" | "digest"> {
  const normalized = normalizeApprovalInputs(inputs);
  const hash = createHash("sha256").update(BUNDLE_DOMAIN);
  const descriptors = normalized.map(({ path, content }) => {
    hash.update(field(path, content));
    return { path, digest: createHash("sha256").update(content).digest("hex") };
  });
  return { inputs: descriptors, digest: hash.digest("hex") };
}

export function createApprovalBundle(input: Omit<ApprovalBundleEvidence, "schema" | "status" | "digest_algorithm" | "inputs" | "digest" | "invalidated_at" | "invalidation_reason" | "replaced_by">, inputs: ApprovalInput[]): ApprovalBundleEvidence {
  const bundle = computeApprovalBundle(inputs);
  return { schema: 2, status: "active", ...input, digest_algorithm: "sha256", ...bundle };
}

export function verifyApprovalBundle(inputs: ApprovalInput[], approval: ApprovalBundleEvidence): boolean {
  if (approval.schema !== 2 || approval.digest_algorithm !== "sha256" || !/^[0-9a-f]{64}$/.test(approval.digest)) return false;
  let bundle: Pick<ApprovalBundleEvidence, "inputs" | "digest">;
  try { bundle = computeApprovalBundle(inputs); } catch { return false; }
  if (JSON.stringify(bundle.inputs) !== JSON.stringify(approval.inputs)) return false;
  return timingSafeEqual(Buffer.from(bundle.digest, "hex"), Buffer.from(approval.digest, "hex"));
}
