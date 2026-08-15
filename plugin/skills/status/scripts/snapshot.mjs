#!/usr/bin/env node
// Read-only reconstruction of ADW workflow state from Git and the durable
// docs-branch artifacts: the one canonical plan, its exact-byte approval, the
// superseded approval history, and the machine-written phase run records.
//
// This script never writes, fetches, checks out, repairs, or executes project
// commands, and it never follows a symlinked artifact.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { computeDigest, loadProjectConfig, validatePlanApproval, validateRunRecord, verifyPlanApproval } from "../../../lib/adw-helper.mjs";
import { PERMISSION_PROFILE, permissionAgentsFromProject } from "../../../execution/managed-development.mjs";

const CHANGE_ID = /^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-]+)*$/;
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

function parseArguments(argv) {
  const index = argv.indexOf("--project-root");
  if (index === -1 || !argv[index + 1]) throw new Error("--project-root is required");
  return { projectRoot: realpathSync(argv[index + 1]) };
}

function git(args, cwd) {
  return spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
}

function gitBytes(args, cwd) {
  return spawnSync("git", args, { cwd, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }, maxBuffer: 8 * 1024 * 1024 });
}

// Every artifact this script reads must be a regular, non-symlink file. A
// hostile or accidental symlink is skipped, never followed.
function safeFile(path) {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  return !stat.isSymbolicLink() && stat.isFile();
}

function safeDirectory(path) {
  if (!existsSync(path)) return false;
  const stat = lstatSync(path);
  return !stat.isSymbolicLink() && stat.isDirectory();
}

function readJson(path) {
  try { return { value: JSON.parse(readFileSync(path, "utf8")) }; }
  catch (error) { return { error: error.message }; }
}

function executionSnapshot(projectRoot, project) {
  const agentTools = permissionAgentsFromProject(projectRoot, { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join });
  const providerArtifacts = {
    codex: existsSync(join(projectRoot, ".codex/config.toml")) && existsSync(join(projectRoot, ".codex/rules/adw.rules")),
    claude: existsSync(join(projectRoot, ".claude/settings.json")),
  };
  const markers = {
    managed_devcontainer: process.env.ADW_MANAGED_DEVCONTAINER === "1",
    project_devcontainer: process.env.ADW_PROJECT_DEVCONTAINER === "1" || process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true",
  };
  if (!project) {
    return { configured: false, mode: null, isolation: null, active: false, markers, reason: "adw.yaml is missing or invalid" };
  }
  const { isolation = null, mode = null } = project.execution ?? {};
  // There is no configured permission profile in `adw: 1`; the managed profile
  // is implied by managed-devcontainer isolation.
  const permissionProfile = isolation === "managed-devcontainer" ? PERMISSION_PROFILE : null;
  const active = isolation === "managed-devcontainer"
    ? markers.managed_devcontainer
    : isolation === "project-devcontainer"
      ? markers.project_devcontainer
      : isolation === "provider-sandbox"
        ? null
        : false;
  return {
    configured: Boolean(isolation && mode),
    mode,
    isolation,
    permissions: { profile: permissionProfile, agent_tools: agentTools, provider_artifacts: providerArtifacts },
    active,
    markers,
    ...(isolation === "provider-sandbox"
      ? { note: "provider-sandbox is the lightweight default and is inherently the weaker boundary" }
      : {}),
  };
}

function worktreeRecords(projectRoot) {
  const result = git(["worktree", "list", "--porcelain"], projectRoot);
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\n\n+/).filter(Boolean).map((paragraph) => {
    const item = {};
    for (const line of paragraph.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) item[line] = true;
      else item[line.slice(0, space)] = line.slice(space + 1);
    }
    return item;
  });
}

// Prove that the approval's bound docs commit is reachable from the docs branch
// and still holds byte-identical plan bytes.
function verifyPlanCommit({ projectRoot, docsBranch, commit, planRelativePath, planDigest }) {
  const type = git(["cat-file", "-t", commit], projectRoot);
  if (type.status !== 0 || type.stdout.trim() !== "commit") return { ok: false, reason: "approval plan_commit does not exist in this repository" };
  const branch = git(["rev-parse", "--verify", "--quiet", `refs/heads/${docsBranch}`], projectRoot);
  if (branch.status !== 0) return { ok: false, reason: `the configured docs branch ${docsBranch} does not exist locally` };
  const reachable = git(["merge-base", "--is-ancestor", commit, `refs/heads/${docsBranch}`], projectRoot);
  if (reachable.status !== 0) return { ok: false, reason: "approval plan_commit is not reachable from the docs branch" };
  const blob = gitBytes(["show", `${commit}:${planRelativePath}`], projectRoot);
  if (blob.status !== 0) return { ok: false, reason: "approval plan_commit does not contain the plan" };
  if (computeDigest(blob.stdout) !== planDigest) return { ok: false, reason: "approval plan_commit contains different plan bytes" };
  return { ok: true, reason: "approval matches the exact plan bytes and its bound docs commit" };
}

