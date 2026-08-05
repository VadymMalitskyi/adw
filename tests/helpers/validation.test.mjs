import assert from "node:assert/strict";
import test from "node:test";
import { recordValidation, runValidationCommand } from "../../plugin/lib/adw-helper.mjs";

const commit = "a".repeat(40);
const base = { change_id: "validation-test", plugin_version: "0.1.0", code_commit: commit, docs_commit: commit, recorded_at: "2026-08-05T12:00:00Z" };

test("required nonzero exit codes remain failures while optional failures do not", () => {
  const required = recordValidation({ ...base, commands: [{ command: "false", cwd: ".", exit_code: 17, signal: null, timed_out: false, duration_ms: 1, summary: "no", required: true }], deferred: [] });
  assert.equal(required.status, "failed");
  assert.equal(required.commands[0].exit_code, 17);
  const optional = recordValidation({ ...base, commands: [{ ...required.commands[0], required: false }], deferred: [] });
  assert.equal(optional.status, "passed");
  assert.equal(recordValidation({ ...base, commands: [], deferred: [{ command: "audit", reason: "service unavailable", required: true }] }).status, "failed");
  assert.equal(recordValidation({ ...base, commands: [], deferred: [{ command: "optional audit", reason: "not configured", required: false }] }).status, "passed");
});

test("command execution preserves nonzero exits, signals, and timeouts", async () => {
  const failed = await runValidationCommand({ command: "exit 23", required: true }, process.cwd());
  assert.equal(failed.exit_code, 23);
  assert.equal(failed.signal, null);

  const signaled = await runValidationCommand({ command: "kill -TERM $$", required: true }, process.cwd());
  assert.equal(signaled.exit_code, null);
  assert.equal(signaled.signal, "SIGTERM");

  const timed = await runValidationCommand({ command: "exec sleep 2", timeout_ms: 30, required: true }, process.cwd());
  assert.equal(timed.timed_out, true);
  assert.equal(timed.exit_code, null);
  assert.equal(timed.signal, "SIGTERM");
});

test("recorded output is redacted and bounded", () => {
  const evidence = recordValidation({ ...base, commands: [{ command: "test", cwd: ".", exit_code: 1, signal: null, timed_out: false, duration_ms: 1, summary: `token=supersecret\n${"x".repeat(5000)}`, required: true }], deferred: [] });
  assert(!evidence.commands[0].summary.includes("supersecret"));
  assert(evidence.commands[0].summary.length <= 4000);
});
