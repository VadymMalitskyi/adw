import { EXECUTION_SCHEMA_VERSION, validateProviderResult, validateLifecycleEvent } from "./execution-contract.mjs";

function findings(result) { return Array.isArray(result?.findings) ? result.findings.filter((item) => item && ["high", "medium", "low"].includes(item.severity) && typeof item.summary === "string").map(({ severity, summary }) => ({ severity, summary: summary.slice(0, 2048) })) : []; }
function validStage(result) { return result && ["passed", "failed"].includes(result.status) && Array.isArray(result.findings); }
export async function runExecutionGroups(envelope, { adapter, git, emit = () => {}, clock = () => Date.now() } = {}) {
  const event = (value) => emit(validateLifecycleEvent({ schema_version: EXECUTION_SCHEMA_VERSION, ...value }));
  event({ event: "workflow.started" });
  const groups = await Promise.all(envelope.packet.groups.map(async (group) => {
    const start = clock(); let fix_cycles = 0; let collected = [];
    try {
      event({ event: "group.started", group_id: group.group_id });
      let stage = "implement"; let result = await adapter.runStage({ stage, group }); if (!validStage(result) || result.status === "failed") throw new Error("invalid implementation result"); await git.assertTarget(group, { allowChanges: true }); event({ event: "stage.completed", group_id: group.group_id, stage, status: result.status });
      for (;;) {
        stage = "review"; const before = await git.snapshot(group); result = await adapter.runStage({ stage, group }); if (!validStage(result) || result.status === "failed") throw new Error("invalid review result"); await git.assertTarget(group, { allowChanges: true }); await git.assertUnchanged(group, before); collected = findings(result); event({ event: "stage.completed", group_id: group.group_id, stage, status: result.status });
        if (!collected.some(({ severity }) => severity === "high")) break;
        if (fix_cycles >= 2) throw new Error("unresolved high finding"); fix_cycles += 1;
        stage = "fix"; result = await adapter.runStage({ stage, group }); if (!validStage(result) || result.status === "failed") throw new Error("invalid fix result"); await git.assertTarget(group, { allowChanges: true }); event({ event: "stage.completed", group_id: group.group_id, stage, status: result.status });
      }
      const answer = { group_id: group.group_id, status: "passed", fix_cycles, findings: collected }; event({ event: "group.completed", group_id: group.group_id, status: "passed", duration_ms: clock() - start }); return answer;
    } catch { const answer = { group_id: group.group_id, status: "failed", fix_cycles, findings: collected }; event({ event: "group.completed", group_id: group.group_id, status: "failed", duration_ms: clock() - start }); return answer; }
  }));
  const result = validateProviderResult({ schema_version: EXECUTION_SCHEMA_VERSION, provider: "codex", groups }); event({ event: "workflow.completed", result }); return result;
}
