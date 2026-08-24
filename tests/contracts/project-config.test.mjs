import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProjectConfig, parseYaml, providerDomains, validateProjectConfig, validationCommands } from "../../plugin/lib/config.mjs";
import { defaultPermissionPolicy, explainPermission } from "../../plugin/lib/permission-policy.mjs";

const MINIMAL = `
adw: 1
git:
  base_branch: main
execution:
  isolation: provider-sandbox
components:
  app:
    path: "."
    validate: []
`;

function errorPaths(result) {
  return result.errors.map(({ path }) => path);
}

test("the contract accepts a small handwritten configuration and normalizes its defaults", () => {
  const result = validateProjectConfig(parseYaml(MINIMAL));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.data, {
    adw: 1,
    git: { base_branch: "main" },
    docs: { branch: "docs", worktree: "worktrees/docs", plan_template: null },
    execution: { isolation: "provider-sandbox", web_access: "public-pages" },
    development: { runtime_versions: {} },
    components: { app: { path: ".", validate: [] } },
    providers: {},
    permissions: defaultPermissionPolicy(),
  });
});

test("the documentation branch and worktree can be overridden, and must stay off the base branch", () => {
  const withOverride = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
docs:
  branch: project-docs
  worktree: worktrees/project-docs
`));
  assert.equal(withOverride.valid, true, JSON.stringify(withOverride.errors));
  assert.deepEqual(withOverride.data.docs, { branch: "project-docs", worktree: "worktrees/project-docs", plan_template: null });

  // A docs checkout outside `worktrees/` is not ignored on the base branch, so
  // the whole documentation tree would land in the next code commit.
  const escaping = validateProjectConfig(parseYaml("adw: 1\ndocs:\n  worktree: documentation\n"));
  assert.equal(escaping.valid, false);
  assert.ok(errorPaths(escaping).includes("/docs/worktree"), errorPaths(escaping).join(", "));

  const collision = validateProjectConfig(parseYaml("adw: 1\ngit:\n  base_branch: docs\ndocs:\n  branch: docs\n"));
  assert.equal(collision.valid, false);
  assert.ok(errorPaths(collision).includes("/docs/branch"), errorPaths(collision).join(", "));

  // The default must not silently collide with a base branch named `docs`.
  const defaulted = validateProjectConfig(parseYaml("adw: 1\ngit:\n  base_branch: docs\n"));
  assert.equal(defaulted.valid, true, JSON.stringify(defaulted.errors));
  assert.notEqual(defaulted.data.docs.branch, "docs");

  const unknown = validateProjectConfig(parseYaml("adw: 1\ndocs:\n  remote: origin\n"));
  assert.equal(unknown.valid, false);
  assert.ok(errorPaths(unknown).includes("/docs/remote"), errorPaths(unknown).join(", "));
});

test("the plan template is an optional project-relative path", () => {
  const withTemplate = validateProjectConfig(parseYaml("adw: 1\ndocs:\n  plan_template: .adw/templates/plan.md\n"));
  assert.equal(withTemplate.valid, true, JSON.stringify(withTemplate.errors));
  assert.equal(withTemplate.data.docs.plan_template, ".adw/templates/plan.md");

  // Absent means the plugin's own skeleton, not a path the skill has to guess.
  const withoutTemplate = validateProjectConfig(parseYaml("adw: 1\n"));
  assert.equal(withoutTemplate.valid, true, JSON.stringify(withoutTemplate.errors));
  assert.equal(withoutTemplate.data.docs.plan_template, null);

  // A template outside the project is a path the docs worktree could never
  // read, so it fails the contract rather than the skill.
  const escaping = validateProjectConfig(parseYaml("adw: 1\ndocs:\n  plan_template: ../elsewhere/plan.md\n"));
  assert.equal(escaping.valid, false);
  assert.ok(errorPaths(escaping).includes("/docs/plan_template"), errorPaths(escaping).join(", "));

  const absolute = validateProjectConfig(parseYaml("adw: 1\ndocs:\n  plan_template: /etc/plan.md\n"));
  assert.equal(absolute.valid, false);
  assert.ok(errorPaths(absolute).includes("/docs/plan_template"), errorPaths(absolute).join(", "));
});

test("a validation command is normalized whether it is written as a string or an object", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
execution:
  isolation: managed-devcontainer
  web_access: hosted-only
components:
  api:
    path: services/api
    validate:
      - make test
      - command: pytest -q
        cwd: services/api/tests
        timeout_ms: 30000
        required: false
        source: Makefile#target:test
`));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.deepEqual(result.data.components.api.validate, [
    { command: "make test", cwd: "services/api", timeout_ms: 120000, required: true },
    { command: "pytest -q", cwd: "services/api/tests", timeout_ms: 30000, required: false, source: "Makefile#target:test" },
  ]);
  assert.equal(result.data.execution.web_access, "hosted-only");
});

