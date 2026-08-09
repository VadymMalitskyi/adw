import assert from "node:assert/strict";
import test from "node:test";
import {
  computePolicyDigest,
  resolveProjectPolicy,
  resolveValidationSet,
  validateArtifact,
  validateWorkItemPayload,
} from "../../plugin/lib/adw-helper.mjs";

function profile() {
  return {
    schema: 1,
    id: "feature-story",
    provider: "azure-devops",
    object_type: "User Story",
    required_fields: ["System.Title", "System.Description"],
    allowed_fields: ["Custom.Risk"],
    defaults: { "System.AreaPath": "Platform\\Payments", "System.Tags": ["adw"] },
    requirement_fields: ["System.Title", "System.Description"],
  };
}

function project() {
  return {
    schema: 5,
    git: { default_branch: "main" },
    documentation: { mode: "branch", branch: "docs", worktree: "worktrees/docs", sync_marker: "SYNC.yaml", delivery: "direct-push" },
    execution: { isolation: "provider-sandbox", enforcement: "preferred", permissions: { profile: "managed-development" } },
    components: {
      app: { path: ".", validation: { default: [{ command: "npm test", source: "package.json#scripts.test", required: false }] } },
      payments: { path: "services/payments", validation: { default: [
        { command: "npm test", source: "package.json#scripts.test", required: true },
        { command: "npm run build:payments", source: "package.json#scripts.build:payments", required: true },
      ] } },
    },
    validation: { default: [{ command: "npm run lint", source: "package.json#scripts.lint", required: true }] },
    integrations: { work_tracker: { provider: "azure-devops", requirement: "required", access: "read-write" } },
    workflows: { work_tracker: { binding: "required", ensure: "create-or-link", stage: "plan", cardinality: "one-per-change", profile: "adw/work-items/feature-story.yaml" } },
  };
}

test("project schema 5 and work-item profiles validate explicit workflow policy", async () => {
  assert.deepEqual(await validateArtifact("project", project()), { valid: true, errors: [] });
  assert.deepEqual(await validateArtifact("work-item-profile", profile()), { valid: true, errors: [] });

  const missingCapability = project();
  delete missingCapability.integrations.work_tracker;
  const invalidCapability = await validateArtifact("project", missingCapability);
  assert.equal(invalidCapability.valid, false);
  assert(invalidCapability.errors.some(({ path, keyword }) => path === "/workflows/work_tracker" && keyword === "capability"));

  const missingProfile = project();
  delete missingProfile.workflows.work_tracker.profile;
  const invalidProfile = await validateArtifact("project", missingProfile);
  assert.equal(invalidProfile.valid, false);
  assert(invalidProfile.errors.some(({ path }) => path === "/workflows/work_tracker/profile"));

  const missingChildProfile = project();
  missingChildProfile.workflows.work_tracker.cardinality = "one-parent-plus-plan-tasks";
  const invalidChildProfile = await validateArtifact("project", missingChildProfile);
  assert.equal(invalidChildProfile.valid, false);
  assert(invalidChildProfile.errors.some(({ path }) => path === "/workflows/work_tracker/child_profile"));
});

test("effective policy selects the most-specific component and additive validation", () => {
  const profiles = { "adw/work-items/feature-story.yaml": profile() };
  const policy = resolveProjectPolicy({ project: project(), affected_paths: ["services/payments/src/retry.ts"], profiles });

  assert.deepEqual(policy.components, ["payments"]);
  assert.deepEqual(policy.unowned_paths, []);
  assert.deepEqual(policy.required_validation.map(({ command, required }) => [command, required]), [
    ["npm run lint", true],
    ["npm test", true],
    ["npm run build:payments", true],
  ]);
  assert.equal(policy.required_validation.find(({ command }) => command === "npm run build:payments").cwd, "services/payments");
  assert.equal(policy.work_tracker.profile_digest, computePolicyDigest(profile()));
  assert.match(policy.project_policy_digest, /^[0-9a-f]{64}$/);

  const unrelated = project();
  unrelated.integrations.knowledge = { provider: "notion", requirement: "optional" };
  assert.equal(resolveProjectPolicy({ project: unrelated, affected_paths: ["services/payments/src/retry.ts"], profiles }).project_policy_digest, policy.project_policy_digest);
});

