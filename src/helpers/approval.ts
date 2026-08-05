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
