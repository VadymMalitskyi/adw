import assert from "node:assert/strict";
import test from "node:test";
import { validateArtifact } from "../../plugin/lib/adw-helper.mjs";

const sha = "a".repeat(40);

test("previous project, plan, and approval schemas are rejected", async () => {
  for (const version of [1, 2, 3, 4]) assert.equal((await validateArtifact("project", { schema: version })).valid, false, `project ${version}`);
  assert.equal((await validateArtifact("plan", { schema: 1 })).valid, false);
  assert.equal((await validateArtifact("approval", { schema: 1 })).valid, false);
});

test("project schema v5 supports optional provider-neutral capability configuration", async () => {
  const base = {
    schema: 5,
    git: { default_branch: "main" },
    documentation: { mode: "branch", branch: "docs", worktree: "worktrees/docs", sync_marker: "SYNC.yaml", delivery: "direct-push" },
    execution: { isolation: "provider-sandbox", enforcement: "preferred", permissions: { profile: "managed-development" } },
    components: {},
    validation: { default: ["npm test"] },
  };

  assert.deepEqual(await validateArtifact("project", base), { valid: true, errors: [] });
  const publicPages = structuredClone(base);
  publicPages.execution.web_access = "public-pages";
  assert.deepEqual(await validateArtifact("project", publicPages), { valid: true, errors: [] });
  const selectedRuntime = structuredClone(base);
  selectedRuntime.development = { runtime_versions: { dotnet: "8", node: "22.1.0" } };
  assert.deepEqual(await validateArtifact("project", selectedRuntime), { valid: true, errors: [] });
  const invalidRuntime = structuredClone(selectedRuntime);
  invalidRuntime.development.runtime_versions.dotnet = "latest";
  assert.ok((await validateArtifact("project", invalidRuntime)).errors.some(({ path, keyword }) => path === "/development/runtime_versions/dotnet" && keyword === "pattern"));
  const unknownRuntime = structuredClone(selectedRuntime);
  unknownRuntime.development.runtime_versions.php = "8.4";
  assert.ok((await validateArtifact("project", unknownRuntime)).errors.some(({ path, keyword }) => path === "/development/runtime_versions/php" && keyword === "additionalProperties"));
  const pullRequestDelivery = structuredClone(base);
  pullRequestDelivery.documentation.delivery = "pull-request";
  assert.ok((await validateArtifact("project", pullRequestDelivery)).errors.some(({ path, keyword }) => path === "/documentation/delivery" && keyword === "const"));
  const unrestrictedWeb = structuredClone(base);
  unrestrictedWeb.execution.web_access = "unrestricted";
  const invalidWeb = await validateArtifact("project", unrestrictedWeb);
  assert.ok(invalidWeb.errors.some(({ path, keyword }) => path === "/execution/web_access" && keyword === "enum"));

  const integrated = {
    ...base,
    integrations: {
      work_tracker: {
        provider: "azure-devops",
        requirement: "required",
        settings: { organization: "contoso", project: "platform" },
      },
      code_host: { provider: "github", requirement: "required" },
      observability: { provider: "datadog", requirement: "optional", settings: { site: "datadoghq.eu" } },
      knowledge: { provider: "notion", requirement: "disabled" },
    },
  };
  assert.deepEqual(await validateArtifact("project", integrated), { valid: true, errors: [] });

  const badRequirement = structuredClone(integrated);
  badRequirement.integrations.observability.requirement = "best-effort";
  const invalidRequirement = await validateArtifact("project", badRequirement);
  assert.equal(invalidRequirement.valid, false);
  assert.ok(invalidRequirement.errors.some(({ path, keyword }) => path === "/integrations/observability/requirement" && keyword === "enum"));

  const missingProvider = structuredClone(integrated);
  delete missingProvider.integrations.work_tracker.provider;
  const invalidProvider = await validateArtifact("project", missingProvider);
  assert.equal(invalidProvider.valid, false);
  assert.ok(invalidProvider.errors.some(({ path, keyword }) => path === "/integrations/work_tracker/provider" && keyword === "required"));

  const secretSetting = structuredClone(integrated);
  secretSetting.integrations.work_tracker.settings.access_token = "must-not-be-committed";
  const invalidSecret = await validateArtifact("project", secretSetting);
  assert.equal(invalidSecret.valid, false);
  assert.ok(invalidSecret.errors.some(({ path, keyword }) => path === "/integrations/work_tracker/settings/access_token" && keyword === "secret"));

  const structuredSetting = structuredClone(integrated);
  structuredSetting.integrations.work_tracker.settings.scope = { area: "backend" };
  const invalidSetting = await validateArtifact("project", structuredSetting);
  assert.equal(invalidSetting.valid, false);
  assert.ok(invalidSetting.errors.some(({ path, keyword }) => path === "/integrations/work_tracker/settings/scope" && keyword === "type"));

  const unknownCapability = structuredClone(integrated);
  unknownCapability.integrations.release_manager = { provider: "example", requirement: "optional" };
  const invalidCapability = await validateArtifact("project", unknownCapability);
  assert.equal(invalidCapability.valid, false);
  assert.ok(invalidCapability.errors.some(({ path, keyword }) => path === "/integrations/release_manager" && keyword === "additionalProperties"));

  for (const [field, value] of [["branch", "adw-docs"], ["worktree", "worktrees/adw-docs"]]) {
    const configurableOnlyInAppearance = structuredClone(base);
    configurableOnlyInAppearance.documentation[field] = value;
    const invalidLocation = await validateArtifact("project", configurableOnlyInAppearance);
    assert.equal(invalidLocation.valid, false);
    assert.ok(invalidLocation.errors.some(({ path, keyword }) => path === `/documentation/${field}` && keyword === "const"));
  }

  const placeholder = structuredClone(base);
  placeholder.validation.default = ["<replace with a verified command>"];
  assert.equal((await validateArtifact("project", placeholder)).valid, false);

});

