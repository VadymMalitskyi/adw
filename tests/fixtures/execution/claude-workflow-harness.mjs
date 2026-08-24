// Offline adapter for the exact shipped Dynamic Workflow source. It deliberately
// supplies only the three runtime globals available to a workflow script.
import { readFile } from "node:fs/promises";

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

export async function runClaudeWorkflow({ source, args, agent, pipeline }) {
  const executable = source.replace(/^export const meta\s*=/m, "const meta =");
  const execute = new AsyncFunction("args", "agent", "pipeline", `"use strict";\n${executable}`);
  return execute(args, agent, pipeline);
}

export async function runShippedClaudeWorkflow({ sourcePath, args, agent, pipeline }) {
  return runClaudeWorkflow({
    source: await readFile(sourcePath, "utf8"),
    args,
    agent,
    pipeline,
  });
}

export function concurrentPipeline(items, mapper) {
  return Promise.all(items.map(mapper));
}