test("git.branch_template is an unknown, rejected key — branch naming is an execution-time choice, not configuration", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
  branch_template: "feature/{change_id}-{group_id}"
`));
  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("/git/branch_template"));
});

test("removed 1.0 sections are rejected loudly instead of being silently ignored", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
planning:
  default_template: standard
  templates:
    standard: adw/plan-templates/standard.md
execution:
  mode: orchestrated
  isolation: provider-sandbox
conventions:
  branches: Use adw/<change>/<group>.
components:
  app:
    path: "."
`));
  assert.equal(result.valid, false);
  const paths = errorPaths(result);
  // A stale field must produce a specific error, never a quiet no-op.
  assert.ok(paths.includes("/planning"), paths.join(", "));
  assert.ok(paths.includes("/execution/mode"), paths.join(", "));
  assert.ok(paths.includes("/conventions"), paths.join(", "));
});

test("the contract rejects only operationally important defects", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 2
git:
  base_branch: "feature branch"
execution:
  isolation: nonsense
development:
  runtime_versions:
    node: latest
    cobol: "1"
components:
  Bad_Name:
    path: /etc
  other:
    path: "../escape"
`));
  assert.equal(result.valid, false);
  const paths = errorPaths(result);
  for (const expected of [
    "/adw",
    "/git/base_branch",
    "/execution/isolation",
    "/development/runtime_versions/node",
    "/development/runtime_versions/cobol",
    "/components/Bad_Name",
    "/components/other/path",
  ]) {
    assert.ok(paths.includes(expected), `${expected} missing from ${paths.join(", ")}`);
  }
});

test("two components cannot claim the same path", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
execution:
  isolation: provider-sandbox
components:
  first:
    path: "./services/api"
  second:
    path: services/api
`));
  assert.equal(result.valid, false);
  assert.ok(errorPaths(result).includes("/components/second/path"));
});

test("credential-like configuration is rejected everywhere, including inside opaque provider settings", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
execution:
  isolation: provider-sandbox
components:
  app:
    path: "."
providers:
  code_host:
    provider: github
    settings:
      api_token: "ghp_example"
`));
  assert.equal(result.valid, false);
  const paths = errorPaths(result);
  assert.ok(paths.some((path) => path.endsWith("/api_token")), paths.join(", "));
});

test("provider domains are validated because they widen the managed container's egress", () => {
  const rejected = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
execution:
  isolation: managed-devcontainer
components:
  app:
    path: "."
providers:
  code_host:
    provider: github
    domains:
      - "https://api.github.com/"
      - "10.0.0.1"
`));
  assert.equal(rejected.valid, false);
  assert.deepEqual(errorPaths(rejected), ["/providers/code_host/domains/0", "/providers/code_host/domains/1"]);

  const accepted = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
execution:
  isolation: managed-devcontainer
components:
  app:
    path: "."
providers:
  code_host:
    provider: github
    domains:
      - api.github.com
  work_tracker:
    provider: azure-devops
    domains:
      - dev.azure.com
      - api.github.com
`));
  assert.equal(accepted.valid, true, JSON.stringify(accepted.errors));
  assert.deepEqual(providerDomains(accepted.data), ["api.github.com", "dev.azure.com"]);
});

test("provider operation permissions are normalized and cannot weaken deny floors", () => {
  const accepted = validateProjectConfig(parseYaml(`
