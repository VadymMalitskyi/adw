// Provider-neutral prompts and schemas.  Keep prompts stage-specific so a
// reviewer never receives authority to implement unrelated work.
import { EXECUTION_SCHEMA_VERSION } from "./execution-contract.mjs";

export const providerResultSchema = Object.freeze({ type: "object", additionalProperties: false, required: ["schema_version", "provider", "groups"], properties: { schema_version: { const: EXECUTION_SCHEMA_VERSION }, provider: { enum: ["codex", "claude"] }, groups: { type: "array" } } });
export function stageResultSchema(stage) { return { type: "object", additionalProperties: false, required: ["status", "findings"], properties: { status: { enum: ["passed", "failed"] }, findings: { type: "array", items: { type: "object", additionalProperties: false, required: ["severity", "summary"], properties: { severity: { enum: ["high", "medium", "low"] }, summary: { type: "string", maxLength: 2048 } } } }, stage: { const: stage } } }; }
export function buildStagePrompt({ group, stage }) {
  const mode = stage === "review" ? "Inspect only. Do not edit files." : "You may edit only the declared affected paths.";
  return `ADW deterministic execution stage: ${stage}\nWorktree: ${group.worktree}\nAffected paths: ${group.affected_paths.join(", ")}\nTasks: ${group.tasks}\n${mode}\nNever commit, push, create external objects, or change files outside the worktree. Return only the requested structured result.`;
}