test("effective policy rejects previous project schemas", async () => {
  const previous = project();
  previous.schema = 4;
  assert.equal((await validateArtifact("project", previous)).valid, false);
  assert.throws(() => resolveProjectPolicy({ project: previous, affected_paths: ["services/payments/src/retry.ts"], profiles: {} }), /requires project schema 5/);
});

test("effective policy rejects ambiguous ownership and profile/provider drift", () => {
  const ambiguous = project();
  ambiguous.components.duplicate = { path: "services/payments" };
  assert.throws(() => resolveProjectPolicy({ project: ambiguous, affected_paths: ["services/payments/a.ts"], profiles: { "adw/work-items/feature-story.yaml": profile() } }), /ambiguous component ownership/);

  const wrongProvider = profile();
  wrongProvider.provider = "github";
  assert.throws(() => resolveProjectPolicy({ project: project(), affected_paths: ["services/payments/a.ts"], profiles: { "adw/work-items/feature-story.yaml": wrongProvider } }), /provider must match/);
});

test("effective policy reports paths outside configured component ownership", () => {
  const scoped = project();
  delete scoped.components.app;
  const policy = resolveProjectPolicy({ project: scoped, affected_paths: ["README.md"], profiles: { "adw/work-items/feature-story.yaml": profile() } });
  assert.deepEqual(policy.components, []);
  assert.deepEqual(policy.unowned_paths, ["README.md"]);
  assert.equal(policy.required_validation[0].command, "npm run lint");
});

test("work-item payload profiles apply defaults and reject missing or unknown fields", () => {
  const valid = validateWorkItemPayload(profile(), {
    provider: "azure-devops",
    object_type: "User Story",
    fields: { "System.Title": "Retry payments", "System.Description": "Add bounded retries", "Custom.Risk": "medium" },
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.normalized.fields["System.AreaPath"], "Platform\\Payments");

  const missing = validateWorkItemPayload(profile(), { provider: "azure-devops", object_type: "User Story", fields: { "System.Title": "Retry" } });
  assert.equal(missing.valid, false);
  assert(missing.errors.some((error) => error.includes("System.Description")));

  const unknown = validateWorkItemPayload(profile(), { provider: "azure-devops", object_type: "User Story", fields: { "System.Title": "Retry", "System.Description": "x", "Custom.Secret": "no" } });
  assert.equal(unknown.valid, false);
  assert(unknown.errors.some((error) => error.includes("not allowed")));
});

test("execution validation deterministically combines policy and task checks", () => {
  const commands = resolveValidationSet({
    effective_policy: { required_validation: [{ command: "npm test", cwd: ".", timeout_ms: 120000, required: false, source: "adw.yaml" }] },
    tasks: [{ id: 1, validation: [
      { command: "npm test", cwd: ".", timeout_ms: 60000, required: true, source: "package.json#scripts.test" },
      { command: "npm run build", cwd: ".", timeout_ms: 120000, required: true, source: "package.json#scripts.build" },
    ] }],
  });
  assert.deepEqual(commands.map(({ command, required, timeout_ms }) => [command, required, timeout_ms]), [
    ["npm test", true, 60000],
    ["npm run build", true, 120000],
  ]);
});

test("plan schema 2 requires a digest-bound effective policy and sourced validation", async () => {
  const policy = resolveProjectPolicy({ project: project(), affected_paths: ["services/payments/a.ts"], profiles: { "adw/work-items/feature-story.yaml": profile() } });
  const plan = {
    schema: 2,
    change_id: "payments-retry",
    summary: "Retry payments",
    effective_policy: policy,
    tasks: [{
      id: 1,
      title: "Implement retry",
      description: "Add bounded retry behavior",
      affected_paths: ["services/payments/a.ts"],
      validation: [{ command: "npm test", cwd: ".", timeout_ms: 120000, required: true, source: "package.json#scripts.test" }],
    }],
    documentation: { impact: "none", files: [] },
  };
  assert.deepEqual(await validateArtifact("plan", plan), { valid: true, errors: [] });
  delete plan.tasks[0].validation[0].source;
  assert.equal((await validateArtifact("plan", plan)).valid, false);
});