test("project schema v5 requires the managed-development permission profile", async () => {
  const project = {
    schema: 5,
    git: { default_branch: "main" },
    documentation: { mode: "branch", branch: "docs", worktree: "worktrees/docs", sync_marker: "SYNC.yaml", delivery: "direct-push" },
    execution: { isolation: "managed-devcontainer", enforcement: "required", permissions: { profile: "managed-development" } },
    components: {},
    validation: { default: ["npm test"] },
  };
  assert.deepEqual(await validateArtifact("project", project), { valid: true, errors: [] });

  const missing = structuredClone(project);
  delete missing.execution.permissions;
  assert.equal((await validateArtifact("project", missing)).valid, false);
  const unknown = structuredClone(project);
  unknown.execution.permissions.profile = "bypass-everything";
  const invalid = await validateArtifact("project", unknown);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some(({ path }) => path === "/execution/permissions/profile"));

  const weak = structuredClone(project);
  weak.execution.enforcement = "preferred";
  const invalidWeak = await validateArtifact("project", weak);
  assert.ok(invalidWeak.errors.some(({ path, keyword }) => path === "/execution/enforcement" && keyword === "security"));
});

test("integration and external-action v1 schemas accept durable, secret-free evidence", async () => {
  const integration = {
    schema: 1,
    change_id: "api.retry",
    bindings: [
      {
        name: "primary_work_item",
        capability: "work_tracker",
        provider: "azure-devops",
        requirement: "required",
        external_id: "12345",
        url: "https://dev.azure.com/contoso/platform/_workitems/edit/12345",
        requirements_digest: "b".repeat(64),
        requirement_fields: ["title", "description", "acceptance_criteria"],
      },
    ],
  };
  assert.deepEqual(await validateArtifact("integration", integration), { valid: true, errors: [] });

  const receipt = {
    schema: 1,
    change_id: "api.retry",
    sequence: 1,
    capability: "work_tracker",
    provider: "azure-devops",
    transport: "cli",
    operation: "create_work_item",
    effect: "write",
    target: "contoso/platform",
    idempotency_key: "adw:platform:api.retry:create_work_item",
    requested_at: "2026-08-05T12:00:00Z",
    authorized_by: "Ada",
    authorization_digest: "d".repeat(64),
    status: "succeeded",
    request_digest: "c".repeat(64),
    readback_digest: "e".repeat(64),
    summary: "created and read back work item 12345",
    verified: true,
  };
  assert.deepEqual(await validateArtifact("external-action", receipt), { valid: true, errors: [] });

  const secretBearing = { ...receipt, access_token: "must-not-be-recorded" };
  const invalidSecret = await validateArtifact("external-action", secretBearing);
  assert.equal(invalidSecret.valid, false);
});

test("invalid values return actionable JSON pointers and contract-specific errors", async () => {
  const project = await validateArtifact("project", { schema: 5 });
  assert.equal(project.valid, false);
  assert(project.errors.some((error) => error.path === "/git" && error.keyword === "required"));

  const plan = await validateArtifact("plan", {
    schema: 2,
    change_id: "../escape",
    summary: "bad",
    effective_policy: { components: [], unowned_paths: [], project_policy_digest: "c".repeat(64), required_validation: [] },
    tasks: [{ id: 2, title: "x", description: "x", affected_paths: ["../outside"], validation: [{ command: "test", cwd: "../outside", timeout_ms: 0, required: true, source: "test" }] }],
    documentation: { impact: "update", files: [] }
  });
  assert.equal(plan.valid, false);
  assert(plan.errors.some((error) => error.path === "/change_id"));
  assert(plan.errors.some((error) => error.path === "/tasks/0/affected_paths/0"));
  assert(plan.errors.some((error) => error.keyword === "sequence"));
  assert(plan.errors.some((error) => error.keyword === "documentation"));
  const placeholderPlan = structuredClone({
    schema: 2,
    change_id: "placeholder",
    summary: "bad",
    effective_policy: { components: [], unowned_paths: [], project_policy_digest: "c".repeat(64), required_validation: [] },
    tasks: [{ id: 1, title: "x", description: "x", affected_paths: ["src"], restrictions: [], validation: [{ command: "<exact command>", cwd: ".", timeout_ms: 1000, required: true, source: "manifest" }] }],
    documentation: { impact: "none", files: [] },
  });
  assert.equal((await validateArtifact("plan", placeholderPlan)).valid, false);
});

