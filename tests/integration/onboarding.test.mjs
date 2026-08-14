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

test("missing answers use the lightweight dual-agent default", () => {
  const first = loadOnboarding(null, pluginRoot);
  const second = defaultOnboarding();
  assert.deepEqual({ ...first, digest: "<digest>" }, {
    schema: 1,
    agentTools: "both",
    webAccess: "public-pages",
    execution: { mode: "orchestrated" },
    development: { runtimeVersions: {} },
    providers: {},
    networkDomains: [],
    conventions: {},
    local: { identity: {}, providers: {} },
    digest: "<digest>",
  });
  assert.match(first.digest, /^[a-f0-9]{64}$/);
  assert.equal(first.digest, onboardingDigest(first));
  assert.equal(first.execution.isolation, undefined, "isolation is resolved from the repository, not assumed here");
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
    web_access: "public-pages",
    execution: { isolation: "managed-devcontainer", mode: "orchestrated" },
    providers: {
      work_tracker: {
        provider: "github",
        required: true,
        access: "read-write",
        settings: { repository: "adw", owner: "openai" },
        network_domains: ["API.GitHub.com", "github.com"],
      },
      code_host: {
        provider: "github",
        required: false,
        transport: "auto",
        access: "read-write",
        network_domains: ["github.com"],
      },
    },
    conventions: {
      branches: "Prefix change branches with adw/.",
      pull_requests: "Keep group pull requests small and draft until reviewed.",
    },
    local: {
      identity: {
        display_name: "Ada: \"A\" Lovelace",
        email: "ada@example.test",
        work_tracker_account: "ada",
      },
      providers: {
        work_tracker: { transport: "cli", account: "ada" },
        code_host: { transport: "native" },
      },
    },
  }));

  assert.equal(onboarding.agentTools, "both");
  assert.equal(onboarding.webAccess, "public-pages");
  assert.deepEqual(onboarding.execution, { isolation: "managed-devcontainer", mode: "orchestrated" });
  assert.deepEqual(onboarding.networkDomains, ["api.github.com", "github.com"]);
  assert.equal("network_domains" in onboarding.providers.work_tracker, false);
  assert.equal(onboarding.providers.work_tracker.required, true);
  assert.equal(onboarding.providers.code_host.required, false);
  assert.deepEqual(Object.keys(onboarding.providers.work_tracker.settings), ["owner", "repository"]);
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
    "providers:",
    "  work_tracker:",
    "    transport: \"cli\"",
    "    account: \"ada\"",
    "  code_host:",
    "    transport: \"native\"",
    "",
  ].join("\n"));
});

test("execution answers carry only the workflow shape", () => {
  assert.deepEqual(load(base({ execution: { mode: "sequential" } })).execution, { mode: "sequential" });
  assert.throws(() => load(base({ execution: { mode: "parallel" } })), /orchestrated, sequential/);
  // A parallelism limit is not an onboarding answer; the plan decides it.
  assert.throws(() => load(base({ execution: { max_parallel: 3 } })), /max_parallel.*not supported/);
  assert.throws(() => load(base({ execution: { isolation: "nowhere" } })), /managed-devcontainer|provider-sandbox/);
});

test("summary exposes local field names without personal values", () => {
  const onboarding = load(base({
    providers: {
      code_host: {
        provider: "github",
        required: true,
        settings: { owner: "shared-owner", repository: "shared-repository" },
      },
    },
    local: {
      identity: { display_name: "Private Person", email: "private@example.test" },
      providers: { code_host: { transport: "cli", account: "private-account" } },
    },
  }));
  const summary = onboardingSummary(onboarding);
  assert.equal(summary.agent_tools, "both");
  assert.deepEqual(summary.execution, { mode: "orchestrated", isolation: null });
  assert.deepEqual(summary.providers.code_host.settings, ["owner", "repository"]);
  assert.equal(summary.providers.code_host.required, true);
  assert.deepEqual(summary.local.identity_fields, ["display_name", "email"]);
  assert.deepEqual(summary.local.providers.code_host, ["account", "transport"]);
  const serialized = JSON.stringify(summary);
  assert.doesNotMatch(serialized, /Private Person|private@example\.test|private-account/);
  assert.doesNotMatch(serialized, /shared-owner|shared-repository/);
});

test("digest covers normalized values rather than answer formatting or key order", () => {
  const left = load(base({
    conventions: { branches: "Use change branches.", pull_requests: "Use drafts." },
  }));
  const right = load({
    conventions: { pull_requests: "Use drafts.", branches: "Use change branches." },
    schema: 1,
  });
  assert.equal(onboardingDigest(left), onboardingDigest(right));
  const changed = structuredClone(right);
  changed.conventions.branches = "Use fix branches.";
  assert.notEqual(onboardingDigest(left), onboardingDigest(changed));
  assert.throws(() => onboardingDigest({ schema: 1 }), /requires normalized/);
});

test("rejects unsupported inputs, unknown fields, and secret-like keys recursively", () => {
  assert.throws(() => load(base({ agents: ["codex"] })), /agents.*not supported/);
  assert.throws(() => load(base({ web_access: "unrestricted" })), /hosted-only, public-pages/);
  assert.throws(() => load(base({ surprise: true })), /surprise.*not supported/);
  // Unsupported top-level blocks must be rejected, never quietly ignored.
  for (const unsupported of ["integrations", "workflows", "documentation"]) {
    assert.throws(() => load(base({ [unsupported]: {} })), new RegExp(`${unsupported}.*not supported`), unsupported);
  }
  assert.throws(() => load(base({ local: { identity: { display_name: "Ada", access_token: "do-not-store" } } })), /credential-like keys are forbidden/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "github", required: true, settings: { nested: { api_key: "x" } } } } })), /api_key.*credential-like/);
});

test("validates provider capabilities, availability, settings, and DNS names", () => {
  assert.throws(() => load(base({ providers: { code_host: { provider: "notion" } } })), /does not support code_host/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "unknown" } } })), /unknown provider/);
  assert.throws(() => load(base({ providers: { deployment: { provider: "github" } } })), /not a known capability/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "github", required: "yes" } } })), /required.*boolean/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "github", transport: "ssh" } } })), /auto, native, mcp, cli, api/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "github", settings: { owner: 42 } } } })), /settings.owner.*non-empty string/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "github", network_domains: ["https://github.com"] } } })), /DNS hostname/);
  assert.throws(() => load(base({ providers: { code_host: { provider: "github", network_domains: ["github.com", "GITHUB.COM"] } } })), /duplicate domain/);
});

test("local choices require a declared shared capability and conventions stay single-line", () => {
  assert.throws(() => load(base({ local: { providers: { code_host: { transport: "cli" } } } })), /code_host/);
  assert.throws(() => load(base({ conventions: { branches: "first\nsecond" } })), /single-line/);
  assert.throws(() => load(base({ conventions: { "Bad Key": "value" } })), /snake_case/);
  assert.throws(() => load(base({ local: { identity: { email: "first\tsecond" } } })), /single-line/);
});
