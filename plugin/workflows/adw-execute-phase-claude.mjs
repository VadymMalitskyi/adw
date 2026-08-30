export const meta = {
  name: "adw-execute-phase-claude",
  description: "Run one confirmed ADW phase with native Claude subagents and shared Git gates",
  phases: [
    { title: "Implement", detail: "implement each isolated group" },
    { title: "Review", detail: "fresh read-only review after every edit stage" },
    { title: "Fix", detail: "repair high-severity findings, at most twice" },
  ],
};

// Workflow scripts cannot import the shared Node modules or invoke tools
// directly. Each fresh stage agent runs the deterministic CLI gate itself. The
// coordinator still sends this workflow's candidate result to the finalizer.
const input = args && typeof args === "object" ? args : {};
const envelope = input.execution_envelope;
const projectRoot = input.project_root;
const pluginRoot = input.plugin_root;
const envelopeFile = input.envelope_file;
const envelopeSha256 = input.envelope_sha256;
const groups = envelope && envelope.packet && Array.isArray(envelope.packet.groups) ? envelope.packet.groups : [];

if (!envelope || envelope.schema_version !== 1 || !groups.length || typeof projectRoot !== "string" || typeof pluginRoot !== "string" || typeof envelopeFile !== "string" || !/^[a-f0-9]{64}$/.test(envelopeSha256 || "")) {
  throw new Error("adw Claude workflow requires an execution envelope, roots, and its bound temporary file");
}

const FINDING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["severity", "summary"],
  properties: {
    severity: { enum: ["high", "medium", "low"] },
    summary: { type: "string", maxLength: 2048 },
  },
};

const STAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "findings"],
  properties: {
    status: { enum: ["passed", "failed"] },
    findings: { type: "array", items: FINDING_SCHEMA },
    snapshot: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function gateCommand(group, since) {
  const sinceOption = since ? ` --since ${shellQuote(since)}` : "";
  return `node ${shellQuote(`${pluginRoot}/bin/adw.mjs`)} execution-assert-target --project-root ${shellQuote(projectRoot)} --envelope-file ${shellQuote(envelopeFile)} --envelope-sha256 ${shellQuote(envelopeSha256)} --group-id ${shellQuote(group.group_id)}${sinceOption}`;
}

function commonPrompt(group, stage) {
  const mode = stage === "review"
    ? "Inspect only. Do not edit, format, generate, or otherwise change any file."
    : "You may edit only the declared affected paths.";
  return `ADW deterministic execution stage: ${stage}
Worktree: ${group.worktree}
Affected paths: ${group.affected_paths.join(", ")}
Tasks: ${group.tasks}
${mode}
Never commit, push, create external objects, touch another worktree, or change files outside this worktree.`;
}

function stagePrompt(group, stage, since, findings = []) {
  const gateMeaning = since
    ? "The command must pass with the supplied pre-review snapshot, proving this read-only review made no changes."
    : "The command must pass, proving HEAD is unchanged and every changed path remains in scope.";
  const stageTask = stage === "review"
    ? "Review the current diff against the tasks. Report concrete correctness, security, and regression findings; do not manufacture findings."
    : stage === "fix"
      ? `Fix only these high-severity review findings:\n${findings.filter((finding) => finding.severity === "high").map((finding) => `- ${finding.summary}`).join("\n")}`
      : "Implement the declared tasks completely and keep the change inside the declared paths.";
  return `${commonPrompt(group, stage)}

${stageTask}

After completing the stage, run exactly this deterministic gate command from the group worktree:
${gateCommand(group, since)}

${gateMeaning}
If the gate fails, return status=failed. If it passes, copy only the snapshot field from its JSON output into your structured result. Never invent a snapshot or report passed without running the gate. Return only the requested structured result.`;
}

function passedStage(result) {
  return result && result.status === "passed" && typeof result.snapshot === "string" && /^[a-f0-9]{64}$/.test(result.snapshot);
}

function failedState(group, fixCycles = 0, findings = []) {
  return { group, failed: true, complete: false, fix_cycles: fixCycles, findings };
}

function runImplement(group) {
  return agent(stagePrompt(group, "implement"), {
    label: `implement:${group.group_id}`,
    phase: "Implement",
    schema: STAGE_SCHEMA,
  }).then((result) => passedStage(result)
    ? { group, failed: false, complete: false, fix_cycles: 0, findings: [], snapshot: result.snapshot }
    : failedState(group));
}

function runReview(state, cycle) {
  if (!state || state.failed || state.complete) return state;
  return agent(stagePrompt(state.group, "review", state.snapshot), {
    label: `review-${cycle + 1}:${state.group.group_id}`,
    phase: "Review",
    schema: STAGE_SCHEMA,
    disallowedTools: ["Edit", "Write", "NotebookEdit"],
  }).then((result) => {
    if (!passedStage(result)) return failedState(state.group, state.fix_cycles, state.findings);
    const findings = result.findings || [];
    const hasHigh = findings.some((finding) => finding.severity === "high");
    return { ...state, findings, snapshot: result.snapshot, complete: !hasHigh };
  });
}

function runFix(state, cycle) {
  if (!state || state.failed || state.complete) return state;
  return agent(stagePrompt(state.group, "fix", undefined, state.findings), {
    label: `fix-${cycle}:${state.group.group_id}`,
    phase: "Fix",
    schema: STAGE_SCHEMA,
  }).then((result) => passedStage(result)
    ? { ...state, fix_cycles: cycle, findings: [], snapshot: result.snapshot }
    : failedState(state.group, cycle, state.findings));
}

const states = await pipeline(
  groups,
  (group) => runImplement(group),
  (state) => runReview(state, 0),
  (state) => runFix(state, 1),
  (state) => runReview(state, 1),
  (state) => runFix(state, 2),
  (state) => runReview(state, 2),
);

const providerGroups = groups.map((group, index) => {
  const state = states[index];
  const unresolvedHigh = state && state.findings && state.findings.some((finding) => finding.severity === "high");
  const passed = state && !state.failed && state.complete && !unresolvedHigh;
  return {
    group_id: group.group_id,
    status: passed ? "passed" : "failed",
    fix_cycles: state && Number.isInteger(state.fix_cycles) ? state.fix_cycles : 0,
    findings: state && Array.isArray(state.findings) ? state.findings : [],
  };
});

log(`Claude execution candidate complete: ${providerGroups.filter((group) => group.status === "passed").length}/${providerGroups.length} groups passed provider stages.`);
return { schema_version: 1, provider: "claude", groups: providerGroups };
