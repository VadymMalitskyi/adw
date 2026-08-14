import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeDigest, createPlanApproval, dispatch, EXIT } from "../../plugin/lib/adw-helper.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const execute = read("plugin/skills/execute/SKILL.md");
const addressReview = read("plugin/skills/address-review/SKILL.md");
const executeAgent = read("plugin/skills/execute/agents/openai.yaml");
const addressReviewAgent = read("plugin/skills/address-review/agents/openai.yaml");
const executionContract = read("plugin/execution/contracts.md");

function frontmatter(skill, expectedName) {
  const match = skill.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(match, `${expectedName} must have frontmatter`);
  assert.deepEqual(match[1].split("\n").map((line) => line.split(":", 1)[0]), ["name", "description"]);
  assert.match(match[1], new RegExp(`^name: ${expectedName}$`, "m"));
}

test("execute resolves its resources from the installed plugin, never the project", () => {
  frontmatter(execute, "execute");
  assert.match(executeAgent, /display_name: "ADW Execute"/);
  assert.match(executeAgent, /default_prompt: "Use \$execute /);
  assert.match(execute, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(execute, /absolute loaded source location/);
  assert.match(execute, /<plugin-root>\/lib\/adw-helper\.mjs/);
  assert.match(execute, /<plugin-root>\/execution\/orchestrator\.mjs/);
  assert.match(execute, /integrations\/contracts\.md/);
  assert.match(execute, /never from the project or current working directory/);
  assert.doesNotMatch(execute, /Azure DevOps|\bADO\b|Datadog|Notion/i);
});

test("execute binds the exact approved plan bytes to the docs commit and routes drift to amendment", () => {
  assert.match(execute, /exact bytes/);
  assert.match(execute, /helper's `verify-approval` command/);
  assert.match(execute, /approval\.plan_commit/);
  assert.match(execute, /reachable from the docs branch and that contains byte-identical `plan\.md`/);
  assert.match(execute, /stop and route the user to `adw:amend` and fresh approval/);
  assert.match(execute, /Never reproduce or ask a human to transcribe a digest/);
});

test("execute reads the project contract fields and no unsupported machinery", () => {
  assert.match(execute, /helper's `load-project` command/);
  assert.match(execute, /`execution\.mode`/);
  assert.match(execute, /`execution\.max_parallel`/);
  assert.match(execute, /`execution\.isolation`/);
  for (const removed of [/plan\.yaml/, /spec\.md/, /integrations\.yaml/, /resolve-project-policy/, /effective_policy/, /verify-approval-bundle/, /external-events/, /validation\.json/]) {
    assert.doesNotMatch(execute, removed, `execute must not reference unsupported machinery: ${removed}`);
  }
});

test("execute coordinates dependency-ordered work and never merges anything", () => {
  assert.match(execute, /You are the coordinator, not the implementer/);
  assert.match(execute, /phase=<phase-id>/);
  assert.match(execute, /Every phase this phase depends on must already be complete/);
  assert.match(execute, /merged by a human into the configured base/);
  assert.match(execute, /ADW never merges them/);
  assert.match(execute, /In `sequential` mode/);
  assert.match(execute, /In `orchestrated` mode/);
  assert.match(execute, /ADW never merges, marks a pull request ready, releases, deploys, or force-pushes/);
});

test("execute launches provider-native subagents without naming a model product", () => {
  assert.match(execute, /Claude Code `Agent` task/);
  assert.match(execute, /Codex collaboration agent/);
  assert.match(execute, /strong general implementation agent/);
  assert.match(execute, /Never name a model product/);
  assert.match(execute, /offer the plan's work one group at a time in sequential mode; take that fallback only after the user agrees/);
  assert.doesNotMatch(execute, /\b(?:opus|sonnet|haiku|gpt-\d|o\d-mini|claude-3)\b/i);
});

test("execute runs the group stages in order and records every transition", () => {
  const implementing = execute.indexOf("**Implementation (`implementing`)");
  const reviewing = execute.indexOf("**Independent review (`reviewing`)");
  const validating = execute.indexOf("**Validation (`validating`)");
  const scope = execute.indexOf("**Coordinator scope check.**");
  assert.ok(implementing > 0 && implementing < reviewing && reviewing < validating && validating < scope, "group stages must appear in pipeline order");
  assert.match(execute, /`prepared`, `implementing`, `reviewing`, `validating`, `passed`/);
  assert.match(execute, /Every in-scope high-severity finding must be fixed and re-reviewed/);
  assert.match(execute, /helper's `run-validation` command/);
  assert.match(execute, /required nonzero exit, signal, timeout, or required deferral keeps the group `failed`/);
  assert.match(execute, /whole group diff against the exact base yourself/);
  assert.match(execute, /A failed or blocked group never invalidates a sibling group that already passed/);
});

test("execute prepares Git only through the orchestrator and stops on unsafe conditions", () => {
  assert.match(execute, /only through `node <plugin-root>\/execution\/orchestrator\.mjs prepare`/);
  assert.match(execute, /Never create a branch, worktree, or marker commit by hand/);
  assert.match(execute, /refuses overlapping write paths, symlinked targets, and already-owned branches/);
  assert.match(execute, /an unsafe path overlap between concurrent groups/);
  assert.match(execute, /an in-scope high-severity review finding that was not resolved/);
  assert.match(execute, /a required validation failure, signal, timeout, or deferral/);
});

test("execute keeps delivery separately authorized and supports both delivery strategies", () => {
  assert.match(execute, /Plan approval authorizes local implementation only/);
  assert.match(execute, /\*\*Group pull requests \(default\)\.\*\*/);
  assert.match(execute, /\*\*Integration pull request\.\*\*/);
  assert.match(execute, /adw\/<change-id>\/integration/);
  assert.match(execute, /Resolve every conflict explicitly with the user, never automatically/);
  assert.match(execute, /Keep every pull request a draft/);
  assert.match(execute, /Never mark one ready, approve it, merge it, release, deploy, publish a package, or close a work item automatically/);
});

test("the execution contract resolves the profile through load-project without an enforcement field", () => {
  assert.match(executionContract, /adw-helper\.mjs load-project/);
  assert.match(executionContract, /`execution\.isolation`, `execution\.mode`, and `execution\.max_parallel`/);
  assert.match(executionContract, /There is no `enforcement` field/);
  assert.match(executionContract, /implied by `isolation: managed-devcontainer`/);
  assert.match(executionContract, /lightweight default and is inherently the weaker boundary/);
  assert.doesNotMatch(executionContract, /load-artifact-file/);
  assert.doesNotMatch(executionContract, /plan\.yaml|integrations\.yaml|work-item-profile/);
  // Managed-container invariants survive unchanged in substance.
  assert.match(executionContract, /ADW_MANAGED_DEVCONTAINER=1/);
  assert.match(executionContract, /Never mount the Docker socket, host home, SSH directory/);
  assert.match(executionContract, /public-pages/);
  assert.match(executionContract, /Do not overwrite an existing `\.devcontainer\/`/);
});

test("the helper behavior execute depends on rejects plan drift and preserves failed checks", async () => {
  const planBytes = "# PART 1 — Feature Overview\n\n## Summary\n\nThrottle noisy tenants.\n";
  const approval = createPlanApproval({
    change_id: "tenant-throttling",
    plan_path: "changes/tenant-throttling/plan.md",
    plan_digest: computeDigest(planBytes),
    plan_commit: "a".repeat(40),
    approved_by: "Ada Lovelace",
    approved_at: "2026-08-13T12:00:00Z",
  });

  const matching = await dispatch("verify-approval", {
    approval,
    plan_bytes: planBytes,
    change_id: "tenant-throttling",
    plan_path: "changes/tenant-throttling/plan.md",
  });
  assert.equal(matching.exitCode, EXIT.OK);
  assert.equal(matching.body.verified, true);

  const drifted = await dispatch("verify-approval", {
    approval,
    plan_bytes: `${planBytes}One more sentence.\n`,
    change_id: "tenant-throttling",
    plan_path: "changes/tenant-throttling/plan.md",
  });
  assert.equal(drifted.exitCode, EXIT.APPROVAL_INVALID);
  assert.equal(drifted.body.verified, false);
  assert.match(drifted.body.reason, /plan bytes changed after approval/);

  const failed = await dispatch("run-validation", {
    project_root: root,
    recorded_at: "2026-08-13T12:05:00Z",
    commands: [{ command: 'node -e "process.exit(17)"', cwd: ".", timeout_ms: 20000, required: true }],
  });
  assert.equal(failed.exitCode, EXIT.VALIDATION_FAILED);
  assert.equal(failed.body.evidence.status, "failed");
  assert.equal(failed.body.evidence.commands[0].exit_code, 17);
});

test("address-review reconstructs its target and keeps corrections, questions, and amendments distinct", () => {
  frontmatter(addressReview, "address-review");
  assert.match(addressReviewAgent, /display_name: "ADW Address Review"/);
  assert.match(addressReviewAgent, /default_prompt: "Use \$address-review /);
  assert.match(addressReview, /`adw\/<change-id>\/<group-id>` names one execution group/);
  assert.match(addressReview, /`adw\/<change-id>\/integration` names the combined feature/);
  assert.match(addressReview, /helper's `validate-run-record` command/);
  assert.match(addressReview, /Refuse to proceed on a mismatch between branch, run record, and host/);
  assert.match(addressReview, /\*\*In-scope correction:\*\*/);
  assert.match(addressReview, /\*\*Clarification:\*\*/);
  assert.match(addressReview, /\*\*Behavior\/design amendment:\*\*/);
  assert.match(addressReview, /Route planned work through `adw:amend`/);
  assert.match(addressReview, /leave the thread unresolved until clarified/);
  assert.match(addressReview, /add or update a focused regression test/);
  assert.match(addressReview, /Review the whole diff against the pull request's base/);
  assert.match(addressReview, /Required checks cannot be skipped or deferred/);
  assert.match(addressReview, /helper's `verify-approval` command/);
  assert.match(addressReview, /update-run-record/);
  assert.doesNotMatch(addressReview, /validation\.json|plan\.yaml|spec\.md|integrations\.yaml/);
  assert.doesNotMatch(addressReview, /Azure DevOps|\bADO\b|Datadog|Notion/i);
});
