// Coordinator-owned preflight and final gate. Provider output is advisory;
// Git evidence and configured validation decide whether a run passes.
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
