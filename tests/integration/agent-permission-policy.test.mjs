import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_ALLOW,
  CLAUDE_ASK,
  CLAUDE_DENY,
  CODEX_RULES,
  managedClaudeSettings,
  mergeClaudeSettings,
  mergeCodexConfig,
  permissionAgentsFromProject,
  permissionProjectFiles,
} from "../../plugin/execution/managed-development.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hook = join(repositoryRoot, "plugin/templates/devcontainer/claude-permission-hook.mjs");

test("Codex policy keeps workspace development automatic and external effects gated", () => {
  const existing = 'model = "gpt-test"\n';
  const merged = mergeCodexConfig(existing);
  assert.match(merged, /approval_policy = "on-request"/);
  assert.match(merged, /sandbox_mode = "workspace-write"/);
  assert.match(merged, /web_search = "live"/);
  assert.match(merged, /\[apps\._default\]\ndefault_tools_approval_mode = "writes"/);
  assert.match(merged, /model = "gpt-test"/);
  assert.equal(mergeCodexConfig(merged), merged);
  const repairedPartial = mergeCodexConfig([
    "# ADW:MANAGED-DEVELOPMENT:START",
    'approval_policy = "on-request"',
    "# ADW:MANAGED-DEVELOPMENT:END",
    'model = "gpt-test"',
    "",
  ].join("\n"));
  assert.equal((repairedPartial.match(/# ADW:MANAGED-DEVELOPMENT:START/g) ?? []).length, 1);
  assert.equal((repairedPartial.match(/# ADW:MANAGED-DEVELOPMENT:END/g) ?? []).length, 1);
  assert.match(repairedPartial, /# ADW:MANAGED-DEVELOPMENT:START\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nweb_search = "live"\n# ADW:MANAGED-DEVELOPMENT:END/);
  assert.equal(mergeCodexConfig(repairedPartial), repairedPartial);
  assert.throws(() => mergeCodexConfig('approval_policy = "never"\n'), /conflicts/);
  assert.throws(() => mergeCodexConfig('profile = "unsafe"\n[profiles.unsafe]\napproval_policy = "never"\n'), /active profile.*conflicts/);
  assert.throws(() => mergeCodexConfig('sandbox_mode = "danger-full-access"\n'), /conflicts/);
  assert.throws(() => mergeCodexConfig('web_search = "disabled"\n'), /conflicts/);

  for (const expected of [
    'pattern = ["git", ["add", "commit"]], decision = "allow"',
    'pattern = ["git", "push"], decision = "allow"',
    'pattern = ["gh", "api"], decision = "prompt"',
    'pattern = [["glab", "jira", "datadog-ci", "datadog", "notion"]], decision = "prompt"',
    'pattern = ["gh", "pr", "merge"], decision = "forbidden"',
  ]) assert.match(CODEX_RULES, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(CODEX_RULES, /\["npm", "run"\], decision = "allow"/);
});

test("Claude policy uses sandbox-first Bash plus explicit external-write review", () => {
  const merged = JSON.parse(mergeClaudeSettings('{"env":{"EXAMPLE":"1"},"permissions":{"allow":["mcp__docs__get_*"]}}'));
  assert.equal(merged.env.EXAMPLE, "1");
  assert.equal(merged.permissions.defaultMode, "acceptEdits");
  assert.equal(merged.permissions.disableBypassPermissionsMode, "disable");
  assert.equal(merged.sandbox.enabled, true);
  assert.equal(merged.sandbox.failIfUnavailable, true);
  assert.equal(merged.sandbox.autoAllowBashIfSandboxed, true);
  assert.equal(merged.sandbox.allowUnsandboxedCommands, false);
  for (const rule of CLAUDE_ASK) assert.ok(merged.permissions.ask.includes(rule));
  for (const rule of CLAUDE_DENY) assert.ok(merged.permissions.deny.includes(rule));
  for (const rule of CLAUDE_ALLOW) assert.ok(merged.permissions.allow.includes(rule));
  assert.ok(merged.permissions.ask.includes("Bash(gh api *)"));
  assert.deepEqual(merged.permissions.allow, ["mcp__docs__get_*", "WebSearch"]);
  assert.ok(merged.permissions.ask.includes("Bash(az boards work-item update *)"));
  assert.ok(merged.permissions.deny.includes("Bash(git push --force *)"));
  assert.ok(!merged.permissions.allow.includes("mcp__*"));
  assert.throws(() => mergeClaudeSettings('{"permissions":{"defaultMode":"bypassPermissions"}}'), /conflicts/);
  assert.throws(() => mergeClaudeSettings('{"permissions":{"allow":["mcp__*"]}}'), /broad MCP allow/);
  assert.throws(() => mergeClaudeSettings('{"permissions":{"allow":[42]}}'), /allow entries must be strings/);
  assert.throws(
    () => mergeClaudeSettings('{"permissions":{"allow":["Bash(custom-tool *)","mcp__docs__get_*"]}}'),
    /contains Bash allow rules.*review and remove them explicitly.*Bash\(custom-tool \*\)/,
  );

  const managed = JSON.parse(managedClaudeSettings());
  assert.deepEqual(managed.sandbox.network.allowedDomains, []);
  assert.equal(managed.sandbox.network.allowManagedDomainsOnly, undefined);
  assert.equal(managed.sandbox.network.strictAllowlist, true);
  assert.equal(JSON.parse(managedClaudeSettings({ webAccess: "public-pages" })).sandbox.network.allowManagedDomainsOnly, undefined);
  assert.equal(JSON.parse(managedClaudeSettings({ webAccess: "hosted-only" })).sandbox.network.allowManagedDomainsOnly, true);
  assert.throws(() => managedClaudeSettings({ webAccess: "unrestricted" }), /unsupported web access profile/);
  assert.equal(managed.hooks.PreToolUse.length, 2);
  assert.match(managed.hooks.PreToolUse[0].hooks[0].command, /adw-claude-permission-hook/);
});

function hookDecision(tool_name, tool_input = {}) {
  const result = spawnSync(process.execPath, [hook], { input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput.permissionDecision : null;
}

test("Claude managed hook allows sandboxed local work, asks for external effects, and denies forbidden effects", () => {
  assert.equal(hookDecision("mcp__github__get_file_contents"), "allow");
  assert.equal(hookDecision("mcp__azure_devops__wit_query_by_wiql"), "allow");
  assert.equal(hookDecision("mcp__github__create_pull_request"), "ask");
  assert.equal(hookDecision("mcp__github__get_or_create_pull_request"), "ask");
  assert.equal(hookDecision("mcp__custom__opaque_operation"), "ask");
  assert.equal(hookDecision("Bash", { command: "git status" }), "allow");
  assert.equal(hookDecision("Bash", { command: 'git "status" --short' }), "allow");
  assert.equal(hookDecision("Bash", { command: 'echo "$HOME"' }), "allow");
  assert.equal(hookDecision("Bash", { command: "dotnet tool restore && dotnet test" }), "allow");
  assert.equal(hookDecision("Bash", { command: "git status && git push origin main" }), "ask");
  assert.equal(hookDecision("Bash", { command: 'git "push" origin main' }), "ask");
  assert.equal(hookDecision("Bash", { command: "git pu\\sh origin main" }), "ask");
  assert.equal(hookDecision("Bash", { command: "git pu\\\nsh origin main" }), "ask");
  assert.equal(hookDecision("Bash", { command: "git -C /workspace push origin main" }), "ask");
  assert.equal(hookDecision("Bash", { command: 'git "$ADW_GIT_ACTION" origin main' }), "ask");
  assert.equal(hookDecision("Bash", { command: "git p origin main" }), "ask");
  assert.equal(hookDecision("Bash", { command: "echo $(git push origin main)" }), "ask");
  assert.equal(hookDecision("Bash", { command: "echo `git push origin main`" }), "ask");
  assert.equal(hookDecision("Bash", { command: "gh label create urgent --color ff0000" }), "ask");
  assert.equal(hookDecision("Bash", { command: "glab repo view" }), "ask");
  assert.equal(hookDecision("Bash", { command: "datadog-ci synthetics run-tests" }), "ask");
  assert.equal(hookDecision("Bash", { command: "env FOO=bar gh pr view 42" }), "allow");
  assert.equal(hookDecision("Bash", { command: "gh --repo acme/repo pr view 42" }), "allow");
  assert.equal(hookDecision("Bash", { command: "bash -lc 'gh label create urgent --color ff0000'" }), "ask");
  assert.equal(hookDecision("Bash", { command: "curl -X POST https://api.github.com/repos/acme/repo/issues" }), "ask");
  assert.equal(hookDecision("Bash", { command: "npm run release" }), "ask");
  assert.equal(hookDecision("Bash", { command: "rm -rf build" }), "ask");
  assert.equal(hookDecision("Bash", { command: "rm -fr build" }), "ask");
  assert.equal(hookDecision("Bash", { command: "rm -f -r build" }), "ask");
  assert.equal(hookDecision("Bash", { command: "rm --force --recursive build" }), "ask");
  assert.equal(hookDecision("Bash", { command: "/bin/rm -fr build" }), "ask");
  assert.equal(hookDecision("Bash", { command: "echo $(rm -fr build)" }), "ask");
  assert.equal(hookDecision("Bash", { command: "git push --force origin main" }), "deny");
  assert.equal(hookDecision("Bash", { command: 'git "push" --"force" origin main' }), "deny");
  assert.equal(hookDecision("Bash", { command: "git pu\\sh --fo\\rce origin main" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push --for\\\nce origin main" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git -C /workspace push --force origin main" }), "deny");
  assert.equal(hookDecision("Bash", { command: 'git push --for""ce origin main' }), "deny");
  assert.equal(hookDecision("Bash", { command: "echo $(git push --force origin main)" }), "deny");
  assert.equal(hookDecision("Bash", { command: "echo `git push --force origin main`" }), "deny");
  assert.equal(hookDecision("Bash", { command: 'git push "$ADW_PUSH_OPTION" origin main' }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push origin main --force" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push --force-with-lease=main origin main" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push -uf origin main" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push origin +main" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push origin '+main'" }), "deny");
  assert.equal(hookDecision("Bash", { command: "bash -lc 'git push origin main --force'" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git push --mirror origin" }), "deny");
  assert.equal(hookDecision("Bash", { command: "git reset --hard HEAD~1" }), "deny");
  assert.equal(hookDecision("Bash", { command: "gh auth token" }), "deny");
  assert.equal(hookDecision("Bash", { command: "npm publish" }), "deny");
  const malformed = spawnSync(process.execPath, [hook], { input: "not-json", encoding: "utf8" });
  assert.equal(malformed.status, 2);
});

test("permission agent detection requires explicit ADW policy evidence", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-permission-agents-"));
  const dependencies = { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join };
  writeFileSync(join(root, "AGENTS.md"), "routing only\n");
  writeFileSync(join(root, "CLAUDE.md"), "routing only\n");
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(join(root, ".codex/config.toml"), 'approval_policy = "on-request"\n');
  assert.equal(permissionAgentsFromProject(root, dependencies), "unknown");
  assert.throws(() => permissionAgentsFromProject(root, { existsSync, readFileSync, join }), /requires lstatSync/);

  mkdirSync(join(root, ".codex/rules"), { recursive: true });
  writeFileSync(join(root, ".codex/rules/adw.rules"), CODEX_RULES);
  assert.equal(permissionAgentsFromProject(root, dependencies), "codex");

  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude/settings.json"), mergeClaudeSettings());
  assert.equal(permissionAgentsFromProject(root, dependencies), "both");
});

test("the files carrying the permission profile cannot be rewritten without review", () => {
  const merged = JSON.parse(mergeClaudeSettings());
  for (const path of [".claude/settings.json", ".codex/config.toml", ".codex/rules/adw.rules", "adw.yaml"]) {
    assert.ok(merged.permissions.ask.includes(`Edit(./${path})`), `${path} is editable without review`);
    assert.ok(merged.permissions.ask.includes(`Write(./${path})`), `${path} is writable without review`);
  }
  assert.ok(merged.permissions.ask.includes("Edit(./.devcontainer/**)"));
  assert.ok(merged.permissions.ask.includes("Write(./.devcontainer/**)"));
  // The drift check compares a project's bytes against a fresh merge, so the
  // self-protection rules must survive re-merging unchanged.
  assert.equal(JSON.stringify(JSON.parse(mergeClaudeSettings(JSON.stringify(merged)))), JSON.stringify(merged));
  assert.ok(JSON.parse(managedClaudeSettings()).permissions.ask.includes("Edit(./adw.yaml)"));
});

test("the permissions-only snapshot fails closed on drifted policy without inspecting the rest of the project", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-permission-gate-"));
  const snapshot = join(repositoryRoot, "plugin/skills/doctor/scripts/snapshot.mjs");
  const run = () => spawnSync(process.execPath, [snapshot, "--project-root", root, "--checks", "permissions"], { encoding: "utf8" });
  for (const file of permissionProjectFiles("both")) {
    mkdirSync(join(root, dirname(file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.content);
  }

  const clean = run();
  assert.equal(clean.status, 0, clean.stdout);
  const report = JSON.parse(clean.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.read_only, true);
  // The gate runs before Git, docs, container, and manifest inspection, so it
  // must reach a verdict in a directory that carries nothing but policy files.
  assert.deepEqual(report.checks.map(({ id }) => id), ["permissions:configuration", "permissions:codex", "permissions:claude"]);

  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  settings.permissions.deny = settings.permissions.deny.filter((rule) => !rule.includes("git push --force"));
  writeFileSync(join(root, ".claude/settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  const drifted = run();
  assert.equal(drifted.status, 1);
  assert.equal(JSON.parse(drifted.stdout).ok, false);
  assert.match(JSON.parse(drifted.stdout).checks.find(({ id }) => id === "permissions:claude").summary, /drifted/);

  const rejected = spawnSync(process.execPath, [snapshot, "--project-root", root, "--checks", "everything"], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(JSON.parse(rejected.stdout).error, /--checks must be all or permissions/);
});
