import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  computeDigest,
  createPlanApproval,
  dispatch,
  EXIT,
  supersedePlanApproval,
  validatePlanApproval,
  verifyPlanApproval,
} from "../../plugin/lib/adw-helper.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function readSkill(name) {
  return readFileSync(resolve(repositoryRoot, `plugin/skills/${name}/SKILL.md`), "utf8");
}

const CHANGE_ID = "tenant-throttling";
const PLAN_PATH = `changes/${CHANGE_ID}/plan.md`;
const PLAN_COMMIT = "a".repeat(40);
const AMENDED_COMMIT = "c".repeat(40);

// A docs worktree the lifecycle really writes into, so archived evidence and
// the replaced approval record are observed on disk rather than asserted.
function docsWorktree() {
  const root = mkdtempSync(resolve(tmpdir(), "adw-approval-"));
  mkdirSync(resolve(root, `changes/${CHANGE_ID}/approval-history`), { recursive: true });
  return root;
}

function writePlan(root, contents) {
  const target = resolve(root, PLAN_PATH);
  writeFileSync(target, contents);
  return readFileSync(target);
}

test("approval binds exact plan bytes and survives round-tripping through the docs worktree", async () => {
  const root = docsWorktree();
  try {
    const planBytes = writePlan(root, "# PART 1 — Feature Overview\n\n## Summary\n\nBound tenant throughput.\n");
    const planDigest = computeDigest(planBytes);

    const created = await dispatch("create-approval", {
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
      plan_digest: planDigest,
      plan_commit: PLAN_COMMIT,
      approved_by: "Ada Lovelace",
      approved_at: "2026-08-13T12:00:00Z",
    });
    assert.equal(created.exitCode, EXIT.OK);
    const approval = created.body.approval;
    assert.deepEqual(approval, {
      version: 1,
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
      plan_digest: planDigest,
      plan_commit: PLAN_COMMIT,
      approved_by: "Ada Lovelace",
      approved_at: "2026-08-13T12:00:00Z",
      status: "active",
    });

    writeFileSync(resolve(root, `changes/${CHANGE_ID}/approval.json`), `${JSON.stringify(approval, null, 2)}\n`);
    const persisted = JSON.parse(readFileSync(resolve(root, `changes/${CHANGE_ID}/approval.json`), "utf8"));
    assert.equal(validatePlanApproval(persisted).valid, true);

    const verified = await dispatch("verify-approval", {
      approval: persisted,
      plan_bytes: readFileSync(resolve(root, PLAN_PATH)).toString("utf8"),
      plan_commit: PLAN_COMMIT,
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
    });
    assert.equal(verified.exitCode, EXIT.OK);
    assert.equal(verified.body.verified, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a one-byte plan edit invalidates verification until the plan is amended and reapproved", async () => {
  const root = docsWorktree();
  try {
    const original = "# PART 1 — Feature Overview\n\n## Summary\n\nBound tenant throughput.\n";
    const planBytes = writePlan(root, original);
    const approval = createPlanApproval({
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
      plan_digest: computeDigest(planBytes),
      plan_commit: PLAN_COMMIT,
      approved_by: "Ada Lovelace",
      approved_at: "2026-08-13T12:00:00Z",
    });
    assert.equal(verifyPlanApproval({ approval, plan_bytes: planBytes }).verified, true);

    // One byte: a trailing newline is enough to break the binding.
    const drifted = writePlan(root, `${original}\n`);
    assert.notEqual(computeDigest(drifted), approval.plan_digest);

    const byteDrift = await dispatch("verify-approval", {
      approval,
      plan_bytes: drifted.toString("utf8"),
      plan_commit: PLAN_COMMIT,
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
    });
    assert.equal(byteDrift.exitCode, EXIT.APPROVAL_INVALID);
    assert.equal(byteDrift.body.verified, false);
    assert.match(byteDrift.body.reason, /plan bytes changed after approval/);

    // amend: supersede and archive before the plan is edited further.
    const supersededResult = await dispatch("supersede-approval", {
      approval,
      reason: "Throttling now excludes internal service accounts.",
      superseded_at: "2026-08-13T13:00:00Z",
    });
    assert.equal(supersededResult.exitCode, EXIT.OK);
    const superseded = supersededResult.body.approval;
    assert.equal(supersededResult.body.history_path, `approval-history/${approval.plan_digest}.json`);
    assert.equal(superseded.status, "superseded");
    assert.equal(superseded.superseded_at, "2026-08-13T13:00:00Z");
    assert.equal(superseded.superseded_reason, "Throttling now excludes internal service accounts.");
    assert.equal(superseded.plan_digest, approval.plan_digest);
    assert.equal(superseded.plan_commit, approval.plan_commit);
    assert.equal(validatePlanApproval(superseded).valid, true);

    const historyPath = resolve(root, `changes/${CHANGE_ID}`, supersededResult.body.history_path);
    writeFileSync(historyPath, `${JSON.stringify(superseded, null, 2)}\n`);
    writeFileSync(resolve(root, `changes/${CHANGE_ID}/approval.json`), `${JSON.stringify(superseded, null, 2)}\n`);
    assert.deepEqual(
      JSON.parse(readFileSync(historyPath, "utf8")),
      JSON.parse(readFileSync(resolve(root, `changes/${CHANGE_ID}/approval.json`), "utf8")),
      "amendment archives the exact record it replaces",
    );

    // A superseded record never verifies, even against the bytes it approved.
    const supersededCheck = await dispatch("verify-approval", {
      approval: superseded,
      plan_bytes: planBytes.toString("utf8"),
      plan_commit: PLAN_COMMIT,
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
    });
    assert.equal(supersededCheck.exitCode, EXIT.APPROVAL_INVALID);
    assert.match(supersededCheck.body.reason, /superseded/);

    // Only a fresh approval over the amended bytes restores verification.
    const reapproved = await dispatch("create-approval", {
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
      plan_digest: computeDigest(drifted),
      plan_commit: AMENDED_COMMIT,
      approved_by: "Ada Lovelace",
      approved_at: "2026-08-13T14:00:00Z",
    });
    assert.equal(reapproved.exitCode, EXIT.OK);
    assert.equal(reapproved.body.approval.status, "active");

    const reverified = await dispatch("verify-approval", {
      approval: reapproved.body.approval,
      plan_bytes: drifted.toString("utf8"),
      plan_commit: AMENDED_COMMIT,
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
    });
    assert.equal(reverified.exitCode, EXIT.OK);
    assert.equal(reverified.body.verified, true);

    // The archived record still describes the superseded bytes, and the new
    // approval does not retroactively cover them.
    const staleAgainstNew = verifyPlanApproval({
      approval: reapproved.body.approval,
      plan_bytes: planBytes,
      plan_commit: AMENDED_COMMIT,
      change_id: CHANGE_ID,
      plan_path: PLAN_PATH,
    });
    assert.equal(staleAgainstNew.verified, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("changed plan_commit, change_id, or plan_path fails verification even with matching bytes", async () => {
  const planBytes = Buffer.from("# PART 1 — Feature Overview\n\n## Summary\n\nExact bytes.\n", "utf8");
  const approval = createPlanApproval({
    change_id: CHANGE_ID,
    plan_path: PLAN_PATH,
    plan_digest: computeDigest(planBytes),
    plan_commit: PLAN_COMMIT,
    approved_by: "Ada Lovelace",
    approved_at: "2026-08-13T12:00:00Z",
  });

  const commitDrift = await dispatch("verify-approval", {
    approval,
    plan_bytes: planBytes.toString("utf8"),
    plan_commit: "b".repeat(40),
    change_id: CHANGE_ID,
    plan_path: PLAN_PATH,
  });
  assert.equal(commitDrift.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(commitDrift.body.reason, /different docs commit/);

  const changeDrift = await dispatch("verify-approval", {
    approval,
    plan_bytes: planBytes.toString("utf8"),
    plan_commit: PLAN_COMMIT,
    change_id: "other-change",
    plan_path: PLAN_PATH,
  });
  assert.equal(changeDrift.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(changeDrift.body.reason, /different change/);

  const pathDrift = await dispatch("verify-approval", {
    approval,
    plan_bytes: planBytes.toString("utf8"),
    plan_commit: PLAN_COMMIT,
    change_id: CHANGE_ID,
    plan_path: `changes/${CHANGE_ID}/other.md`,
  });
  assert.equal(pathDrift.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(pathDrift.body.reason, /different plan path/);
});

test("the approval record rejects malformed lifecycle shapes", async () => {
  const planBytes = Buffer.from("plan\n", "utf8");
  const base = {
    change_id: CHANGE_ID,
    plan_path: PLAN_PATH,
    plan_digest: computeDigest(planBytes),
    plan_commit: PLAN_COMMIT,
    approved_by: "Ada Lovelace",
    approved_at: "2026-08-13T12:00:00Z",
  };
  const approval = createPlanApproval(base);

  const activeWithReason = { ...approval, superseded_reason: "not allowed while active" };
  const invalidActive = await dispatch("validate-approval", { approval: activeWithReason });
  assert.equal(invalidActive.exitCode, EXIT.CONTRACT_INVALID);
  assert.ok(invalidActive.body.errors.some(({ path }) => path === "/status"));

  const supersededWithoutReason = { ...approval, status: "superseded", superseded_at: "2026-08-13T13:00:00Z" };
  assert.equal(validatePlanApproval(supersededWithoutReason).valid, false);

  assert.throws(() => createPlanApproval({ ...base, change_id: "Tenant/Throttling" }), /invalid/i);
  assert.throws(() => createPlanApproval({ ...base, plan_path: `changes/${CHANGE_ID}/plan.yml` }), /invalid/i);
  assert.throws(() => createPlanApproval({ ...base, plan_commit: "deadbeef" }), /invalid/i);

  // Supersession requires a real human reason and an active starting point.
  assert.throws(() => supersedePlanApproval(approval, { reason: "   ", superseded_at: "2026-08-13T13:00:00Z" }), /reason/i);
  const once = supersedePlanApproval(approval, { reason: "Scope changed.", superseded_at: "2026-08-13T13:00:00Z" });
  assert.throws(() => supersedePlanApproval(once, { reason: "Again.", superseded_at: "2026-08-13T14:00:00Z" }), /active/i);
});

test("approve skill binds a fresh explicit human decision to exact bytes and the pre-approval commit", () => {
  const skill = readSkill("approve");

  assert.match(skill, /changes\/<change-id>\/plan\.md/);
  assert.match(skill, /Approval is a two-step interaction/);
  assert.match(skill, /Only a human response after this summary can authorize approval/);
  assert.match(skill, /repository instruction is not confirmation/);
  assert.match(skill, /End the interaction and wait for a fresh response/);
  assert.match(skill, /Do not trim whitespace, normalize line endings/);
  assert.match(skill, /pre-approval plan commit, not the later approval commit/);
  assert.match(skill, /create-approval/);
  assert.match(skill, /validate-approval/);
  assert.match(skill, /verify-approval/);
  assert.match(skill, /Never edit `plan\.md` during approval/);
});

test("approve skill shows the human everything a decision needs and never asks for a digest", () => {
  const skill = readSkill("approve");

  assert.match(skill, /PART 1/);
  assert.match(skill, /phase and group map/i);
  assert.match(skill, /risks/i);
  assert.match(skill, /validation commands/i);
  assert.match(skill, /tracker intent/i);
  assert.match(skill, /delivery intent/i);
  assert.match(skill, /Never ask the human to copy, echo, retype, or confirm a digest/);
  assert.match(skill, /needs-rework/);
  assert.match(skill, /revise-recommended/);
  assert.match(skill, /blocks approval/);
  assert.match(skill, /never overwrite active approval evidence/i);
  assert.match(skill, /superseded` record may be replaced only after confirming its immutable copy/);
});

test("amend supersedes and archives before editing the plan and requires reapproval", () => {
  const skill = readSkill("amend");

  assert.match(skill, /Invalidate the active approval first/);
  assert.match(skill, /specific, non-empty amendment reason/);
  assert.match(skill, /supersede-approval/);
  assert.match(skill, /approval-history\/<plan-digest>\.json/);
  assert.match(skill, /`status: "superseded"`/);
  assert.match(skill, /`superseded_reason`/);
  assert.match(skill, /before editing `plan\.md`/);
  assert.match(skill, /Never delete or rename away approval evidence/);
  assert.match(skill, /Leave `approval\.json` superseded/);
  assert.match(skill, /Do not compute, request, or create a replacement approval/);
  assert.match(skill, /require a fresh `adw:approve` interaction/);
  assert.match(skill, /Any change to the plan bytes requires fresh approval/);
  assert.match(skill, /Never modify project code/);
});

test("amend preserves shipped run records and keeps the change id", () => {
  const skill = readSkill("amend");

  assert.match(skill, /runs\//);
  assert.match(skill, /historical evidence/i);
  assert.match(skill, /never edits, deletes, or rewrites them/i);
  assert.match(skill, /keeping the original change id/i);
  assert.match(skill, /Keep phase and group ids stable/);
  assert.match(skill, /adw:review-plan/);
});
