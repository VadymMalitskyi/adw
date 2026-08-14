import assert from "node:assert/strict";
import test from "node:test";
import {
  computeDigest,
  createPlanApproval,
  dispatch,
  EXIT,
  supersedePlanApproval,
  validatePlanApproval,
  verifyPlanApproval,
} from "../../plugin/lib/adw-helper.mjs";

const PLAN = "# PART 1 — Feature Overview\n\n## Summary\n\nThrottle tenants.\n";
const COMMIT = "a".repeat(40);

function approval(overrides = {}) {
  return createPlanApproval({
    change_id: "tenant-throttling",
    plan_path: "changes/tenant-throttling/plan.md",
    plan_digest: computeDigest(PLAN),
    plan_commit: COMMIT,
    approved_by: "Ada Lovelace",
    approved_at: "2026-08-13T12:00:00Z",
    ...overrides,
  });
}

test("approval binds one canonical plan by its exact bytes and docs commit", () => {
  const record = approval();
  assert.equal(record.version, 1);
  assert.equal(record.status, "active");
  assert.equal(record.plan_path, "changes/tenant-throttling/plan.md");
  assert.match(record.plan_digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(validatePlanApproval(record), { valid: true, errors: [] });

  const verified = verifyPlanApproval({ approval: record, plan_bytes: PLAN, plan_commit: COMMIT, change_id: "tenant-throttling", plan_path: record.plan_path });
  assert.equal(verified.verified, true);

  // There is no ordered input bundle, spec pairing, or plugin-version binding.
  assert.deepEqual(Object.keys(record).sort(), [
    "approved_at", "approved_by", "change_id", "plan_commit", "plan_digest", "plan_path", "status", "version",
  ]);
});

test("any change to the approved plan bytes makes approval stale", () => {
  const record = approval();
  for (const drifted of [`${PLAN}extra\n`, PLAN.replace("Throttle", "throttle"), PLAN.replace(/\n/g, "\r\n")]) {
    const result = verifyPlanApproval({ approval: record, plan_bytes: drifted, plan_commit: COMMIT });
    assert.equal(result.verified, false, `drifted plan bytes must not verify: ${JSON.stringify(drifted.slice(0, 24))}`);
    assert.match(result.reason, /plan bytes changed/);
  }
});

test("approval verification rejects a different commit, change, path, or lifecycle state", () => {
  const record = approval();
  const base = { approval: record, plan_bytes: PLAN };

  assert.equal(verifyPlanApproval({ ...base, plan_commit: "f".repeat(40) }).verified, false);
  assert.equal(verifyPlanApproval({ ...base, plan_commit: COMMIT, change_id: "other-change" }).verified, false);
  assert.equal(verifyPlanApproval({ ...base, plan_commit: COMMIT, plan_path: "changes/other/plan.md" }).verified, false);

  const superseded = supersedePlanApproval(record, { reason: "the storage design changed", superseded_at: "2026-08-13T13:00:00Z" });
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.superseded_reason, "the storage design changed");
  assert.equal(superseded.plan_digest, record.plan_digest, "history keeps the digest it was filed under");
  const stale = verifyPlanApproval({ ...base, plan_commit: COMMIT, approval: superseded });
  assert.equal(stale.verified, false);
  assert.match(stale.reason, /superseded/);
});

test("the approval lifecycle refuses malformed and contradictory records", () => {
  assert.throws(() => approval({ plan_commit: "not-a-commit" }), /plan_commit/);
  assert.throws(() => approval({ plan_digest: "short" }), /plan_digest/);
  assert.throws(() => approval({ approved_at: "yesterday" }), /approved_at/);
  assert.throws(() => approval({ plan_path: "changes/other/plan.md" }), /plan_path/);
  assert.throws(() => approval({ change_id: "../escape" }), /change_id/);

  const record = approval();
  assert.throws(() => supersedePlanApproval(record, { reason: "  ", superseded_at: "2026-08-13T13:00:00Z" }), /specific human-provided reason/);
  assert.throws(
    () => supersedePlanApproval(supersedePlanApproval(record, { reason: "first", superseded_at: "2026-08-13T13:00:00Z" }), { reason: "again", superseded_at: "2026-08-13T14:00:00Z" }),
    /only an active approval/,
  );

  const contradictory = { ...record, superseded_reason: "silently invalidated" };
  assert.equal(validatePlanApproval(contradictory).valid, false);
});

test("the approval CLI never asks a human to transcribe a digest and reports stable exit codes", async () => {
  const created = await dispatch("create-approval", {
    change_id: "tenant-throttling",
    plan_digest: computeDigest(PLAN),
    plan_commit: COMMIT,
    approved_by: "Ada Lovelace",
    approved_at: "2026-08-13T12:00:00Z",
  });
  assert.equal(created.exitCode, EXIT.OK);
  assert.equal(created.body.approval.plan_path, "changes/tenant-throttling/plan.md");

  const good = await dispatch("verify-approval", { approval: created.body.approval, plan_bytes: PLAN, plan_commit: COMMIT });
  assert.equal(good.exitCode, EXIT.OK);
  assert.equal(good.body.verified, true);

  const bad = await dispatch("verify-approval", { approval: created.body.approval, plan_bytes: `${PLAN} ` , plan_commit: COMMIT });
  assert.equal(bad.exitCode, EXIT.APPROVAL_INVALID);
  assert.equal(bad.body.verified, false);

  const history = await dispatch("supersede-approval", { approval: created.body.approval, reason: "scope changed", superseded_at: "2026-08-13T13:00:00Z" });
  assert.equal(history.exitCode, EXIT.OK);
  assert.equal(history.body.history_path, `approval-history/${created.body.approval.plan_digest}.json`);
});