adw: 1
providers:
  code_host:
    provider: github
    access: read-write
permissions:
  providers:
    github:
      operations:
        comment: allow
      tools:
        add_comment: comment
`));
  assert.equal(accepted.valid, true, JSON.stringify(accepted.errors));
  assert.equal(accepted.data.permissions.providers.github.operations.comment, "allow");
  assert.equal(accepted.data.permissions.providers.github.tools.add_comment, "comment");
  assert.equal(explainPermission(accepted.data.permissions, { argv: ["gh", "pr", "comment", "42"] }).decision, "allow");
  assert.equal(explainPermission(accepted.data.permissions, { tool: "mcp__github__add_comment" }).decision, "allow");
  assert.equal(explainPermission(accepted.data.permissions, { tool: "mcp__github__unknown_write" }).decision, "ask");

  const rejected = validateProjectConfig(parseYaml(`
adw: 1
permissions:
  providers:
    github:
      operations:
        merge: allow
      tools:
        merge_pull_request: read
        execute_action: read
    notion:
      operations:
        update: sometimes
`));
  assert.equal(rejected.valid, false);
  assert.deepEqual(errorPaths(rejected), ["/permissions/providers/github/operations/merge", "/permissions/providers/github/tools/merge_pull_request", "/permissions/providers/github/tools/execute_action", "/permissions/providers/notion/operations/update"]);

  const missingAccess = validateProjectConfig(parseYaml(`
adw: 1
permissions:
  providers:
    github:
      operations:
        comment: allow
`));
  assert.equal(missingAccess.valid, false);
  assert.deepEqual(errorPaths(missingAccess), ["/permissions/providers/github/operations/comment"]);
});

test("YAML 1.2 duplicate-key rejection still guards the project contract", () => {
  assert.throws(() => parseYaml(`${MINIMAL}\ngit:\n  base_branch: other\n`, "adw.yaml"), /invalid/i);
  assert.throws(() => parseYaml("- not\n- a\n- mapping\n", "adw.yaml"), /one mapping object/);
});

test("validation commands are deduplicated conservatively across components", () => {
  const result = validateProjectConfig(parseYaml(`
adw: 1
git:
  base_branch: main
execution:
  isolation: provider-sandbox
components:
  first:
    path: "."
    validate:
      - command: npm test
        required: false
        timeout_ms: 60000
  second:
    path: packages/lib
    validate:
      - command: npm test
        cwd: "."
        required: true
        timeout_ms: 90000
`));
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const commands = validationCommands(result.data);
  assert.equal(commands.length, 1);
  // The strictest `required` and the shortest timeout win, so a duplicate can
  // never quietly relax a check another component depends on.
  assert.equal(commands[0].required, true);
  assert.equal(commands[0].timeout_ms, 60000);
});

test("the loader reads and validates the project file itself", async () => {
  const directory = mkdtempSync(join(tmpdir(), "adw-config-"));
  writeFileSync(join(directory, "adw.yaml"), MINIMAL);
  const loaded = await loadProjectConfig(directory);
  assert.equal(loaded.valid, true);
  assert.equal(loaded.data.git.base_branch, "main");

  writeFileSync(join(directory, "adw.yaml"), "adw: 1\n");
  const sparse = await loadProjectConfig(directory);
  assert.equal(sparse.valid, true);
  assert.equal(sparse.source, "adw.yaml");

  writeFileSync(join(directory, "adw.yaml"), [
    "adw: 1",
    "git:",
    "  branch_template: \"feature/{change_id}-{group_id}\"",
    "",
  ].join("\n"));
  const rejected = await loadProjectConfig(directory);
  assert.equal(rejected.valid, false);
  assert.ok(rejected.errors.some(({ path }) => path === "/git/branch_template"));

  const missing = await loadProjectConfig(directory, "missing.yaml");
  assert.equal(missing.valid, false);
  assert.equal(missing.source, "missing");
  assert.match(missing.errors[0].message, /run adw:init/);
});
