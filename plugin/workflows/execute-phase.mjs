// This file intentionally has no imports: Claude Dynamic Workflows execute in a
// restricted JavaScript runtime with only args, agent(), and pipeline(). Its
// agents run in Claude's acceptEdits mode and inherit the session allowlist.
export const meta = {
  name: "execute-phase",
  description: "Execute confirmed ADW phase groups with independent implementation and review gates.",
  phases: [
    { name: "implementation", description: "Implement each isolated group." },
    { name: "review", description: "Independently review each implementation." },
    { name: "fix", description: "Address high-severity review findings when needed." },
    { name: "finalization", description: "Return bounded provider results for coordinator finalization." },
  ],
};

const SCHEMA_VERSION = 1;
const MAX_CONCURRENT_GROUPS = 16;
const MAX_FIX_CYCLES = 2;

const stageSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schema_version", "status", "findings"],
  properties: {
    schema_version: { const: 1 },
    status: { enum: ["passed", "findings", "failed"] },
    findings: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "code"],
        properties: {
          severity: { enum: ["high", "medium", "low"] },
          code: { type: "string", minLength: 1, maxLength: 64 },
        },
      },
    },
  },
};

const allowedStatus = new Set(["passed", "findings", "failed"]);
const allowedSeverity = new Set(["high", "medium", "low"]);

function safeFindings(value) {
  if (!Array.isArray(value) || value.length > 50) return null;
  const findings = [];
  for (const finding of value) {
    if (!finding || typeof finding !== "object" || Object.keys(finding).length !== 2 || !allowedSeverity.has(finding.severity)) return null;
    const code = typeof finding.code === "string" && /^[a-z0-9_-]{1,64}$/i.test(finding.code)
      ? finding.code
      : "reported";
    findings.push({ severity: finding.severity, code });
  }
  return findings;
}

function safeStageResult(value) {
  if (!value || typeof value !== "object" || Object.keys(value).length !== 3 || value.schema_version !== SCHEMA_VERSION || !allowedStatus.has(value.status)) return null;
  const findings = safeFindings(value.findings);
  if (!findings) return null;
  return { status: value.status, findings };
}

function workerPrompt(group, stage, priorFindings) {
  const scope = group.affected_paths.join(", ");
  const target = group.worktree;
  const base = [
    `You are the ${stage} stage for ADW execution group ${group.group_id}.`,
    `Use only this prepared worktree: ${target}. Run Git commands as git -C ${target} ...; this is an explicit target path, not a cwd sandbox.`,
    `Allowed write scope: ${scope}.`,
    "Do not commit, amend, reset, rebase, merge, push, create pull requests, contact external services, or change files outside the allowed scope.",
    `Authoritative task instructions: ${group.tasks}`,
  ];
  if (stage === "review") {
    base.push("Review the current diff independently. Do not edit files. Report every finding using only severity (high, medium, low) and a short machine-safe code.");
  } else if (stage === "fix") {
    base.push(`Address only these high-severity finding codes: ${priorFindings.join(", ") || "reported"}. Do not make unrelated changes.`);
  } else {
    base.push("Implement the task completely within the declared scope.");
  }
  base.push("Return the requested structured result only. status is passed, findings, or failed.");
  return base.join("\n");
}

async function runStage(group, stage, priorFindings) {
  const result = await agent(workerPrompt(group, stage, priorFindings), {
    label: `${group.group_id}:${stage}`,
    schema: stageSchema,
  });
  return safeStageResult(result);
}

function failedGroup(group, fixCycles, findings) {
  return { group_id: group.group_id, status: "failed", fix_cycles: fixCycles, findings: findings || [] };
}

async function runGroup(group) {
  const stages = [];
  let implementation;
  try {
    implementation = await runStage(group, "implementation", []);
  } catch {
    return failedGroup(group, 0);
  }
  if (!implementation || implementation.status === "failed") {
    return failedGroup(group, 0, implementation?.findings);
  }
  stages.push({ stage: "implementation", status: "passed" });

  for (let cycle = 0; cycle <= MAX_FIX_CYCLES; cycle += 1) {
    let review;
    try {
      review = await runStage(group, "review", []);
    } catch {
      return failedGroup(group, cycle);
    }
    if (!review || review.status === "failed") {
      return failedGroup(group, cycle, review?.findings);
    }
    const highFindings = review.findings.filter(({ severity }) => severity === "high");
    stages.push({ stage: cycle === 0 ? "review" : "re-review", status: highFindings.length ? "findings" : "passed" });
    if (!highFindings.length) {
      return { group_id: group.group_id, status: "passed", fix_cycles: cycle, findings: review.findings };
    }
    if (cycle === MAX_FIX_CYCLES) {
      return failedGroup(group, cycle, highFindings);
    }
    let fix;
    try {
      fix = await runStage(group, "fix", highFindings.map(({ code }) => code));
    } catch {
      return failedGroup(group, cycle + 1, highFindings);
    }
    if (!fix || fix.status === "failed") {
      return failedGroup(group, cycle + 1, fix?.findings || highFindings);
    }
    stages.push({ stage: "fix", status: "passed" });
  }
  return failedGroup(group, MAX_FIX_CYCLES);
}

const groups = args && args.packet && Array.isArray(args.packet.groups) ? args.packet.groups : [];
const results = [];
for (let start = 0; start < groups.length; start += MAX_CONCURRENT_GROUPS) {
  const batch = groups.slice(start, start + MAX_CONCURRENT_GROUPS);
  const settled = await pipeline(batch, async (group) => {
    try {
      return await runGroup(group);
    } catch {
      return failedGroup(group, 0);
    }
  });
  results.push(...settled.map((result, index) => result || failedGroup(batch[index], 0)));
}

return {
  schema_version: SCHEMA_VERSION,
  provider: "claude",
  groups: results,
};
