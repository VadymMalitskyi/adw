import assert from "node:assert/strict";
import test from "node:test";
import {
  EXECUTION_SCHEMA_VERSION,
  scopesOverlap,
  validateExecutionEnvelope,
  validateExecutionPacket,
  validateFinalResult,
  validateLifecycleEvent,
  validateProviderResult,
} from "../../plugin/lib/execution-contract.mjs";

function packet(overrides = {}) {
  return {
    schema_version: EXECUTION_SCHEMA_VERSION,
    phase_id: "phase-1",
    groups: [{
      group_id: "execution-core", tasks: "Make the change", affected_paths: ["plugin/lib/example.mjs"],
      branch: "adw/dew/execution-core", worktree: "worktrees/dew/execution-core", validation: [], review_level: "full",
    }],
    ...overrides,
  };
}

test("execution packets normalize safe paths and reject unknown or escaping input", () => {
  assert.equal(validateExecutionPacket(packet()).groups[0].worktree, "worktrees/dew/execution-core");
  assert.throws(() => validateExecutionPacket({ ...packet(), secret: "canary" }), /unknown field/);
  assert.throws(() => validateExecutionPacket(packet({ groups: [{ ...packet().groups[0], affected_paths: ["../outside"] }] })), /safe project-relative/);
  assert.throws(() => validateExecutionPacket(packet({ groups: [packet().groups[0], { ...packet().groups[0], group_id: "second", branch: "adw/second", worktree: "worktrees/second", affected_paths: ["plugin/lib"] }] })), /scopes overlap/);
  assert.equal(scopesOverlap("src/api", "src/api/client.mjs"), true);
  assert.equal(scopesOverlap("src/api", "src/api-old"), false);
});

test("envelopes require an exact target record for every packet group", () => {
  const value = {
    schema_version: 1, packet: packet(),
    targets: [{ group_id: "execution-core", head: "a".repeat(40), status: "", content: "c".repeat(64) }],
    coordinator: { path: ".", head: "b".repeat(40), status: "", content: "d".repeat(64) }, non_targets: [],
  };
  assert.equal(validateExecutionEnvelope(value).targets.length, 1);
  assert.throws(() => validateExecutionEnvelope({ ...value, targets: [] }), /array of bounded length/);
  assert.throws(() => validateExecutionEnvelope({ ...value, targets: [{ group_id: "execution-core", head: "a".repeat(40), status: "" }] }), /content/);
});

test("provider, event, and final outputs are strict safe allowlists", () => {
  const provider = { schema_version: 1, provider: "codex", groups: [{ group_id: "execution-core", status: "passed", fix_cycles: 0, findings: [] }] };
  assert.deepEqual(validateProviderResult(provider), provider);
  assert.throws(() => validateProviderResult({ ...provider, raw_stdout: "SECRET_CANARY" }), /unknown field/);
  assert.equal(validateLifecycleEvent({ schema_version: 1, event: "workflow.completed", result: provider }).event, "workflow.completed");
  assert.throws(() => validateLifecycleEvent({ schema_version: 1, event: "workflow.started", prompt: "SECRET_CANARY" }), /unknown field/);
  const final = {
    schema_version: 1, status: "passed", groups_passed: ["execution-core"], groups_failed: [],
    groups: [{ group_id: "execution-core", status: "passed", reason: "" }], validations: [],
  };
  assert.equal(validateFinalResult(final).status, "passed");
  assert.throws(() => validateFinalResult({ ...final, stderr: "SECRET_CANARY" }), /unknown field/);
});
