import assert from "node:assert/strict";
import test from "node:test";
import { computeApprovalDigest, createApproval, dispatch, verifyApprovalDigest, EXIT } from "../../plugin/lib/adw-helper.mjs";

const meta = { approver: "Ada", approved_at: "2026-08-05T12:00:00Z", plugin_version: "0.1.0", docs_commit: "a".repeat(40) };

test("approval digest is deterministic, exact-byte sensitive, and ordered spec then plan", () => {
  const digest = computeApprovalDigest("spec\n", "plan\n");
  assert.equal(digest, computeApprovalDigest(Buffer.from("spec\n"), Buffer.from("plan\n")));
  assert.notEqual(digest, computeApprovalDigest("spec", "plan\n"));
  assert.notEqual(digest, computeApprovalDigest("plan\n", "spec\n"));
  assert.notEqual(digest, computeApprovalDigest("spec\r\n", "plan\n"));
});

test("content, lifecycle, and docs commit all invalidate approval verification", async () => {
  const approval = createApproval({ ...meta, spec: "spec", plan: "plan" });
  assert.equal(verifyApprovalDigest("spec", "plan", approval), true);
  assert.equal(verifyApprovalDigest("changed", "plan", approval), false);

  const stale = await dispatch("verify-approval", { spec: "spec", plan: "plan", docs_commit: "b".repeat(40), approval });
  assert.equal(stale.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(stale.body.reason, /different docs commit/);

  const superseded = { ...approval, status: "superseded", invalidated_at: "2026-08-05T13:00:00Z", invalidation_reason: "amended" };
  const obsolete = await dispatch("verify-approval", { spec: "spec", plan: "plan", docs_commit: meta.docs_commit, approval: superseded });
  assert.equal(obsolete.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(obsolete.body.reason, /superseded/);
});
