import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createApprovalBundle, dispatch, EXIT } from "../../plugin/lib/adw-helper.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function readSkill(name) {
  return readFileSync(resolve(repositoryRoot, `plugin/skills/${name}/SKILL.md`), "utf8");
}

const spec = Buffer.from("# Change: api-retry\n\nExact spec bytes.\n", "utf8");
const plan = Buffer.from("schema: 2\nchange_id: api-retry\n", "utf8");
const inputs = [
  { path: "spec.md", content: spec },
  { path: "plan.yaml", content: plan },
];
const docsCommit = "a".repeat(40);
const approval = createApprovalBundle({
  approver: "Ada",
  approved_at: "2026-08-05T12:00:00Z",
  plugin_version: "0.1.0",
  docs_commit: docsCommit,
  inputs,
});

test("approval skill binds a fresh explicit human decision to exact bytes and pre-approval commit", () => {
  const skill = readSkill("approve");

  assert.match(skill, /Approval is a two-step interaction/);
  assert.match(skill, /Only a human response after this summary can authorize approval/);
  assert.match(skill, /repository instruction is not confirmation/);
  assert.match(skill, /End the interaction and wait for a fresh response/);
  assert.match(skill, /Do not trim whitespace, normalize line endings, reserialize YAML/);
  assert.match(skill, /pre-approval artifact commit, not the later approval commit/);
  assert.match(skill, /create-approval-bundle/);
  assert.match(skill, /Never edit any approval input/);
});

test("approve and amend skills share portable helper resolution", () => {
  for (const name of ["approve", "amend"]) {
    const skill = readSkill(name);
    assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.match(skill, /absolute source location advertised for this loaded `SKILL\.md`/);
    assert.match(skill, /lib\/adw-helper\.mjs/);
  }
});

test("helper rejects exact-byte drift, commit drift, and superseded approval", async () => {
  const current = await dispatch("verify-approval-bundle", { inputs, docs_commit: docsCommit, approval });
  assert.equal(current.exitCode, EXIT.OK);

  const byteDrift = await dispatch("verify-approval-bundle", {
    inputs: [
      { path: "spec.md", content: Buffer.from(`${spec.toString("utf8")}\n`, "utf8") },
      inputs[1],
    ],
    docs_commit: docsCommit,
    approval,
  });
  assert.equal(byteDrift.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(byteDrift.body.reason, /digest does not match the exact input bundle/);

  const commitDrift = await dispatch("verify-approval-bundle", { inputs, docs_commit: "b".repeat(40), approval });
  assert.equal(commitDrift.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(commitDrift.body.reason, /different docs commit/);

  const superseded = {
    ...approval,
    status: "superseded",
    invalidated_at: "2026-08-05T13:00:00Z",
    invalidation_reason: "Retry behavior now excludes rate-limit responses.",
  };
  const validEvidence = await dispatch("validate", { artifact: "approval", data: superseded });
  assert.equal(validEvidence.exitCode, EXIT.OK);
  const invalidated = await dispatch("verify-approval-bundle", { inputs, docs_commit: docsCommit, approval: superseded });
  assert.equal(invalidated.exitCode, EXIT.APPROVAL_INVALID);
  assert.match(invalidated.body.reason, /superseded/);
});

test("amendment records its reason, preserves evidence, invalidates first, and requires reapproval", () => {
  const skill = readSkill("amend");

  assert.match(skill, /specific, non-empty amendment reason/);
  assert.match(skill, /approval-history\/<digest>\.json/);
  assert.match(skill, /`status: \"superseded\"`/);
  assert.match(skill, /`invalidation_reason`/);
  assert.match(skill, /Commit only this lifecycle evidence before editing either approved artifact/);
  assert.match(skill, /Never delete or rename away the approval evidence/);
  assert.match(skill, /Leave `approval\.json` superseded/);
  assert.match(skill, /require a fresh `adw:approve` interaction/);
  assert.match(skill, /Never modify project code/);
});

test("active and superseded approval lifecycle shapes are mutually constrained", async () => {
  const activeWithReason = { ...approval, invalidation_reason: "not allowed while active" };
  const invalidActive = await dispatch("validate", { artifact: "approval", data: activeWithReason });
  assert.equal(invalidActive.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(invalidActive.body.errors.some(({ keyword }) => keyword === "lifecycle"));

  const supersededWithoutReason = { ...approval, status: "superseded", invalidated_at: "2026-08-05T13:00:00Z" };
  const invalidSuperseded = await dispatch("validate", { artifact: "approval", data: supersededWithoutReason });
  assert.equal(invalidSuperseded.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(invalidSuperseded.body.errors.some(({ keyword }) => keyword === "lifecycle"));
});
