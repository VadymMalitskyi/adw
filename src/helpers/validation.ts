import { spawn } from "node:child_process";

export interface ValidationCommandInput { command: string; cwd?: string; timeout_ms?: number; required?: boolean }
export interface ValidationCommandResult { command: string; cwd: string; exit_code: number | null; signal: string | null; timed_out: boolean; duration_ms: number; summary: string; required: boolean }
export interface DeferredValidation { command: string; reason: string; required: boolean }
export interface ValidationEvidence {
  schema: 1;
  change_id: string;
  plugin_version: string;
  code_commit: string;
  docs_commit: string;
  recorded_at: string;
  status: "passed" | "failed";
  commands: ValidationCommandResult[];
  deferred: DeferredValidation[];
}

function redactAndBound(text: string): string {
  return text
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|token|api[_-]?key|secret)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]")
    .slice(-4000);
}

export function recordValidation(input: Omit<ValidationEvidence, "schema" | "status">): ValidationEvidence {
  const commands = input.commands.map((result) => ({ ...result, summary: redactAndBound(result.summary) }));
  const failed = commands.some((result) => result.required && result.exit_code !== 0) || input.deferred.some((item) => item.required);
  return { schema: 1, ...input, commands, status: failed ? "failed" : "passed" };
}

export async function runValidationCommand(input: ValidationCommandInput, cwd: string): Promise<ValidationCommandResult> {
  if (input.timeout_ms !== undefined && (!Number.isInteger(input.timeout_ms) || input.timeout_ms < 1)) throw new Error("timeout_ms must be a positive integer");
  const started = Date.now();
  return await new Promise((resolve) => {
    const child = spawn(input.command, { cwd, shell: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    const finish = (result: ValidationCommandResult): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = input.timeout_ms ? setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, input.timeout_ms) : undefined;
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => finish({ command: input.command, cwd, exit_code: 1, signal: null, timed_out: timedOut, duration_ms: Date.now() - started, summary: redactAndBound(error.message), required: input.required !== false }));
    child.on("close", (code, signal) => {
      const output = `${stdout}${stderr}`.trim();
      const signalSummary = signal ? `terminated by ${signal}` : "";
      finish({ command: input.command, cwd, exit_code: code, signal, timed_out: timedOut, duration_ms: Date.now() - started, summary: redactAndBound(output || signalSummary), required: input.required !== false });
    });
  });
}
