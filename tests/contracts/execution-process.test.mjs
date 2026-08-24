import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedProcess } from "../../plugin/lib/execution-process.mjs";

const cwd = process.cwd();

test("the process primitive returns bounded metadata and never child output", async () => {
  const result = await runBoundedProcess({ argv: [process.execPath, "-e", "process.stdout.write('SECRET_CANARY'.repeat(100)); process.stderr.write('err')"], cwd, capture_bytes: 10 });
  assert.equal(result.exit_code, 0);
  assert.equal(result.stdout_bytes, 1300);
  assert.equal(result.stdout_truncated, true);
  assert.equal(result.stderr_bytes, 3);
  assert.equal(Object.values(result).includes("SECRET_CANARY"), false);
  assert.deepEqual(Object.keys(result).sort(), ["duration_ms", "exit_code", "signal", "stderr_bytes", "stderr_truncated", "stdout_bytes", "stdout_truncated", "timed_out"]);
});

test("the process primitive rejects shell strings by default and times out process groups", async () => {
  await assert.rejects(() => runBoundedProcess({ argv: "echo nope", cwd }), /argv must be/);
  const result = await runBoundedProcess({ argv: [process.execPath, "-e", "setInterval(() => {}, 1000)"], cwd, timeout_ms: 50, kill_grace_ms: 20 });
  assert.equal(result.timed_out, true);
  assert.notEqual(result.exit_code, 0);
});

test("a signal termination is represented without raw diagnostics", async () => {
  const result = await runBoundedProcess({ argv: [process.execPath, "-e", "process.kill(process.pid, 'SIGTERM')"], cwd });
  assert.equal(result.signal, "SIGTERM");
  assert.equal(result.timed_out, false);
});