test("approval lifecycle preserves superseded evidence and rejects ambiguous state", async () => {
  const base = { schema: 2, approver: "Ada", approved_at: "2026-08-05T12:00:00Z", plugin_version: "0.5.0", docs_commit: sha, digest_algorithm: "sha256", inputs: [{ path: "spec.md", digest: "c".repeat(64) }, { path: "plan.yaml", digest: "d".repeat(64) }], digest: "b".repeat(64) };
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

test("incident reports require bounded evidence, valid references, and coherent fix routing", async () => {
  const report = {
    schema: 1,
    incident_key: "monitor:123:2026-08-08T10:00:00Z",
    generated_at: "2026-08-08T10:20:00Z",
    source: {
      capability: "observability",
      provider: "datadog",
      external_id: "123",
      url: "https://app.datadoghq.eu/monitors/123",
      service: "payments-api",
      environment: "production",
      window: { from: "2026-08-08T09:45:00Z", to: "2026-08-08T10:20:00Z" },
    },
    repository: { identity: "example/payments", inspected_revision: sha, deployed_revision_verified: true },
    severity: { level: "high", confidence: "medium", rationale: "Production errors affected a substantial portion of requests." },
    summary: "Payment requests returned elevated server errors after a deployment.",
    impact: { status: "confirmed", description: "Approximately 20 percent of payment attempts failed for twelve minutes." },
    timeline: [{ at: "2026-08-08T10:00:00Z", description: "The error-rate threshold fired.", evidence_ref: "e1" }],
    evidence: [
      { id: "e1", kind: "monitor", summary: "The production error-rate monitor crossed its threshold.", external_id: "123", url: "https://app.datadoghq.eu/monitors/123" },
      { id: "e2", kind: "code", summary: "The deployed handler does not classify the observed upstream timeout." },
    ],
    hypotheses: [{ description: "An unhandled upstream timeout likely produced the failures.", confidence: "medium", evidence_refs: ["e1", "e2"] }],
    recommendations: [{ priority: "immediate", kind: "investigation", action: "Confirm the upstream timeout group in representative traces.", rationale: "This would test the leading hypothesis without changing production." }],
    proposed_fix: { needed: "yes", summary: "Handle and classify the upstream timeout.", route: "adw:plan", affected_paths: ["src/payments/handler.ts"], validation: ["npm test"] },
    unknowns: ["The upstream provider status was not available."],
    limitations: ["Only the deployed commit and bounded observability window were inspected."],
  };

  assert.deepEqual(await validateArtifact("incident-report", report), { valid: true, errors: [] });

  const badReference = structuredClone(report);
  badReference.hypotheses[0].evidence_refs = ["e99"];
  const invalidReference = await validateArtifact("incident-report", badReference);
  assert.equal(invalidReference.valid, false);
  assert.ok(invalidReference.errors.some(({ path, keyword }) => path === "/hypotheses/0/evidence_refs/0" && keyword === "reference"));

  const duplicateEvidence = structuredClone(report);
  duplicateEvidence.evidence[1].id = "e1";
  const invalidDuplicate = await validateArtifact("incident-report", duplicateEvidence);
  assert.equal(invalidDuplicate.valid, false);
  assert.ok(invalidDuplicate.errors.some(({ path, keyword }) => path === "/evidence" && keyword === "unique"));

  const unsafeRoute = structuredClone(report);
  unsafeRoute.proposed_fix = { needed: "no", summary: "No code change is indicated.", route: "adw:quick", affected_paths: [], validation: [] };
  const invalidRoute = await validateArtifact("incident-report", unsafeRoute);
  assert.equal(invalidRoute.valid, false);
  assert.ok(invalidRoute.errors.some(({ path, keyword }) => path === "/proposed_fix/route" && keyword === "routing"));

  const reversedWindow = structuredClone(report);
  reversedWindow.source.window = { from: "2026-08-08T10:20:00Z", to: "2026-08-08T09:45:00Z" };
  const invalidWindow = await validateArtifact("incident-report", reversedWindow);
  assert.equal(invalidWindow.valid, false);
  assert.ok(invalidWindow.errors.some(({ path, keyword }) => path === "/source/window" && keyword === "order"));

  const unverifiableRevision = structuredClone(report);
  unverifiableRevision.repository.inspected_revision = null;
  const invalidRevision = await validateArtifact("incident-report", unverifiableRevision);
  assert.equal(invalidRevision.valid, false);
  assert.ok(invalidRevision.errors.some(({ path, keyword }) => path === "/repository/inspected_revision" && keyword === "deployment"));
});
