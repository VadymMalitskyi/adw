import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContractError } from "../safe-files.mjs";
import { stageResultSchema, buildStagePrompt } from "../execution-adapter.mjs";

function run(command, args, input, cwd) { return new Promise((resolveResult, reject) => { const child = spawn(command, args, { cwd, stdio: ["pipe", "ignore", "ignore"] }); child.once("error", reject); child.once("close", (code) => resolveResult(code)); child.stdin.end(input); }); }
export function codexArgv({ executable = "codex", cwd, schemaPath, resultPath }) { return ["exec", "-C", cwd, "-c", 'approval_policy="never"', "--json", "--output-schema", schemaPath, "--output-last-message", resultPath, "-"]; }
export function createCodexAdapter({ executable = "codex", spawnRunner = run } = {}) {
  return { async runStage({ stage, group }) {
    const directory = await mkdtemp(join(tmpdir(), "adw-codex-")); const schemaPath = join(directory, "schema.json"); const resultPath = join(directory, "result.json");
    try { await writeFile(schemaPath, JSON.stringify(stageResultSchema(stage))); const code = await spawnRunner(executable, codexArgv({ executable, cwd: group.worktree, schemaPath, resultPath }), buildStagePrompt({ group, stage }), group.worktree); if (code !== 0) throw new ContractError("execution codex: worker exited nonzero"); return JSON.parse(await readFile(resultPath, "utf8")); }
    catch (error) { throw error instanceof ContractError ? error : new ContractError("execution codex: invalid worker result"); }
    finally { await rm(directory, { recursive: true, force: true }); }
  } };
}
