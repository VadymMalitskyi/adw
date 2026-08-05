import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../../plugin/lib/adw-helper.mjs", import.meta.url));
function invoke(command, input) {
  const result = spawnSync(process.execPath, [helper, command], { input: JSON.stringify(input), encoding: "utf8" });
  return { status: result.status, output: JSON.parse(result.stdout) };
}

test("CLI always uses structured JSON and stable input/schema/approval exit codes", () => {
  const badInput = spawnSync(process.execPath, [helper, "digest"], { input: "{", encoding: "utf8" });
  assert.equal(badInput.status, 2);
  assert.equal(JSON.parse(badInput.stdout).error.code, 2);

  const invalid = invoke("validate", { artifact: "approval", data: {} });
  assert.equal(invalid.status, 3);
  assert.equal(invalid.output.ok, false);
  assert(invalid.output.errors.every((error) => error.path && error.message));

  const mismatch = invoke("verify-approval", { spec: "x", plan: "y", approval: { schema: 1 } });
  assert.equal(mismatch.status, 4);
  assert.equal(mismatch.output.verified, false);
});

test("record-validation returns evidence even when its stable exit signals failure", () => {
  const commit = "a".repeat(40);
  const result = invoke("record-validation", { change_id: "cli-test", plugin_version: "0.1.0", code_commit: commit, docs_commit: commit, recorded_at: "2026-08-05T12:00:00Z", commands: [{ command: "test", cwd: ".", exit_code: 9, signal: null, timed_out: false, duration_ms: 2, summary: "failure", required: true }], deferred: [] });
  assert.equal(result.status, 5);
  assert.equal(result.output.evidence.commands[0].exit_code, 9);
  assert.equal(result.output.evidence.status, "failed");
});
