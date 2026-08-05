import assert from "node:assert/strict";
import test from "node:test";
import { computeApprovalDigest, createApproval, dispatch, verifyApprovalDigest, EXIT, validateArtifact } from "../../plugin/lib/adw-helper.mjs";

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

test("approval bundle digest binds ordered paths and exact content", async () => {
  const inputs = [
    { path: "spec.md", content: "spec\n" },
    { path: "plan.yaml", content: "schema: 1\n" },
    { path: "integrations.yaml", content: "schema: 1\n" },
  ];
  const first = await dispatch("digest-bundle", { inputs });
  assert.equal(first.exitCode, EXIT.OK);
  assert.match(first.body.digest, /^[0-9a-f]{64}$/);

  const repeated = await dispatch("digest-bundle", { inputs: structuredClone(inputs) });
  assert.equal(repeated.body.digest, first.body.digest);

  await assert.rejects(
    dispatch("digest-bundle", { inputs: [inputs[1], inputs[0], inputs[2]] }),
    /spec\.md|plan\.yaml|order/i,
  );

  const renamed = structuredClone(inputs);
  renamed[2].path = "external-bindings.yaml";
  await assert.rejects(dispatch("digest-bundle", { inputs: renamed }), /integrations\.yaml|path/i);

  const changed = structuredClone(inputs);
  changed[0].content = "spec\r\n";
  assert.notEqual((await dispatch("digest-bundle", { inputs: changed })).body.digest, first.body.digest);
});

test("approval schema v2 records its ordered input manifest and v1 remains valid", async () => {
  const inputs = [
    { path: "spec.md", content: "spec\n" },
    { path: "plan.yaml", content: "schema: 1\n" },
    { path: "integrations.yaml", content: "schema: 1\n" },
  ];
  const created = await dispatch("create-approval-bundle", { ...meta, inputs });
  assert.equal(created.exitCode, EXIT.OK);
  assert.equal(created.body.approval.schema, 2);
  assert.deepEqual(created.body.approval.inputs.map(({ path }) => path), inputs.map(({ path }) => path));
  assert.ok(created.body.approval.inputs.every(({ digest }) => /^[0-9a-f]{64}$/.test(digest)));
  assert.match(created.body.approval.digest, /^[0-9a-f]{64}$/);
  assert.deepEqual(await validateArtifact("approval", created.body.approval), { valid: true, errors: [] });

  const legacy = createApproval({ ...meta, spec: "spec", plan: "plan" });
  assert.deepEqual(await validateArtifact("approval", legacy), { valid: true, errors: [] });
});

test("approval bundle verification rejects content, path, order, commit, and lifecycle drift", async () => {
  const inputs = [
    { path: "spec.md", content: "spec\n" },
    { path: "plan.yaml", content: "schema: 1\n" },
    { path: "integrations.yaml", content: "schema: 1\n" },
  ];
  const created = await dispatch("create-approval-bundle", { ...meta, inputs });
  const approval = created.body.approval;

  const current = await dispatch("verify-approval-bundle", { inputs, docs_commit: meta.docs_commit, approval });
  assert.equal(current.exitCode, EXIT.OK);
  assert.equal(current.body.verified, true);

  for (const drifted of [
    inputs.map((item, index) => index === 0 ? { ...item, content: `${item.content}changed` } : item),
    inputs.map((item, index) => index === 2 ? { ...item, path: "renamed.yaml" } : item),
    [inputs[1], inputs[0], inputs[2]],
  ]) {
    const result = await dispatch("verify-approval-bundle", { inputs: drifted, docs_commit: meta.docs_commit, approval });
    assert.equal(result.exitCode, EXIT.APPROVAL_INVALID);
    assert.equal(result.body.verified, false);
  }

  const staleCommit = await dispatch("verify-approval-bundle", { inputs, docs_commit: "f".repeat(40), approval });
  assert.equal(staleCommit.exitCode, EXIT.APPROVAL_INVALID);

  const superseded = { ...approval, status: "superseded", invalidated_at: "2026-08-05T13:00:00Z", invalidation_reason: "requirements changed" };
  const obsolete = await dispatch("verify-approval-bundle", { inputs, docs_commit: meta.docs_commit, approval: superseded });
  assert.equal(obsolete.exitCode, EXIT.APPROVAL_INVALID);
});
