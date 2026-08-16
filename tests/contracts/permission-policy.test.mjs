import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  CLAUDE_ALLOW,
  CLAUDE_ASK,
  CLAUDE_DENY,
  CODEX_RULES,
  PERMISSION_FILES,
  managedClaudeSettings,
  mergeClaudeSettings,
  mergeCodexConfig,
  permissionProjectFiles,
} from "../../plugin/lib/permissions.mjs";
import { permissionChecks } from "../../plugin/lib/doctor.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const hook = join(repositoryRoot, "plugin/templates/devcontainer/claude-permission-hook.mjs");
const cli = join(repositoryRoot, "plugin/bin/adw.mjs");
const authorization = readFileSync(join(repositoryRoot, "plugin/authorization.md"), "utf8");

// --- Codex rule evaluation ------------------------------------------------
// A faithful-enough model of the exec-policy engine: a rule matches when its
// pattern matches a *prefix* of argv, and the most restrictive matching rule
// wins. `codex-execpolicy.test.mjs` proves the real engine agrees whenever the
// Codex CLI is installed.
const RESTRICTIVENESS = { allow: 0, prompt: 1, forbidden: 2 };

const CODEX_RULE_SET = CODEX_RULES.split("\n")
  .map((line) => /^prefix_rule\(pattern = (\[.*\]), decision = "([a-z]+)"\)$/.exec(line.trim()))
  .filter(Boolean)
  .map(([, pattern, decision]) => ({ pattern: JSON.parse(pattern), decision }));

function codexDecision(argv) {
  let decision = null;
  for (const rule of CODEX_RULE_SET) {
    const matches = rule.pattern.length <= argv.length
      && rule.pattern.every((element, index) => (Array.isArray(element) ? element.includes(argv[index]) : element === argv[index]));
    if (!matches) continue;
    if (decision === null || RESTRICTIVENESS[rule.decision] > RESTRICTIVENESS[decision]) decision = rule.decision;
  }
  return decision;
}

// --- Claude rule evaluation -----------------------------------------------
// `Bash(git push *)` is a prefix rule: it covers `git push` with or without
// arguments. Anything matched by no rule runs inside the Bash sandbox without a
// prompt, which is exactly what `autoAllowBashIfSandboxed` means.
function claudeMatcher(rule) {
  const inner = /^Bash\((.*)\)$/.exec(rule)?.[1];
  if (inner === undefined) return null;
  const escaped = inner.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, "[\\s\\S]*");
  const trailing = " [\\s\\S]*";
  const source = escaped.endsWith(trailing) ? `${escaped.slice(0, -trailing.length)}(?: [\\s\\S]*)?` : escaped;
  return new RegExp(`^${source}$`);
}

const CLAUDE_DENY_MATCHERS = CLAUDE_DENY.map(claudeMatcher).filter(Boolean);
const CLAUDE_ASK_MATCHERS = CLAUDE_ASK.map(claudeMatcher).filter(Boolean);

function claudeDecision(command) {
  if (CLAUDE_DENY_MATCHERS.some((matcher) => matcher.test(command))) return "deny";
  if (CLAUDE_ASK_MATCHERS.some((matcher) => matcher.test(command))) return "ask";
  return "sandboxed";
}

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
  assert.throws(() => mergeCodexConfig('[apps._default]\ndefault_tools_approval_mode = "never"\n'), /conflicts/);

  // Ordinary development runs without a prompt; nothing broader does.
  assert.equal(codexDecision(["git", "status", "--short"]), "allow");
  assert.equal(codexDecision(["git", "commit", "-m", "message"]), "allow");
  assert.equal(codexDecision(["npm", "run", "lint"]), "allow");
  assert.equal(codexDecision(["gh", "pr", "view", "42"]), "allow");
  assert.equal(codexDecision(["npm", "run", "deploy"]), null, "arbitrary package scripts must not be pre-approved");
  assert.equal(codexDecision(["curl", "https://example.test"]), null, "unclassified commands fall through to Codex's own approval policy");
  assert.doesNotMatch(CODEX_RULES, /\["npm", "run"\], decision = "allow"/);
  assert.equal(CODEX_RULE_SET.length, CODEX_RULES.split("\n").filter((line) => line.startsWith("prefix_rule(")).length);
});

