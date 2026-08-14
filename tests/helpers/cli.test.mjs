import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helper = fileURLToPath(new URL("../../plugin/lib/adw-helper.mjs", import.meta.url));
function invoke(command, input) {
  const result = spawnSync(process.execPath, [helper, command], { input: JSON.stringify(input), encoding: "utf8" });
  return { status: result.status, output: JSON.parse(result.stdout) };
}

test("CLI always uses structured JSON and stable input, contract, and approval exit codes", () => {
  const badInput = spawnSync(process.execPath, [helper, "digest"], { input: "{", encoding: "utf8" });
  assert.equal(badInput.status, 2);
  assert.equal(JSON.parse(badInput.stdout).error.code, 2);

  const invalid = invoke("validate-project", { data: {} });
  assert.equal(invalid.status, 3);
  assert.equal(invalid.output.ok, false);
  assert(invalid.output.errors.every((error) => error.path && error.message));

  const mismatch = invoke("verify-approval", { approval: { version: 2 }, plan_digest: "a".repeat(64) });
  assert.equal(mismatch.status, 4);
  assert.equal(mismatch.output.verified, false);

  const unknown = invoke("validate", { artifact: "plan", data: {} });
  assert.equal(unknown.status, 2);
  assert.match(unknown.output.error.message, /unknown command/);
});

test("run-validation returns truthful evidence even when its stable exit signals failure", () => {
  const result = invoke("run-validation", {
    project_root: process.cwd(),
    recorded_at: "2026-08-13T12:00:00Z",
    commands: [{ command: "exit 9", cwd: ".", required: true }],
  });
  assert.equal(result.status, 5);
  assert.equal(result.output.evidence.commands[0].exit_code, 9);
  assert.equal(result.output.evidence.commands[0].cwd, ".", "evidence records the project-relative directory, not a local absolute path");
  assert.equal(result.output.evidence.status, "failed");
});

test("record-validation cannot be told that a required failure passed", () => {
  const failed = invoke("record-validation", {
    recorded_at: "2026-08-13T12:00:00Z",
    commands: [{ command: "npm test", cwd: ".", exit_code: 0, signal: "SIGKILL", timed_out: false, duration_ms: 2, summary: "", required: true }],
  });
  assert.equal(failed.status, 5);
  assert.equal(failed.output.evidence.status, "failed");
});
