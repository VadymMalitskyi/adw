// Resolve validation only from the reviewed project configuration. Packets may
// refer to commands; they never supply executable commands.
import { loadProjectConfig, validationCommands } from "./config.mjs";
import { ContractError } from "./safe-files.mjs";
import { resolveProjectDirectory } from "./safe-files.mjs";
import { runExecutionProcess } from "./execution-process.mjs";

export async function resolveValidation(projectRoot, reference) {
  const config = await loadProjectConfig(projectRoot);
  if (!config.valid) throw new ContractError("execution validation: project configuration is invalid");
  const matches = validationCommands(config.data).filter((item) => item.component === reference.component && item.cwd === reference.cwd && item.command === reference.command);
  if (matches.length !== 1) throw new ContractError("execution validation: reference does not uniquely match configured validation");
  return matches[0];
}
export async function runConfiguredValidation(projectRoot, reference, { processRunner = runExecutionProcess } = {}) {
  const command = await resolveValidation(projectRoot, reference);
  const cwd = await resolveProjectDirectory(projectRoot, command.cwd);
  const result = await processRunner({ argv: command.command, cwd, timeout_ms: command.timeout_ms, allowShell: true });
  return { component: command.component, cwd: command.cwd, command: command.command, source: command.source ?? "", required: command.required, ...result };
}