function approvalSnapshot({ changePath, changeId, planBytes, projectRoot, docsBranch }) {
  const approvalPath = join(changePath, "approval.json");
  if (!existsSync(approvalPath)) return { state: "missing", reason: "no approval record" };
  if (!safeFile(approvalPath)) return { state: "invalid", reason: "approval.json must be a regular non-symlink file" };
  const parsed = readJson(approvalPath);
  if (parsed.error) return { state: "invalid", reason: parsed.error };
  const contract = validatePlanApproval(parsed.value);
  const summary = {
    approved_by: typeof parsed.value?.approved_by === "string" ? parsed.value.approved_by : null,
    approved_at: typeof parsed.value?.approved_at === "string" ? parsed.value.approved_at : null,
    plan_commit: typeof parsed.value?.plan_commit === "string" ? parsed.value.plan_commit : null,
    plan_digest: typeof parsed.value?.plan_digest === "string" ? parsed.value.plan_digest : null,
  };
  if (!contract.valid) {
    return { state: "invalid", ...summary, reason: `approval record is invalid: ${contract.errors.map(({ path, message }) => `${path} ${message}`).join("; ")}` };
  }
  if (parsed.value.status === "superseded") {
    return { state: "superseded", ...summary, reason: parsed.value.superseded_reason ?? "approval was superseded" };
  }
  if (planBytes === null) return { state: "invalid", ...summary, reason: "plan.md is missing, so the approval binds nothing readable" };
  const verified = verifyPlanApproval({
    approval: parsed.value,
    plan_bytes: planBytes,
    change_id: changeId,
    plan_path: `changes/${changeId}/plan.md`,
  });
  if (!verified.verified) {
    const stale = verified.reason.includes("plan bytes changed");
    return { state: stale ? "stale" : "invalid", ...summary, reason: verified.reason };
  }
  const commit = verifyPlanCommit({
    projectRoot,
    docsBranch,
    commit: parsed.value.plan_commit,
    planRelativePath: `changes/${changeId}/plan.md`,
    planDigest: parsed.value.plan_digest,
  });
  if (!commit.ok) return { state: "invalid", ...summary, reason: commit.reason };
  return { state: "active", ...summary, reason: commit.reason };
}

function approvalHistorySnapshot(changePath) {
  const historyPath = join(changePath, "approval-history");
  const history = { total: 0, valid: 0, invalid: [] };
  if (!existsSync(historyPath)) return history;
  if (!safeDirectory(historyPath)) {
    history.invalid.push({ path: "approval-history", reason: "approval history must be a non-symlink directory" });
    return history;
  }
  for (const name of readdirSync(historyPath).filter((entry) => entry.endsWith(".json")).sort()) {
    history.total += 1;
    const path = join(historyPath, name);
    if (!safeFile(path)) { history.invalid.push({ path: name, reason: "history entry must be a non-symlink JSON file" }); continue; }
    const parsed = readJson(path);
    if (parsed.error) { history.invalid.push({ path: name, reason: parsed.error }); continue; }
    const contract = validatePlanApproval(parsed.value);
    if (!contract.valid) { history.invalid.push({ path: name, reason: "superseded approval record is invalid" }); continue; }
    if (parsed.value.status !== "superseded") { history.invalid.push({ path: name, reason: "approval history entry is not superseded" }); continue; }
    if (name !== `${parsed.value.plan_digest}.json`) { history.invalid.push({ path: name, reason: "approval history filename does not match its bound plan digest" }); continue; }
    history.valid += 1;
  }
  return history;
}

