import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createApproval, dispatch, EXIT } from "../../plugin/lib/adw-helper.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const execute = read("plugin/skills/execute/SKILL.md");
const addressReview = read("plugin/skills/address-review/SKILL.md");
const executeAgent = read("plugin/skills/execute/agents/openai.yaml");
const addressReviewAgent = read("plugin/skills/address-review/agents/openai.yaml");

function frontmatter(skill, expectedName) {
  const match = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${expectedName} must have frontmatter`);
  assert.deepEqual(match[1].split("\n").map((line) => line.split(":", 1)[0]), ["name", "description"]);
  assert.match(match[1], new RegExp(`^name: ${expectedName}$`, "m"));
}

test("execute binds exact approved bytes to the pre-approval docs commit", () => {
  frontmatter(execute, "execute");
  assert.match(executeAgent, /display_name: "ADW Execute"/);
  assert.match(executeAgent, /default_prompt: "Use \$execute /);
  assert.match(execute, /exact raw bytes/);
  assert.match(execute, /pre-approval artifact commit, not the approval commit or current docs `HEAD`/);
  assert.match(execute, /verify-approval/);
  assert.match(execute, /approval\.docs_commit/);
  assert.match(execute, /Any byte change, missing approval, superseded approval/);
});

test("execute is one-agent sequential execution with guarded paths and commands", () => {
  assert.match(execute, /one agent working sequentially on one feature branch/);
  assert.match(execute, /For each plan task in numeric order/);
  assert.match(execute, /Add or update focused tests/);
  assert.match(execute, /review the complete feature-branch diff against the exact base/);
  assert.match(execute, /Reject absolute paths, `\.\.`.*symlink escapes/s);
  assert.match(execute, /Missing required commands are blockers, never implicit deferrals/);
  assert.match(execute, /stop and route the discovery through `adw:amend`/);
  assert.doesNotMatch(execute, /Azure DevOps|Notion/i);
  assert.match(execute, /Never create per-task worktrees, parallel implementation branches, integration branches, tickets, or multiple pull requests/);
});

test("the helper behavior required by execute rejects drift and preserves failed checks", async () => {
  const commit = "a".repeat(40);
  const approval = createApproval({
    approver: "Ada",
    approved_at: "2026-08-05T12:00:00Z",
    plugin_version: "0.1.0",
    docs_commit: commit,
    spec: "approved spec\n",
    plan: "approved plan\n",
  });
  const stale = await dispatch("verify-approval", {
    spec: "changed spec\n",
    plan: "approved plan\n",
    docs_commit: approval.docs_commit,
    approval,
  });
  assert.equal(stale.exitCode, EXIT.APPROVAL_INVALID);
  assert.equal(stale.body.verified, false);

  const failed = await dispatch("run-validation", {
    project_root: root,
    change_id: "execute-contract",
    plugin_version: "0.1.0",
    code_commit: commit,
    docs_commit: commit,
    recorded_at: "2026-08-05T12:00:00Z",
    commands: [{ command: 'node -e "process.exit(17)"', cwd: ".", timeout_ms: 5000, required: true }],
  });
  assert.equal(failed.exitCode, EXIT.VALIDATION_FAILED);
  assert.equal(failed.body.evidence.status, "failed");
  assert.equal(failed.body.evidence.commands[0].exit_code, 17);
});

test("execute records honest helper evidence and gates draft delivery", () => {
  assert.match(execute, /helper's `run-validation` command/);
  assert.match(execute, /Capture the helper JSON even when it exits with `VALIDATION_FAILED`/);
  assert.match(execute, /validation\.json/);
  assert.match(execute, /Update every code-coupled documentation file/);
  assert.match(execute, /required deferral keeps status `failed`/);
  assert.match(execute, /only when the user explicitly authorizes/);
  assert.match(execute, /one draft GitHub pull request/);
  assert.match(execute, /never mark it ready, approve it, merge it, release it, or deploy it/);
  assert.match(execute, /never force-push/i);
});

test("address-review keeps corrections, questions, and amendments distinct", () => {
  frontmatter(addressReview, "address-review");
  assert.match(addressReviewAgent, /display_name: "ADW Address Review"/);
  assert.match(addressReviewAgent, /default_prompt: "Use \$address-review /);
  assert.match(addressReview, /\*\*In-scope correction:\*\*/);
  assert.match(addressReview, /\*\*Clarification:\*\*/);
  assert.match(addressReview, /\*\*Behavior\/design amendment:\*\*/);
  assert.match(addressReview, /Route planned work through `adw:amend`/);
  assert.match(addressReview, /leave the thread unresolved until clarified/);
  assert.match(addressReview, /add or update a focused regression test/);
  assert.match(addressReview, /Review the whole PR diff against its base/);
  assert.match(addressReview, /Required checks cannot be skipped or deferred/);
});
