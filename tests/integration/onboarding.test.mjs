import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultOnboarding,
  loadOnboarding,
  onboardingDigest,
  onboardingSummary,
  renderLocalConfiguration,
} from "../../plugin/skills/init/scripts/onboarding.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const pluginRoot = join(repositoryRoot, "plugin");

function answers(value) {
  const directory = mkdtempSync(join(tmpdir(), "adw-onboarding-"));
  const path = join(directory, "answers.json");
  writeFileSync(path, JSON.stringify(value, null, 2));
  return path;
}

function load(value) {
  return loadOnboarding(answers(value), pluginRoot);
}

function base(overrides = {}) {
  return { schema: 1, ...overrides };
}

test("missing answers use a fresh dual-agent default", () => {
  const first = loadOnboarding(null, pluginRoot);
  const second = defaultOnboarding();
  assert.deepEqual({ ...first, digest: "<digest>" }, {
    schema: 1,
    agentTools: "both",
    webAccess: "hosted-only",
    documentation: { delivery: "direct-push" },
    integrations: {},
    networkDomains: [],
    workflows: {},
    conventions: {},
    local: { identity: {}, integrations: {} },
    digest: "<digest>",
  });
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.digest, onboardingDigest(first));
  first.local.identity.display_name = "changed";
  assert.deepEqual(second.local.identity, {}, "defaults must not share nested mutable state");
  assert.equal(renderLocalConfiguration(second), [
    "# Machine-local ADW settings. This file is ignored by Git.",
    "# Credentials belong in provider clients or credential stores, never here.",
    "schema: 1",
    "",
  ].join("\n"));
});

test("normalizes supported project and local onboarding answers", () => {
  const onboarding = load(base({
    agents: ["claude", "codex"],
    web_access: "public-pages",
    execution: { isolation: "managed-devcontainer" },
    documentation: { delivery: "pull-request" },
    integrations: {
      work_tracker: {
        provider: "github",
        requirement: "required",
        access: "read-write",
        settings: { repository: "adw", owner: "openai" },
        network_domains: ["API.GitHub.com", "github.com"],
      },
      code_host: {
        provider: "github",
        requirement: "optional",
        transport: "auto",
        access: "read-write",
        network_domains: ["github.com"],
      },
    },
    workflows: {
      work_tracker: {
        binding: "required",
        ensure: "create-or-link",
        stage: "plan",
        cardinality: "one-parent-plus-plan-tasks",
        profile: "adw/work-items/story.yaml",
        child_profile: "adw/work-items/task.yml",
      },
    },
    conventions: {
      branches: "Prefix feature branches with adw/.",
      pull_requests: "Create one draft pull request per change.",
      work_items: "Use one story with implementation tasks.",
    },
    local: {
      identity: {
        display_name: "Ada: \"A\" Lovelace",
        email: "ada@example.test",
        work_tracker_account: "ada",
      },
      integrations: {
        work_tracker: { transport: "cli", account: "ada" },
        code_host: { transport: "native" },
      },
    },
  }));

  assert.equal(onboarding.agentTools, "both");
  assert.equal(onboarding.webAccess, "public-pages");
  assert.deepEqual(onboarding.execution, { isolation: "managed-devcontainer" });
  assert.deepEqual(onboarding.documentation, { delivery: "pull-request" });
  assert.deepEqual(onboarding.networkDomains, ["api.github.com", "github.com"]);
  assert.equal("network_domains" in onboarding.integrations.work_tracker, false);
  assert.deepEqual(Object.keys(onboarding.integrations.work_tracker.settings), ["owner", "repository"]);
  assert.equal(onboarding.workflows.work_tracker.child_profile, "adw/work-items/task.yml");
  assert.equal(renderLocalConfiguration(onboarding), [
    "# Machine-local ADW settings. This file is ignored by Git.",
    "# Credentials belong in provider clients or credential stores, never here.",
    "schema: 1",
    "",
    "identity:",
    "  display_name: \"Ada: \\\"A\\\" Lovelace\"",
    "  email: \"ada@example.test\"",
    "  work_tracker_account: \"ada\"",
    "",
    "integrations:",
    "  work_tracker:",
    "    transport: \"cli\"",
    "    account: \"ada\"",
    "  code_host:",
    "    transport: \"native\"",
    "",
  ].join("\n"));
});

test("summary exposes local field names without personal values", () => {
  const onboarding = load(base({
    agents: ["codex"],
    integrations: {
      code_host: {
        provider: "github",
        requirement: "required",
        settings: { owner: "shared-owner", repository: "shared-repository" },
      },
    },
    local: {
      identity: { display_name: "Private Person", email: "private@example.test" },
      integrations: { code_host: { transport: "cli", account: "private-account" } },
    },
  }));
  const summary = onboardingSummary(onboarding);
  assert.equal(summary.agent_tools, "codex");
  assert.deepEqual(summary.integrations.code_host.settings, ["owner", "repository"]);
  assert.deepEqual(summary.local.identity_fields, ["display_name", "email"]);
  assert.deepEqual(summary.local.integrations.code_host, ["account", "transport"]);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /Private Person|private@example\.test|private-account/);
  assert.doesNotMatch(serialized, /shared-owner|shared-repository/);
});

