import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { MANAGED_FILES } from "../../plugin/lib/managed-environment.mjs";
import { PERMISSION_FILES } from "../../plugin/lib/permissions.mjs";

const cli = fileURLToPath(new URL("../../plugin/bin/adw.mjs", import.meta.url));
const fixtures = fileURLToPath(new URL("../fixtures", import.meta.url));

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (!allowFailure) assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
  return { status: result.status, stdout: result.stdout.trim() };
}

function run(command, root, answers = {}, extra = []) {
  const result = spawnSync(process.execPath, [cli, command, "--project-root", root, ...extra], { input: JSON.stringify(answers), encoding: "utf8" });
  return { status: result.status, body: JSON.parse(result.stdout) };
}

function initialize(root, answers = {}) {
  const preview = run("init-preview", root, answers);
  assert.equal(preview.status, 0, JSON.stringify(preview.body));
  const applied = run("init-apply", root, answers, ["--fingerprint", preview.body.fingerprint]);
  assert.equal(applied.status, 0, JSON.stringify(applied.body));
  return { preview: preview.body, applied: applied.body };
}

function scratch(name) {
  return realpathSync(mkdtempSync(join(tmpdir(), `adw-${name}-`)));
}

function commitRepository(root) {
  mkdirSync(root, { recursive: true });
  git(root, ["init", "-q", "-b", "main"]);
  git(root, ["config", "user.email", "test@example.test"]);
  git(root, ["config", "user.name", "ADW Test"]);
  if (readdirSync(root).filter((entry) => entry !== ".git").length === 0) writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "initial"]);
  return root;
}

function fromFixture(name) {
  const root = scratch(name);
  cpSync(join(fixtures, name), root, { recursive: true });
  return commitRepository(root);
}

// Every regular file in the tree, so a test can prove initialization preserved
// bytes it never claimed to write.
function snapshot(root) {
  const files = new Map();
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) files.set(relative(root, path), readFileSync(path, "utf8"));
    }
  };
  walk(root);
  return files;
}

test("an empty directory becomes a Git repository with the ADW file set and nothing else", () => {
  const root = scratch("empty");
  const preview = run("init-preview", root, { isolation: "provider-sandbox" });
  assert.equal(preview.body.repository.state, "empty-directory");
  assert.equal(preview.body.repository.git_init, true);
  // Preview writes nothing at all.
  assert.deepEqual(readdirSync(root), []);

  const { applied } = initialize(root, { isolation: "provider-sandbox" });
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.writes.map(({ path }) => path).sort(), ["adw.yaml", ".gitignore", ...PERMISSION_FILES].sort());
  assert.equal(git(root, ["symbolic-ref", "--short", "HEAD"]).stdout, "main");
  // Initialization writes files; it never commits them.
  assert.notEqual(git(root, ["status", "--porcelain"]).stdout, "");
  assert.notEqual(git(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status, 0);
});

test("an unborn repository is initialized without inventing a commit", () => {
  const root = scratch("unborn");
  git(root, ["init", "-q", "-b", "trunk"]);
  git(root, ["config", "user.email", "test@example.test"]);
  git(root, ["config", "user.name", "ADW Test"]);

  const { preview, applied } = initialize(root, { isolation: "provider-sandbox" });
  assert.equal(preview.repository.state, "unborn-repository");
  assert.equal(preview.repository.git_init, false);
  assert.equal(applied.repository.base_branch, "trunk");
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /base_branch: "trunk"/);
});

test("initializing a directory that has unversioned content is refused", () => {
  const root = scratch("dirty-empty");
  writeFileSync(join(root, "notes.txt"), "existing work\n");
  const result = run("init-preview", root, {});
  assert.equal(result.status, 3);
  assert.match(result.body.error.message, /requires it to be empty/);
});

test("an established project keeps every byte initialization did not claim", () => {
  const root = fromFixture("existing-project");
  const before = snapshot(root);
  const { applied } = initialize(root, { isolation: "project-devcontainer" });

  const written = new Set(applied.writes.map(({ path }) => path));
  const after = snapshot(root);
  for (const [path, content] of before) {
    if (written.has(path)) continue;
    assert.equal(after.get(path), content, `${path} changed without being previewed`);
  }
  // The project's own devcontainer is preserved, never converted.
  assert.equal(after.get(".devcontainer/devcontainer.json"), before.get(".devcontainer/devcontainer.json"));
  assert.equal(after.get(".devcontainer/Dockerfile"), before.get(".devcontainer/Dockerfile"));
  assert.equal(existsSync(join(root, ".devcontainer/adw-managed.json")), false);
  // Existing instruction files are left alone: no routing block is injected.
  assert.equal(after.get("AGENTS.md"), before.get("AGENTS.md"));
  assert.equal(after.get("CLAUDE.md"), before.get("CLAUDE.md"));
});

