// Bounded child-process runner. Public callers receive metadata only: never
// child stdout, stderr, environment, or command text.
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_CAPTURE_BYTES = 65_536;

function inputError(message) { throw new TypeError(`execution process: ${message}`); }
function boundedInteger(value, name, fallback) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 86_400_000) inputError(`${name} must be a positive bounded integer`);
  return value;
}

export async function runBoundedProcess({ argv, cwd, timeout_ms, capture_bytes, allowShell = false, env, kill_grace_ms = 1_000 } = {}) {
  const timeout = boundedInteger(timeout_ms, "timeout_ms", DEFAULT_TIMEOUT_MS);
  const capture = boundedInteger(capture_bytes, "capture_bytes", DEFAULT_CAPTURE_BYTES);
  const grace = boundedInteger(kill_grace_ms, "kill_grace_ms", 1_000);
  if (typeof cwd !== "string" || cwd.length === 0) inputError("cwd is required");
  if (typeof allowShell !== "boolean") inputError("allowShell must be boolean");
  const isArgv = Array.isArray(argv) && argv.length > 0 && argv.every((part) => typeof part === "string" && part.length > 0 && !part.includes("\0"));
  if (!isArgv && !(allowShell && typeof argv === "string" && argv.length > 0 && !argv.includes("\0"))) inputError("argv must be a non-empty string array (or a shell command when allowShell is true)");
  const started = Date.now();
  let stdoutBytes = 0; let stderrBytes = 0; let stdoutCaptured = 0; let stderrCaptured = 0;
  let timedOut = false; let killTimer; let child;
  try {
    child = typeof argv === "string"
      ? spawn(argv, { cwd, env, shell: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] })
      : spawn(argv[0], argv.slice(1), { cwd, env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    return processResult({ exit_code: null, signal: null, timed_out: false, duration_ms: Date.now() - started, stdout_bytes: 0, stderr_bytes: 0, stdout_truncated: false, stderr_truncated: false, spawn_error: true });
  }
  const count = (stream, bytes, captured) => stream.on("data", (chunk) => { bytes.value += chunk.length; captured.value = Math.min(capture, captured.value + chunk.length); });
  const stdout = { value: stdoutBytes }; const stderr = { value: stderrBytes }; const stdoutCap = { value: stdoutCaptured }; const stderrCap = { value: stderrCaptured };
  count(child.stdout, stdout, stdoutCap); count(child.stderr, stderr, stderrCap);
  const terminate = (signal) => { try { if (process.platform !== "win32" && child.pid) process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  const outcome = await new Promise((resolveResult) => {
    const timer = setTimeout(() => {
      timedOut = true;
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), grace);
    }, timeout);
    child.once("error", () => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); resolveResult({ code: null, signal: null }); });
    child.once("close", (code, signal) => { clearTimeout(timer); if (killTimer) clearTimeout(killTimer); resolveResult({ code, signal }); });
  });
  return processResult({ exit_code: outcome.code, signal: outcome.signal, timed_out: timedOut, duration_ms: Date.now() - started, stdout_bytes: stdout.value, stderr_bytes: stderr.value, stdout_truncated: stdout.value > capture, stderr_truncated: stderr.value > capture });
}

function processResult(result) {
  // `spawn_error` is intentionally internal only; no diagnostic strings escape.
  const { spawn_error, ...safe } = result;
  return Object.freeze(safe);
}

export const runExecutionProcess = runBoundedProcess;
