import assert from "node:assert/strict";
import test from "node:test";
import { validateArtifact } from "../../plugin/lib/adw-helper.mjs";

const sha = "a".repeat(40);

test("all four versioned artifact schemas accept representative values", async () => {
  const artifacts = {
    project: {
      schema: 1,
      git: { default_branch: "main" },
      documentation: { mode: "branch", branch: "docs", worktree: "worktrees/docs", sync_marker: "SYNC.yaml", delivery: "direct-push" },
      components: { api: { path: "services/api", validation: { test: [{ command: "npm test", source: "services/api/package.json", required: true }] } } },
      validation: { default: ["npm test"] }
    },
    plan: {
      schema: 1,
      change_id: "fix.api-v2",
      summary: "Fix API behavior",
      tasks: [{ id: 1, title: "Implement", description: "Update handler", affected_paths: ["src/api.mjs"], anchors: ["handle"], restrictions: ["no API break"], validation: [{ command: "npm test", cwd: ".", timeout_ms: 120000, required: true }] }],
      documentation: { impact: "update", files: ["README.md"] }
    },
    approval: { schema: 1, status: "active", approver: "Ada", approved_at: "2026-08-05T12:00:00Z", plugin_version: "0.1.0", docs_commit: sha, digest_algorithm: "sha256", digest: "b".repeat(64) },
    validation: { schema: 1, change_id: "fix-api", plugin_version: "0.1.0", code_commit: sha, docs_commit: sha, recorded_at: "2026-08-05T12:00:00Z", status: "passed", commands: [{ command: "npm test", cwd: ".", exit_code: 0, signal: null, timed_out: false, duration_ms: 5, summary: "ok", required: true }], deferred: [] }
  };
  for (const [kind, value] of Object.entries(artifacts)) assert.deepEqual(await validateArtifact(kind, value), { valid: true, errors: [] }, kind);
});

test("invalid values return actionable JSON pointers and contract-specific errors", async () => {
  const project = await validateArtifact("project", { schema: 1 });
  assert.equal(project.valid, false);
  assert(project.errors.some((error) => error.path === "/git" && error.keyword === "required"));

  const plan = await validateArtifact("plan", {
    schema: 1,
    change_id: "../escape",
    summary: "bad",
    tasks: [{ id: 2, title: "x", description: "x", affected_paths: ["../outside"], validation: [{ command: "test", cwd: "../outside", timeout_ms: 0, required: true }] }],
    documentation: { impact: "update", files: [] }
  });
  assert.equal(plan.valid, false);
  assert(plan.errors.some((error) => error.path === "/change_id"));
  assert(plan.errors.some((error) => error.path === "/tasks/0/affected_paths/0"));
  assert(plan.errors.some((error) => error.keyword === "sequence"));
  assert(plan.errors.some((error) => error.keyword === "documentation"));
});

test("approval lifecycle preserves superseded evidence and rejects ambiguous state", async () => {
  const base = { schema: 1, approver: "Ada", approved_at: "2026-08-05T12:00:00Z", plugin_version: "0.1.0", docs_commit: sha, digest_algorithm: "sha256", digest: "b".repeat(64) };
  assert.equal((await validateArtifact("approval", { ...base, status: "superseded", invalidated_at: "2026-08-05T13:00:00Z", invalidation_reason: "spec amended" })).valid, true);
  const ambiguous = await validateArtifact("approval", { ...base, status: "active", invalidated_at: "2026-08-05T13:00:00Z" });
  assert.equal(ambiguous.valid, false);
  assert.match(ambiguous.errors[0].message, /active approvals/);
});

test("validation status cannot conceal a required failure or required deferral", async () => {
  const invalid = await validateArtifact("validation", { schema: 1, change_id: "x", plugin_version: "0.1.0", code_commit: sha, docs_commit: sha, recorded_at: "2026-08-05T12:00:00Z", status: "passed", commands: [{ command: "npm test", cwd: ".", exit_code: 2, signal: null, timed_out: false, duration_ms: 2, summary: "failed", required: true }], deferred: [] });
  assert.equal(invalid.valid, false);
  assert(invalid.errors.some((error) => error.path === "/status"));
});