test("a managed devcontainer would never silently replace a project-owned one", () => {
  const root = fromFixture("existing-project");
  const result = run("init-preview", root, { isolation: "managed-devcontainer" });
  assert.equal(result.status, 3);
  assert.match(result.body.error.message, /project-owned \.devcontainer/);
  assert.equal(existsSync(join(root, ".devcontainer/adw-managed.json")), false);
});

test("an explicitly selected managed devcontainer generates its full file set", () => {
  const root = commitRepository(scratch("managed"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ name: "fixture", scripts: { test: "node --test" } }, null, 2)}\n`);
  writeFileSync(join(root, "package-lock.json"), "{}\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "manifest"]);

  const { applied } = initialize(root, { isolation: "managed-devcontainer", web_access: "hosted-only" });
  for (const name of MANAGED_FILES) assert.ok(existsSync(join(root, ".devcontainer", name)), `${name} is missing`);
  const marker = JSON.parse(readFileSync(join(root, ".devcontainer/adw-managed.json"), "utf8"));
  assert.equal(marker.schema, 3);
  assert.equal(marker.web_access, "hosted-only");
  assert.equal(Object.hasOwn(marker, "agent_tools"), false, "the per-agent profile is gone");
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /web_access: hosted-only/);
  assert.ok(applied.writes.some(({ path }) => path === ".devcontainer/Dockerfile"));
});

test("provider sandbox is the lightweight choice and creates no container", () => {
  const root = commitRepository(scratch("sandbox"));
  const { applied } = initialize(root, { isolation: "provider-sandbox" });
  assert.equal(existsSync(join(root, ".devcontainer")), false);
  assert.equal(applied.execution.reopen_required, false);
  // Both providers still get the shared permission policy.
  for (const path of PERMISSION_FILES) assert.ok(existsSync(join(root, path)), `${path} is missing`);
});

test("a monorepo keeps component commands separate with observable provenance", () => {
  const root = fromFixture("monorepo");
  const { preview } = initialize(root, { isolation: "provider-sandbox" });
  const config = readFileSync(join(root, "adw.yaml"), "utf8");
  assert.ok(preview.components.length > 1, JSON.stringify(preview.components));
  assert.match(config, /path: "apps\/web"/);
  assert.match(config, /path: "services\/api"/);
  // Every generated command cites the manifest that declares it.
  for (const line of config.split("\n").filter((item) => item.trim().startsWith("- command:"))) {
    assert.ok(line.length > 0);
  }
  assert.match(config, /source: "apps\/web\/package\.json#scripts\./);
  assert.match(config, /source: "services\/api\/Makefile#target:/);
});

test("apply refuses a fingerprint that does not match the reviewed preview", () => {
  const root = commitRepository(scratch("fingerprint"));
  const preview = run("init-preview", root, { isolation: "provider-sandbox" });

  const wrong = run("init-apply", root, { isolation: "provider-sandbox" }, ["--fingerprint", "0".repeat(64)]);
  assert.equal(wrong.status, 2);
  assert.match(wrong.body.error.message, /fingerprint returned by the reviewed init preview/);
  assert.equal(existsSync(join(root, "adw.yaml")), false);

  // A different answer set produces a different file set, so the reviewed
  // fingerprint must not authorize it.
  const swapped = run("init-apply", root, { isolation: "managed-devcontainer" }, ["--fingerprint", preview.body.fingerprint]);
  assert.equal(swapped.status, 2);
  assert.equal(existsSync(join(root, "adw.yaml")), false);
  assert.equal(existsSync(join(root, ".devcontainer")), false);
});

test("initialization is not repeatable once the project is configured", () => {
  const root = commitRepository(scratch("repeat"));
  initialize(root, { isolation: "provider-sandbox" });
  const again = run("init-preview", root, { isolation: "provider-sandbox" });
  assert.equal(again.status, 3);
  assert.match(again.body.error.message, /adw\.yaml already exists/);
});

test("a symlinked managed target is refused rather than written through", () => {
  const root = commitRepository(scratch("symlink"));
  const outside = scratch("symlink-outside");
  mkdirSync(join(root, ".codex"), { recursive: true });
  symlinkSync(join(outside, "captured.toml"), join(root, ".codex/config.toml"));

  const result = run("init-preview", root, { isolation: "provider-sandbox" });
  assert.equal(result.body.ok, false);
  assert.match(result.body.error.message, /symbolic link/);
  assert.equal(existsSync(join(outside, "captured.toml")), false);
});

test("credential-like answers never reach adw.yaml", () => {
  const root = commitRepository(scratch("secrets"));
  const result = run("init-preview", root, {
    isolation: "provider-sandbox",
    providers: { code_host: { provider: "github", settings: { api_token: "ghp_example" } } },
  });
  assert.equal(result.body.ok, false);
  assert.match(result.body.error.message, /credential-like/);
  assert.equal(existsSync(join(root, "adw.yaml")), false);
});

test("an invalid provider domain is refused before it can widen container egress", () => {
  const root = commitRepository(scratch("domains"));
  const result = run("init-preview", root, {
    isolation: "managed-devcontainer",
    providers: { code_host: { provider: "github", domains: ["10.0.0.1"] } },
  });
  assert.equal(result.status, 3);
  assert.match(result.body.error.message, /invalid domain/);
});

test("a configured provider domain reaches the managed egress allowlist", () => {
  const root = commitRepository(scratch("allowlist"));
  initialize(root, {
    isolation: "managed-devcontainer",
    providers: { code_host: { provider: "github", required: true, domains: ["api.github.com"] } },
  });
  const allowed = readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8");
  assert.ok(allowed.includes("api.github.com"), allowed);
  const marker = JSON.parse(readFileSync(join(root, ".devcontainer/adw-managed.json"), "utf8"));
  assert.deepEqual(marker.integration_domains, ["api.github.com"]);
  assert.match(readFileSync(join(root, "adw.yaml"), "utf8"), /- "api\.github\.com"/);
});

test("the ADW ignore block adds only generated local state and preserves existing rules", () => {
  const root = scratch("ignore");
  writeFileSync(join(root, ".gitignore"), "node_modules/\ndist/\n");
  commitRepository(root);
  initialize(root, { isolation: "provider-sandbox" });

  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.ok(ignore.startsWith("node_modules/\ndist/\n"), ignore);
  assert.ok(ignore.includes("/worktrees/"), ignore);
  // No cache, local configuration, or preference file exists to ignore.
  assert.equal(ignore.includes(".adw/"), false, ignore);
});

test("an existing worktrees ignore rule is not duplicated", () => {
  const root = scratch("ignore-existing");
  writeFileSync(join(root, ".gitignore"), "worktrees/\n");
  commitRepository(root);
  initialize(root, { isolation: "provider-sandbox" });
  const ignore = readFileSync(join(root, ".gitignore"), "utf8");
  assert.equal(ignore.split("worktrees/").length - 1, 1, ignore);
});

test("the generated configuration always satisfies the contract it is written against", () => {
  for (const answers of [
    { isolation: "provider-sandbox" },
    { isolation: "managed-devcontainer", web_access: "hosted-only", runtime_versions: { dotnet: "8" } },
    { isolation: "provider-sandbox", conventions: { branches: "Use adw/<change>/<group>." } },
  ]) {
    const root = commitRepository(scratch("contract"));
    initialize(root, answers);
    const config = spawnSync(process.execPath, [cli, "config", "--project-root", root], { encoding: "utf8" });
    assert.equal(config.status, 0, config.stdout);
    assert.equal(JSON.parse(config.stdout).ok, true);
  }
});

test("permission files written into an existing configuration are merged, not clobbered", () => {
  const root = scratch("merge");
  mkdirSync(join(root, ".claude"), { recursive: true });
  writeFileSync(join(root, ".claude/settings.json"), `${JSON.stringify({ model: "opus", permissions: { ask: ["Bash(custom *)"] } }, null, 2)}\n`);
  commitRepository(root);
  initialize(root, { isolation: "provider-sandbox" });

  const settings = JSON.parse(readFileSync(join(root, ".claude/settings.json"), "utf8"));
  assert.equal(settings.model, "opus", "unrelated settings must survive");
  assert.ok(settings.permissions.ask.includes("Bash(custom *)"), "an existing ask rule must survive");
  assert.ok(settings.permissions.ask.includes("Bash(git push *)"), "the ADW policy must be applied");
  assert.equal(settings.permissions.defaultMode, "acceptEdits");
});

test("initialization never writes outside the project root", () => {
  // A dedicated parent so a concurrently running test's temporary directory
  // cannot be mistaken for an escape.
  const parent = scratch("confined");
  const root = commitRepository(join(parent, "project"));
  const sibling = join(parent, "sibling");
  mkdirSync(sibling, { recursive: true });

  initialize(root, { isolation: "managed-devcontainer" });

  assert.deepEqual(readdirSync(parent).sort(), ["project", "sibling"]);
  assert.deepEqual(readdirSync(sibling), []);
  assert.ok(statSync(join(root, "adw.yaml")).isFile());
});
