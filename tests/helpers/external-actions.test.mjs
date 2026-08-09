import assert from "node:assert/strict";
import test from "node:test";
import { computeAuthorizationDigest, dispatch, EXIT, validateArtifact } from "../../plugin/lib/adw-helper.mjs";

const base = {
  change_id: "api.retry",
  sequence: 1,
  capability: "work_tracker",
  provider: "azure-devops",
  transport: "cli",
  operation: "read_work_item",
  effect: "read",
  target: "contoso/platform/12345",
  idempotency_key: "adw:platform:api.retry:read_work_item:12345",
  requested_at: "2026-08-05T12:00:00Z",
  payload: { fields: ["title", "description"] },
  readback: { external_id: "12345", revision: 7 },
  summary: "read item; token=read-secret api_key=also-secret",
  verified: true,
};

test("read receipts require idempotency but no mutation authorization", async () => {
  const recorded = await dispatch("record-external-action", base);
  assert.equal(recorded.exitCode, EXIT.OK);
  assert.equal(recorded.body.ok, true);
  assert.equal(recorded.body.receipt.schema, 1);
  assert.equal(recorded.body.receipt.effect, "read");
  assert.equal(recorded.body.receipt.idempotency_key, base.idempotency_key);
  assert.equal(recorded.body.receipt.authorized_by, undefined);
  assert.equal(recorded.body.receipt.authorization_digest, undefined);
  assert.deepEqual(await validateArtifact("external-action", recorded.body.receipt), { valid: true, errors: [] });

  const missingKey = await dispatch("record-external-action", { ...base, idempotency_key: undefined });
  assert.equal(missingKey.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(missingKey.body.errors.some(({ path }) => path === "/idempotency_key"));
});

test("write receipts require authorization evidence and verified readback", async () => {
  const write = {
    ...base,
    operation: "create_work_item",
    effect: "write",
    target: "contoso/platform",
    idempotency_key: "adw:platform:api.retry:create_work_item",
    authorized_by: "Ada",
    payload: { title: "Retry API calls", access_token: "payload-secret" },
    readback: { external_id: "12345", revision: 1, password: "readback-secret" },
    summary: "created item; Authorization: Bearer summary-secret",
    verified: true,
  };
  write.authorization_digest = computeAuthorizationDigest(write);

  const recorded = await dispatch("record-external-action", write);
  assert.equal(recorded.exitCode, EXIT.OK);
  const { receipt } = recorded.body;
  assert.equal(receipt.effect, "write");
  assert.equal(receipt.authorized_by, "Ada");
  assert.equal(receipt.authorization_digest, write.authorization_digest);
  assert.equal(receipt.verified, true);
  assert.match(receipt.request_digest, /^[0-9a-f]{64}$/);
  assert.match(receipt.readback_digest, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(receipt, "payload"), false);
  assert.equal(Object.hasOwn(receipt, "readback"), false);
  assert.doesNotMatch(JSON.stringify(receipt), /payload-secret|readback-secret|summary-secret/);
  assert.match(receipt.summary, /\[REDACTED\]/);
  assert.deepEqual(await validateArtifact("external-action", receipt), { valid: true, errors: [] });

  const missingActor = await dispatch("record-external-action", { ...write, authorized_by: undefined });
  assert.equal(missingActor.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(missingActor.body.errors.some(({ keyword }) => keyword === "authorization"));
  const missingAuthorization = await dispatch("record-external-action", { ...write, authorization_digest: undefined });
  assert.equal(missingAuthorization.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(missingAuthorization.body.errors.some(({ keyword }) => keyword === "authorization"));
  const unverified = await dispatch("record-external-action", { ...write, verified: false });
  assert.equal(unverified.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(unverified.body.errors.some(({ keyword }) => keyword === "readback"));
});

test("external action digests are deterministic and cover exact payload and readback data", async () => {
  const one = (await dispatch("record-external-action", base)).body.receipt;
  const same = (await dispatch("record-external-action", structuredClone(base))).body.receipt;
  assert.equal(same.request_digest, one.request_digest);
  assert.equal(same.readback_digest, one.readback_digest);

  const changedPayload = structuredClone(base);
  changedPayload.payload.fields.push("state");
  const payloadReceipt = (await dispatch("record-external-action", changedPayload)).body.receipt;
  assert.notEqual(payloadReceipt.request_digest, one.request_digest);
  assert.equal(payloadReceipt.readback_digest, one.readback_digest);

  const changedReadback = structuredClone(base);
  changedReadback.readback.revision = 8;
  const readbackReceipt = (await dispatch("record-external-action", changedReadback)).body.receipt;
  assert.equal(readbackReceipt.request_digest, one.request_digest);
  assert.notEqual(readbackReceipt.readback_digest, one.readback_digest);
});

test("requirement digests canonicalize object keys while preserving meaningful array order", async () => {
  const first = await dispatch("digest-requirements", { fields: { title: "Retry calls", acceptance_criteria: ["bounded", "observable"] } });
  const reorderedKeys = await dispatch("digest-requirements", { fields: { acceptance_criteria: ["bounded", "observable"], title: "Retry calls" } });
  const reorderedCriteria = await dispatch("digest-requirements", { fields: { title: "Retry calls", acceptance_criteria: ["observable", "bounded"] } });

  assert.equal(first.exitCode, EXIT.OK);
  assert.equal(reorderedKeys.body.digest, first.body.digest);
  assert.notEqual(reorderedCriteria.body.digest, first.body.digest);
  assert.match(first.body.digest, /^[0-9a-f]{64}$/);
});