test("Codex and Claude implement the same semantic categories from authorization.md", () => {
  for (const heading of ["### Runs without another prompt", "### Always ask first", "### Always refused"]) {
    assert.ok(authorization.includes(heading), `plugin/authorization.md is missing the ${heading} category`);
  }

  // One representative action per row, expressed once for each provider's
  // syntax. `category` is the semantic verdict authorization.md assigns.
  const matrix = [
    // Ordinary local development: automatic under both providers.
    { category: "automatic", argv: ["git", "status", "--short"], command: "git status --short" },
    { category: "automatic", argv: ["git", "diff", "--stat"], command: "git diff --stat" },
    { category: "automatic", argv: ["git", "log", "--oneline"], command: "git log --oneline" },
    { category: "automatic", argv: ["git", "worktree", "list"], command: "git worktree list" },
    { category: "automatic", argv: ["git", "add", "-A"], command: "git add -A" },
    { category: "automatic", argv: ["git", "commit", "-m", "message"], command: "git commit -m message" },
    { category: "automatic", argv: ["git", "switch", "-c", "adw/change/group"], command: "git switch -c adw/change/group" },
    { category: "automatic", argv: ["npm", "test"], command: "npm test" },
    { category: "automatic", argv: ["npm", "run", "build"], command: "npm run build" },
    { category: "automatic", argv: ["pytest", "-q"], command: "pytest -q" },
    { category: "automatic", argv: ["gh", "pr", "view", "42"], command: "gh pr view 42" },
    { category: "automatic", argv: ["gh", "run", "list"], command: "gh run list" },

    // External or destructive effects: a person decides, every time.
    { category: "external", argv: ["git", "push", "origin", "main"], command: "git push origin main" },
    { category: "external", argv: ["git", "tag", "v1.2.3"], command: "git tag v1.2.3" },
    { category: "external", argv: ["git", "branch", "-D", "adw/change/group"], command: "git branch -D adw/change/group" },
    { category: "external", argv: ["git", "worktree", "remove", "worktrees/group"], command: "git worktree remove worktrees/group" },
    { category: "external", argv: ["git", "worktree", "prune"], command: "git worktree prune" },
    { category: "external", argv: ["git", "rebase", "main"], command: "git rebase main" },
    { category: "external", argv: ["git", "merge", "feature"], command: "git merge feature" },
    { category: "external", argv: ["gh", "pr", "create", "--draft"], command: "gh pr create --draft" },
    { category: "external", argv: ["gh", "pr", "ready", "42"], command: "gh pr ready 42" },
    { category: "external", argv: ["gh", "issue", "comment", "7"], command: "gh issue comment 7" },
    { category: "external", argv: ["gh", "api", "repos/example/project"], command: "gh api repos/example/project" },
    { category: "external", argv: ["gh", "workflow", "run", "release.yml"], command: "gh workflow run release.yml" },
    { category: "external", argv: ["az", "repos", "pr", "create"], command: "az repos pr create" },

    // Refused outright by both providers.
    { category: "forbidden", argv: ["git", "push", "--force", "origin", "main"], command: "git push --force origin main" },
    { category: "forbidden", argv: ["git", "push", "--force-with-lease", "origin", "main"], command: "git push --force-with-lease origin main" },
    { category: "forbidden", argv: ["git", "push", "--mirror", "origin"], command: "git push --mirror origin" },
    { category: "forbidden", argv: ["git", "reset", "--hard", "HEAD~1"], command: "git reset --hard HEAD~1" },
    { category: "forbidden", argv: ["git", "clean", "-fd", "."], command: "git clean -fd ." },
    { category: "forbidden", argv: ["gh", "pr", "merge", "42"], command: "gh pr merge 42" },
    { category: "forbidden", argv: ["gh", "release", "create", "v1.2.3"], command: "gh release create v1.2.3" },
    { category: "forbidden", argv: ["npm", "publish", "--access", "public"], command: "npm publish --access public" },
    { category: "forbidden", argv: ["dotnet", "nuget", "push", "package.nupkg"], command: "dotnet nuget push package.nupkg" },
    { category: "forbidden", argv: ["kubectl", "apply", "-f", "deploy.yaml"], command: "kubectl apply -f deploy.yaml" },
    { category: "forbidden", argv: ["helm", "upgrade", "app", "chart"], command: "helm upgrade app chart" },
    { category: "forbidden", argv: ["terraform", "destroy", "-auto-approve"], command: "terraform destroy -auto-approve" },
    { category: "forbidden", argv: ["gh", "auth", "token"], command: "gh auth token" },
  ];

  const expectedCodex = { automatic: "allow", external: "prompt", forbidden: "forbidden" };
  const expectedClaude = { automatic: "sandboxed", external: "ask", forbidden: "deny" };
  for (const { category, argv, command } of matrix) {
    assert.equal(codexDecision(argv), expectedCodex[category], `Codex must treat \`${argv.join(" ")}\` as ${category}`);
    assert.equal(claudeDecision(command), expectedClaude[category], `Claude must treat \`${command}\` as ${category}`);
  }

  // Codex's engine matches a command prefix, so force options that trail the
  // recognized prefix only reach `prompt`. The managed container's root-owned
  // Git wrapper and the Claude hook close that gap; see the hook test below.
  assert.equal(codexDecision(["git", "push", "origin", "main", "--force"]), "prompt");
  assert.equal(claudeDecision("git push origin main --force"), "deny");
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
  for (const rule of CLAUDE_ASK) assert.ok(merged.permissions.ask.includes(rule), `ask rule dropped: ${rule}`);
  for (const rule of CLAUDE_DENY) assert.ok(merged.permissions.deny.includes(rule), `deny rule dropped: ${rule}`);
  for (const rule of CLAUDE_ALLOW) assert.ok(merged.permissions.allow.includes(rule), `allow rule dropped: ${rule}`);
  assert.deepEqual(merged.permissions.allow, ["mcp__docs__get_*", "WebSearch"]);
  assert.ok(!merged.permissions.allow.includes("mcp__*"));
  assert.ok(merged.permissions.deny.includes("Read(./.env)"), "credential files must stay unreadable");

  assert.throws(() => mergeClaudeSettings('{"permissions":{"defaultMode":"bypassPermissions"}}'), /conflicts/);
  assert.throws(() => mergeClaudeSettings('{"permissions":{"allow":["mcp__*"]}}'), /broad MCP allow/);
  assert.throws(() => mergeClaudeSettings('{"permissions":{"allow":[42]}}'), /allow entries must be strings/);
  assert.throws(
    () => mergeClaudeSettings('{"permissions":{"allow":["Bash(custom-tool *)","mcp__docs__get_*"]}}'),
    /contains Bash allow rules.*review and remove them explicitly.*Bash\(custom-tool \*\)/,
  );
  assert.throws(() => mergeClaudeSettings('{"sandbox":{"enabled":false}}'), /sandbox\.enabled=false conflicts/);
  assert.throws(() => mergeClaudeSettings('{"sandbox":{"autoAllowBashIfSandboxed":false}}'), /sandbox\.autoAllowBashIfSandboxed=false conflicts/);
  assert.throws(() => mergeClaudeSettings('{"sandbox":{"allowUnsandboxedCommands":true}}'), /allowUnsandboxedCommands=true conflicts/);
  assert.throws(() => mergeClaudeSettings('{"sandbox":{"excludedCommands":["curl"]}}'), /weakens/);
  assert.throws(() => mergeClaudeSettings('{"sandbox":{"enableWeakerNestedSandbox":true}}'), /weakens/);
  assert.throws(() => mergeClaudeSettings("not json"), /cannot merge/);

  const managed = JSON.parse(managedClaudeSettings());
  assert.deepEqual(managed.sandbox.network.allowedDomains, []);
  assert.equal(managed.sandbox.network.allowManagedDomainsOnly, undefined);
  assert.equal(managed.sandbox.network.strictAllowlist, true);
  assert.deepEqual(JSON.parse(managedClaudeSettings({ allowedDomains: ["b.test", "a.test", "a.test"] })).sandbox.network.allowedDomains, ["a.test", "b.test"]);
  assert.equal(JSON.parse(managedClaudeSettings({ webAccess: "public-pages" })).sandbox.network.allowManagedDomainsOnly, undefined);
  assert.equal(JSON.parse(managedClaudeSettings({ webAccess: "hosted-only" })).sandbox.network.allowManagedDomainsOnly, true);
  assert.throws(() => managedClaudeSettings({ webAccess: "unrestricted" }), /unsupported web access profile/);
  assert.equal(managed.hooks.PreToolUse.length, 2);
  assert.match(managed.hooks.PreToolUse[0].hooks[0].command, /adw-claude-permission-hook/);
  assert.match(managed.hooks.PreToolUse[1].matcher, /mcp__/);
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

test("the files carrying the permission profile cannot be rewritten without review", () => {
  const merged = JSON.parse(mergeClaudeSettings());
  for (const path of ["adw.yaml", ".claude/settings.json", ".codex/config.toml", ".codex/rules/adw.rules", ".devcontainer/**"]) {
    assert.ok(merged.permissions.ask.includes(`Edit(./${path})`), `${path} is editable without review`);
    assert.ok(merged.permissions.ask.includes(`Write(./${path})`), `${path} is writable without review`);
  }
  // The drift check compares a project's bytes against a fresh merge, so the
  // self-protection rules must survive re-merging unchanged.
  assert.equal(JSON.stringify(JSON.parse(mergeClaudeSettings(JSON.stringify(merged)))), JSON.stringify(merged));
  assert.ok(JSON.parse(managedClaudeSettings()).permissions.ask.includes("Edit(./adw.yaml)"));
});

test("both providers always get the full policy file set", () => {
  assert.deepEqual([...PERMISSION_FILES], [".codex/config.toml", ".codex/rules/adw.rules", ".claude/settings.json"]);
  const files = permissionProjectFiles();
  assert.deepEqual(files.map(({ path }) => path), [...PERMISSION_FILES]);
  assert.equal(files.find(({ path }) => path === ".codex/rules/adw.rules").content, CODEX_RULES);
  assert.equal(files.find(({ path }) => path === ".claude/settings.json").content, mergeClaudeSettings());

  // An existing policy file is preserved when it already matches and refused
  // when it has been edited underneath ADW.
  const current = new Map(files.map(({ path, content }) => [path, content]));
  assert.deepEqual(permissionProjectFiles((path) => current.get(path) ?? ""), files);
  assert.throws(() => permissionProjectFiles((path) => (path === ".codex/rules/adw.rules" ? "prefix_rule(pattern = [\"git\"], decision = \"allow\")\n" : "")), /adw\.rules differs/);
});

test("the permissions gate fails closed on drifted policy without inspecting the rest of the project", () => {
  const root = mkdtempSync(join(tmpdir(), "adw-permission-gate-"));
  const cliRun = () => spawnSync(process.execPath, [cli, "doctor", "--checks", "permissions", "--project-root", root], { encoding: "utf8" });

  // A directory with nothing but policy files: no Git repository, no adw.yaml,
  // no container. The gate must still reach a verdict.
  assert.deepEqual(permissionChecks(root).map(({ id, status }) => [id, status]), [["permissions:configuration", "fail"]]);

  for (const file of permissionProjectFiles()) {
    mkdirSync(join(root, dirname(file.path)), { recursive: true });
    writeFileSync(join(root, file.path), file.content);
  }
  assert.deepEqual(permissionChecks(root).map(({ id }) => id), ["permissions:configuration", "permissions:codex", "permissions:claude"]);
  assert.ok(permissionChecks(root).every(({ status }) => status === "pass"));

  const clean = cliRun();
  assert.equal(clean.status, 0, clean.stdout);
  const report = JSON.parse(clean.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.read_only, true);
  assert.deepEqual(report.checks.map(({ id }) => id), ["permissions:configuration", "permissions:codex", "permissions:claude"]);

  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  settings.permissions.deny = settings.permissions.deny.filter((rule) => !rule.includes("git push --force"));
  writeFileSync(join(root, ".claude/settings.json"), `${JSON.stringify(settings, null, 2)}\n`);
  assert.equal(permissionChecks(root).find(({ id }) => id === "permissions:claude").status, "fail");
  const drifted = cliRun();
  assert.equal(drifted.status, 5, "a failed check exits 5");
  assert.equal(JSON.parse(drifted.stdout).ok, false);
  assert.match(JSON.parse(drifted.stdout).checks.find(({ id }) => id === "permissions:claude").summary, /drifted/);

  writeFileSync(join(root, ".codex/rules/adw.rules"), CODEX_RULES.replace('prefix_rule(pattern = ["gh", "pr", "merge"], decision = "forbidden")\n', ""));
  assert.equal(permissionChecks(root).find(({ id }) => id === "permissions:codex").status, "fail");

  const rejected = spawnSync(process.execPath, [cli, "doctor", "--checks", "everything", "--project-root", root], { encoding: "utf8" });
  assert.equal(rejected.status, 2);
  assert.match(JSON.parse(rejected.stdout).error.message, /--checks must be all or permissions/);
});