test("digest covers normalized values rather than answer formatting or key order", () => {
  const left = load(base({
    agents: ["codex", "claude"],
    conventions: { branches: "Use feature branches.", pull_requests: "Use drafts." },
  }));
  const right = load({
    conventions: { pull_requests: "Use drafts.", branches: "Use feature branches." },
    agents: ["claude", "codex"],
    schema: 1,
  });
  assert.equal(onboardingDigest(left), onboardingDigest(right));
  const changed = structuredClone(right);
  changed.conventions.branches = "Use fix branches.";
  assert.notEqual(onboardingDigest(left), onboardingDigest(changed));
  assert.throws(() => onboardingDigest({ schema: 1 }), /requires normalized/);
});

test("rejects invalid agents, unknown fields, and secret-like keys recursively", () => {
  assert.throws(() => load(base({ agents: [] })), /agents.*non-empty/);
  assert.throws(() => load(base({ agents: ["codex", "codex"] })), /duplicate agent/);
  assert.throws(() => load(base({ agents: ["cursor"] })), /codex, claude/);
  assert.throws(() => load(base({ web_access: "unrestricted" })), /hosted-only, public-pages/);
  assert.throws(() => load(base({ agents: ["codex"], web_access: "public-pages" })), /applies only when Claude Code is selected/);
  assert.throws(() => load(base({ surprise: true })), /surprise.*not supported/);
  assert.throws(() => load(base({ local: { identity: { display_name: "Ada", access_token: "do-not-store" } } })), /credential-like keys are forbidden/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "github", requirement: "required", settings: { nested: { api_key: "x" } } } } })), /api_key.*credential-like/);
});

test("validates provider capabilities, integration enums, settings, and DNS names", () => {
  assert.throws(() => load(base({ integrations: { code_host: { provider: "notion", requirement: "required" } } })), /does not support code_host/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "unknown", requirement: "required" } } })), /unknown provider/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "github", requirement: "best-effort" } } })), /disabled, optional, required/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "github", requirement: "required", transport: "ssh" } } })), /auto, native, mcp, cli, api/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "github", requirement: "required", settings: { owner: 42 } } } })), /settings.owner.*non-empty string/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "github", requirement: "required", network_domains: ["https:\/\/github.com"] } } })), /DNS hostname/);
  assert.throws(() => load(base({ integrations: { code_host: { provider: "github", requirement: "required", network_domains: ["github.com", "GITHUB.COM"] } } })), /duplicate domain/);
});

test("enforces work-tracker workflow cross-field requirements", () => {
  const workflow = {
    binding: "required",
    ensure: "create-or-link",
    stage: "plan",
    cardinality: "one-per-change",
    profile: "adw/work-items/story.yaml",
  };
  assert.throws(() => load(base({ workflows: { work_tracker: workflow } })), /enabled work_tracker integration/);
  assert.throws(() => load(base({
    integrations: { work_tracker: { provider: "github", requirement: "optional", access: "read-write" } },
    workflows: { work_tracker: workflow },
  })), /required binding requires a required/);
  assert.throws(() => load(base({
    integrations: { work_tracker: { provider: "github", requirement: "required", access: "read-only" } },
    workflows: { work_tracker: workflow },
  })), /create-or-link requires read-write/);
  assert.throws(() => load(base({
    integrations: { work_tracker: { provider: "github", requirement: "required", access: "read-write" } },
    workflows: { work_tracker: { ...workflow, profile: undefined } },
  })), /profile.*required/);
  assert.throws(() => load(base({
    integrations: { work_tracker: { provider: "github", requirement: "required", access: "read-write" } },
    workflows: { work_tracker: { ...workflow, cardinality: "one-parent-plus-plan-tasks" } },
  })), /child_profile.*required/);
  assert.throws(() => load(base({
    integrations: { work_tracker: { provider: "github", requirement: "required", access: "read-write" } },
    workflows: { work_tracker: { ...workflow, profile: "../story.yaml" } },
  })), /project-relative YAML path/);
});

test("local choices require an enabled shared capability and conventions stay single-line", () => {
  assert.throws(() => load(base({ local: { integrations: { code_host: { transport: "cli" } } } })), /enabled code_host integration/);
  assert.throws(() => load(base({ conventions: { branches: "first\nsecond" } })), /single-line/);
  assert.throws(() => load(base({ local: { identity: { email: "first\tsecond" } } })), /single-line/);
});