function groupSnapshot(id, group, { branchExists, attachedWorktrees }) {
  const worktree = String(group.worktree ?? "").replace(/^\.\//, "").replace(/\/+$/, "") || ".";
  return {
    group_id: id,
    status: group.status,
    branch: group.branch,
    branch_exists: branchExists.has(group.branch),
    worktree,
    worktree_attached: attachedWorktrees.has(worktree),
    implementation_commit: group.implementation_commit ?? null,
    tracker: group.tracker ?? null,
    pull_request: group.pull_request ?? null,
    review: { status: group.review?.status ?? "pending", high_findings: group.review?.high_findings ?? [] },
    validation: {
      status: group.validation?.status ?? "pending",
      commands: (group.validation?.commands ?? []).map((item) => ({
        command: item.command,
        cwd: item.cwd ?? ".",
        exit_code: item.exit_code ?? null,
        signal: item.signal ?? null,
        timed_out: item.timed_out === true,
        required: item.required !== false,
      })),
      deferred: group.validation?.deferred ?? [],
    },
  };
}

function runSnapshots(changePath, planDigest, context) {
  const runsPath = join(changePath, "runs");
  const runs = [];
  const skipped = [];
  if (!existsSync(runsPath)) return { runs, skipped };
  if (!safeDirectory(runsPath)) {
    skipped.push({ path: "runs", reason: "runs must be a non-symlink directory" });
    return { runs, skipped };
  }
  for (const name of readdirSync(runsPath).filter((entry) => entry.endsWith(".json")).sort()) {
    const phaseId = name.slice(0, -".json".length);
    const path = join(runsPath, name);
    if (!IDENTIFIER.test(phaseId)) { skipped.push({ path: `runs/${name}`, reason: "run record filename is not a safe phase id" }); continue; }
    if (!safeFile(path)) { skipped.push({ path: `runs/${name}`, reason: "run record must be a regular non-symlink file" }); continue; }
    const parsed = readJson(path);
    if (parsed.error) { runs.push({ phase_id: phaseId, valid: false, reason: parsed.error, groups: [] }); continue; }
    const contract = validateRunRecord(parsed.value);
    if (!contract.valid) {
      runs.push({ phase_id: phaseId, valid: false, reason: `run record is invalid: ${contract.errors.map(({ path: at, message }) => `${at} ${message}`).join("; ")}`, groups: [] });
      continue;
    }
    if (parsed.value.phase_id !== phaseId) {
      runs.push({ phase_id: phaseId, valid: false, reason: `run record declares phase ${parsed.value.phase_id} but is stored as ${name}`, groups: [] });
      continue;
    }
    runs.push({
      phase_id: phaseId,
      valid: true,
      status: parsed.value.status,
      started_at: parsed.value.started_at,
      completed_at: parsed.value.completed_at,
      base_branch: parsed.value.base_branch,
      base_commit: parsed.value.base_commit,
      plan_digest: parsed.value.plan_digest,
      plan_digest_matches: planDigest !== null && parsed.value.plan_digest === planDigest,
      groups: Object.entries(parsed.value.groups).map(([id, group]) => groupSnapshot(id, group, context)),
    });
  }
  return { runs, skipped };
}

function classify(snapshot) {
  const blocked = [];
  if (!snapshot.plan.present) return { state: "draft", next_skill: "adw:plan", blocked };
  if (snapshot.approval.state === "missing") return { state: "planned", next_skill: "adw:approve", blocked };
  if (snapshot.approval.state !== "active") {
    blocked.push(`approval is ${snapshot.approval.state}: ${snapshot.approval.reason}`);
    return { state: "planned", next_skill: "adw:amend", blocked };
  }
  for (const run of snapshot.runs) {
    if (run.valid && run.plan_digest_matches === false) blocked.push(`run record ${run.phase_id} was produced from different plan bytes`);
  }
  const invalid = snapshot.runs.filter((run) => !run.valid);
  if (invalid.length > 0) {
    for (const run of invalid) blocked.push(`run record ${run.phase_id} is unusable: ${run.reason}`);
    return { state: "invalid", next_skill: null, blocked };
  }
  if (snapshot.runs.length === 0) return { state: "approved", next_skill: "adw:execute", blocked };
  for (const run of snapshot.runs) {
    for (const group of run.groups) {
      if (group.review.status === "failed" || group.review.high_findings.length > 0) blocked.push(`${run.phase_id}/${group.group_id} has unresolved high-severity review findings`);
      if (group.validation.status === "failed") blocked.push(`${run.phase_id}/${group.group_id} failed required validation`);
      if (!group.branch_exists) blocked.push(`${run.phase_id}/${group.group_id} branch ${group.branch} no longer exists`);
    }
  }
  if (snapshot.runs.some((run) => run.status === "blocked")) return { state: "blocked", next_skill: "adw:amend", blocked };
  if (snapshot.runs.some((run) => run.status === "failed")) return { state: "execution-failed", next_skill: "adw:execute", blocked };
  if (snapshot.runs.some((run) => run.status === "running")) return { state: "executing", next_skill: "adw:execute", blocked };
  const delivered = snapshot.runs.some((run) => run.groups.some((group) => group.pull_request !== null));
  return { state: "validated", next_skill: delivered ? "adw:address-review" : null, blocked };
}

function changeSnapshot(changePath, changeId, context) {
  const planPath = join(changePath, "plan.md");
  let plan = { present: false, digest: null };
  let planBytes = null;
  if (existsSync(planPath)) {
    if (safeFile(planPath)) {
      planBytes = readFileSync(planPath);
      plan = { present: true, digest: computeDigest(planBytes) };
    } else {
      plan = { present: false, digest: null, reason: "plan.md must be a regular non-symlink file" };
    }
  }
  const approval = approvalSnapshot({ changePath, changeId, planBytes, projectRoot: context.projectRoot, docsBranch: context.docsBranch });
  const approvalHistory = approvalHistorySnapshot(changePath);
  const { runs, skipped } = runSnapshots(changePath, plan.digest, context);
  const snapshot = {
    change_id: changeId,
    artifacts: { plan: plan.present, approval: approval.state !== "missing", approval_history: approvalHistory.total, runs: runs.length },
    plan,
    approval,
    approval_history: approvalHistory,
    runs,
    skipped,
  };
  Object.assign(snapshot, classify(snapshot));
  return snapshot;
}

try {
  const { projectRoot } = parseArguments(process.argv.slice(2));
  const top = git(["rev-parse", "--show-toplevel"], projectRoot);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== projectRoot) throw new Error("project root must be the Git top level");

  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], projectRoot);
  const head = git(["rev-parse", "HEAD"], projectRoot);
  const porcelain = git(["status", "--porcelain=v1", "--untracked-files=all"], projectRoot);

  const configPath = join(projectRoot, "adw.yaml");
  let project = null;
  let config = { present: false, valid: false, digest: null, errors: [{ path: "/", message: "adw.yaml is missing; run adw:init-greenfield for an empty project or adw:init-brownfield for an established repository" }] };
  if (existsSync(configPath)) {
    try {
      const loaded = await loadProjectConfig({ project_root: projectRoot, path: "adw.yaml" });
      config = { present: true, valid: loaded.validation.valid, digest: loaded.digest, errors: loaded.validation.errors };
      if (loaded.validation.valid) project = loaded.data;
    } catch (error) {
      config = { present: true, valid: false, digest: null, errors: [{ path: "/", message: error.message }] };
    }
  }

  const docsRelativePath = project?.docs?.worktree ?? "worktrees/docs";
  const docsBranch = project?.docs?.branch ?? "docs";
  const baseBranch = project?.git?.base_branch ?? "main";
  const docsPath = join(projectRoot, docsRelativePath);
  const worktrees = worktreeRecords(projectRoot);
  const attachedWorktrees = new Set(worktrees.map((item) => {
    const rel = relative(projectRoot, resolve(item.worktree));
    return rel === "" ? "." : rel;
  }));
  const branchExists = new Set(
    git(["for-each-ref", "--format=%(refname:short)", "refs/heads"], projectRoot).stdout.split("\n").map((line) => line.trim()).filter(Boolean),
  );

  const changesPath = join(docsPath, "changes");
  const changes = [];
  const skippedChanges = [];
  if (safeDirectory(changesPath)) {
    for (const name of readdirSync(changesPath).sort()) {
      const entry = join(changesPath, name);
      if (!CHANGE_ID.test(name)) { skippedChanges.push({ name, reason: "change directory name is not a safe change id" }); continue; }
      const stat = lstatSync(entry);
      if (stat.isSymbolicLink()) { skippedChanges.push({ name, reason: "symlinked change entries are ignored, never followed" }); continue; }
      if (!stat.isDirectory()) { skippedChanges.push({ name, reason: "change entry is not a directory" }); continue; }
      changes.push(changeSnapshot(entry, name, { projectRoot, docsBranch, branchExists, attachedWorktrees }));
    }
  }

  const docsAttached = worktrees.some((item) => item.branch === `refs/heads/${docsBranch}` && resolve(item.worktree) === docsPath);
  const docsHead = existsSync(docsPath) ? git(["rev-parse", "HEAD"], docsPath) : { status: 1, stdout: "" };
  const docsDirty = existsSync(docsPath) ? git(["status", "--porcelain=v1", "--untracked-files=all"], docsPath) : { status: 1, stdout: "" };

  process.stdout.write(`${JSON.stringify({
    ok: true,
    read_only: true,
    project_root: projectRoot,
    config,
    code: {
      base_branch: baseBranch,
      branch: branch.status === 0 ? branch.stdout.trim() : null,
      head: head.status === 0 ? head.stdout.trim() : null,
      dirty: porcelain.status === 0 ? porcelain.stdout.trim().split("\n").filter(Boolean) : [],
    },
    docs: {
      attached: docsAttached,
      path: docsRelativePath,
      branch: docsBranch,
      head: docsHead.status === 0 ? docsHead.stdout.trim() : null,
      dirty: docsDirty.status === 0 ? docsDirty.stdout.trim().split("\n").filter(Boolean) : [],
    },
    execution: executionSnapshot(projectRoot, project),
    changes,
    skipped_changes: skippedChanges,
    pull_requests: { state: "not-queried", reason: "local snapshot does not access the network; query the configured code_host capability separately" },
  }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, read_only: true, error: error.message })}\n`);
  process.exitCode = 2;
}
