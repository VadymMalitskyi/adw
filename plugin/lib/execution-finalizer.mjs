// Coordinator-owned preflight and final gate. Provider output is advisory;
// Git evidence and configured validation decide whether a run passes.
import { createHash } from "node:crypto";
import { ContractError } from "./safe-files.mjs";
import { validateExecutionPacket, validateExecutionEnvelope, validateProviderResult, validateFinalResult, EXECUTION_SCHEMA_VERSION } from "./execution-contract.mjs";
import { captureExecutionBaselines, assertSnapshotEqual, assertTargetState } from "./execution-git.mjs";
import { runConfiguredValidation } from "./execution-validation.mjs";

function failure(packet, reason, validations = []) {
  const groups = packet.groups.map(({ group_id }) => ({ group_id, status: "failed", reason }));
  return validateFinalResult({ schema_version: EXECUTION_SCHEMA_VERSION, status: "failed", groups_passed: [], groups_failed: groups.map(({ group_id }) => group_id), groups, validations });
}
export function executionPreflight(projectRoot, input) {
  const packet = validateExecutionPacket(input);
  const baselines = captureExecutionBaselines(projectRoot, packet);
  return validateExecutionEnvelope({ schema_version: EXECUTION_SCHEMA_VERSION, packet, ...baselines });
}
// The between-stage gate. A coordinator that drives stages itself has no worker
// process to gate against, so it calls this after each stage instead: HEAD is
// still the baseline, writes stayed inside the group's paths, and — when
// `since` is supplied — a read-only stage changed nothing.
export function executionAssertTarget(projectRoot, input) {
  let envelope;
  try { envelope = validateExecutionEnvelope(input.execution_envelope); }
  catch (error) { throw error instanceof ContractError ? error : new ContractError("execution assert: malformed envelope"); }
  const group = envelope.packet.groups.find(({ group_id }) => group_id === input.group_id);
  if (!group) throw new ContractError(`execution assert: unknown group ${JSON.stringify(input.group_id ?? "")}`);
  const target = envelope.targets.find(({ group_id }) => group_id === group.group_id);
  const actual = assertTargetState(projectRoot, group, target, { allowChanges: true });
  const snapshot = createHash("sha256").update(actual.status).update("\0").update(actual.content).digest("hex");
  if (typeof input.since === "string" && input.since !== snapshot) throw new ContractError(`execution assert: ${group.group_id} changed during a read-only stage`);
  return { group_id: group.group_id, snapshot };
}
function verifyGit(projectRoot, envelope) {
  assertSnapshotEqual(projectRoot, envelope.coordinator);
  for (const checkout of envelope.non_targets) assertSnapshotEqual(projectRoot, checkout);
  for (const group of envelope.packet.groups) {
    const target = envelope.targets.find(({ group_id }) => group_id === group.group_id);
    assertTargetState(projectRoot, group, target);
  }
}
export async function executionFinalize(projectRoot, input, { validationRunner = runConfiguredValidation } = {}) {
  let envelope;
  try { envelope = validateExecutionEnvelope(input.execution_envelope); }
  catch (error) { throw error instanceof ContractError ? error : new ContractError("execution finalizer: malformed envelope"); }
  let provider;
  try { provider = validateProviderResult(input.provider_result); }
  catch (error) { return failure(envelope.packet, "provider-result-invalid"); }
  try { verifyGit(projectRoot, envelope); }
  catch (error) { return failure(envelope.packet, "git-gate-failed"); }
  const failed = new Set(provider.groups.filter(({ status }) => status !== "passed" || findings.some(({ severity }) => severity === "high")).map(({ group_id }) => group_id));
  if (provider.groups.length !== envelope.packet.groups.length || provider.groups.some(({ group_id }) => !envelope.packet.groups.some((group) => group.group_id === group_id))) return failure(envelope.packet, "provider-result-mismatch");
  if (failed.size) return validateFinalResult({ schema_version: EXECUTION_SCHEMA_VERSION, status: "failed", groups_passed: envelope.packet.groups.filter(({ group_id }) => !failed.has(group_id)).map(({ group_id }) => group_id), groups_failed: [...failed], groups: envelope.packet.groups.map(({ group_id }) => ({ group_id, status: failed.has(group_id) ? "failed" : "passed", reason: failed.has(group_id) ? "provider-failed" : "" })), validations: [] });
  const validations = [];
  try {
    for (const group of envelope.packet.groups) for (const reference of group.validation) {
      const result = await validationRunner(projectRoot, reference); validations.push(result);
      verifyGit(projectRoot, envelope);
      if (result.required && (result.exit_code !== 0 || result.signal !== null || result.timed_out)) throw new ContractError("required validation failed");
    }
  } catch (error) { return failure(envelope.packet, "validation-or-git-gate-failed", validations); }
  const groups = envelope.packet.groups.map(({ group_id }) => ({ group_id, status: "passed", reason: "" }));
  return validateFinalResult({ schema_version: EXECUTION_SCHEMA_VERSION, status: "passed", groups_passed: groups.map(({ group_id }) => group_id), groups_failed: [], groups, validations });
}
