#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverDevelopmentEnvironment, discoverProjectUnderstanding, managedDevelopmentFiles } from "./development-environment.mjs";
import {
  loadOnboarding,
  onboardingDigest,
  onboardingSummary,
} from "./onboarding.mjs";
import { renderLocalConfiguration } from "../../../lib/local-configuration.mjs";
import { applyAtomicWrites, parseYaml, validateProjectConfig } from "../../../lib/adw-helper.mjs";
import { permissionProjectFiles } from "../../../execution/managed-development.mjs";

const ROUTING_START = "<!-- ADW:START -->";
const ROUTING_END = "<!-- ADW:END -->";
const IGNORE_START = "# ADW:START";
const IGNORE_END = "# ADW:END";
const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");
const ISOLATION_MODES = new Set(["managed-devcontainer", "project-devcontainer", "provider-sandbox"]);
const CONVENTION_ORDER = ["branches", "pull_requests", "work_items"];

function fail(message) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const args = { action: "preview" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "preview" || value === "apply") args.action = value;
    else if (value === "--confirmed") args.confirmed = true;
    else if (value === "--project-root") args.projectRoot = argv[++index];
    else if (value === "--execution") args.execution = argv[++index];
    else if (value === "--onboarding") args.onboardingPath = argv[++index];
    else if (value === "--preview-digest") args.previewDigest = argv[++index];
    else fail(`unknown argument: ${value}`);
  }
  if (!args.projectRoot) fail("--project-root is required");
  if (args.execution && !ISOLATION_MODES.has(args.execution)) fail(`unsupported --execution isolation: ${args.execution}`);
  if (args.action === "apply" && !args.confirmed) fail("apply requires --confirmed after the user approves the preview");
  return args;
}

function git(projectRoot, arguments_, { allowFailure = false, cwd = projectRoot } = {}) {
  const result = spawnSync("git", arguments_, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`git ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function assertProjectRoot(input) {
  const root = realpathSync(input);
  const result = git(root, ["rev-parse", "--show-toplevel"]);
  const top = realpathSync(result.stdout);
  if (root !== top) throw new Error(`project root must be the Git top level: ${top}`);
  return root;
}

function replaceManagedBlock(original, start, end, body) {
  const startIndex = original.indexOf(start);
  const endIndex = original.indexOf(end);
  if ((startIndex === -1) !== (endIndex === -1)) throw new Error(`found an incomplete managed block (${start} ... ${end})`);
  if (startIndex !== -1) {
    if (original.indexOf(start, startIndex + start.length) !== -1 || original.indexOf(end, endIndex + end.length) !== -1) {
      throw new Error(`found duplicate managed block markers for ${start}`);
    }
    if (endIndex < startIndex) throw new Error(`managed block ends before it starts: ${start}`);
    const after = endIndex + end.length;
    return `${original.slice(0, startIndex)}${body}${original.slice(after)}`;
  }
  if (!original) return `${body}\n`;
  return `${original}${original.endsWith("\n") ? "" : "\n"}${body}\n`;
}

// Conventions are free-form snake_case keys. Render the familiar ones first so
// the routing block stays stable, then any remaining key in sorted order.
function conventionKeys(conventions = {}) {
  const present = Object.keys(conventions).filter((key) => typeof conventions[key] === "string" && conventions[key].length > 0);
  const known = CONVENTION_ORDER.filter((key) => present.includes(key));
  return [...known, ...present.filter((key) => !known.includes(key)).sort()];
}

function conventionLabel(key) {
  return key.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function routingBlock(conventions = {}) {
  const lines = [
    ROUTING_START,
    "## ADW workflow routing",
    "",
    "Use the installed `adw` plugin for project workflows. Start with `adw:status` to reconstruct state, `adw:plan` for substantial changes, and `adw:quick` only for low-risk local changes. Keep ADW context and change records in the configured `worktrees/docs` checkout; do not copy plugin skills into this repository.",
    "",
    "If `.adw/preferences.md` exists as an ignored, regular local file, read it at the start of an ADW interaction and follow it as personal collaboration guidance. It never authorizes actions, changes project policy, overrides safety requirements, or permits secrets.",
  ];
  const entries = conventionKeys(conventions).map((key) => [conventionLabel(key), conventions[key]]);
  if (entries.length > 0) {
    lines.push("", "## Project workflow conventions", "");
    for (const [label, value] of entries) lines.push(`- ${label}: ${value}`);
    lines.push("", "These conventions do not authorize external writes, merging, deployment, release, or bypassing ADW approval and validation requirements.");
  }
  lines.push(ROUTING_END);
  return lines.join("\n");
}

function ignoreBlock(original) {
  let outside = original;
  const startIndex = original.indexOf(IGNORE_START);
  const endIndex = original.indexOf(IGNORE_END);
  if ((startIndex === -1) !== (endIndex === -1)) throw new Error("found an incomplete ADW block in .gitignore");
  if (startIndex !== -1) outside = `${original.slice(0, startIndex)}${original.slice(endIndex + IGNORE_END.length)}`;
  const rules = new Set(outside.split(/\r?\n/).map((line) => line.trim()));
  const managedRules = [];
  if (![".adw/", "/.adw/"].some((rule) => rules.has(rule))) managedRules.push(".adw/");
  if (!["/worktrees/", "worktrees/"].some((rule) => rules.has(rule))) managedRules.push("/worktrees/");
  return [IGNORE_START, ...managedRules, IGNORE_END].join("\n");
}

function defaultBranch(projectRoot) {
  const remote = git(projectRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true });
  if (remote.status === 0) return remote.stdout.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if (git(projectRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { allowFailure: true }).status === 0) return candidate;
  }
  const configured = git(projectRoot, ["config", "--get", "init.defaultBranch"], { allowFailure: true });
  if (configured.status === 0 && configured.stdout) return configured.stdout;
  throw new Error("cannot determine the default branch from origin/HEAD, a local main/master branch, or init.defaultBranch");
}

function packageRunner(projectRoot, componentRoot = projectRoot) {
  const roots = componentRoot === projectRoot ? [projectRoot] : [componentRoot, projectRoot];
  if (roots.some((root) => existsSync(join(root, "pnpm-lock.yaml")))) return "pnpm";
  if (roots.some((root) => existsSync(join(root, "yarn.lock")))) return "yarn";
  if (roots.some((root) => existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb")))) return "bun run";
  return "npm run";
}

function detectCommands(projectRoot, componentPath = ".") {
  const commands = [];
  const componentRoot = resolve(projectRoot, componentPath);
  const packagePath = join(componentRoot, "package.json");
  if (existsSync(packagePath)) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(packagePath, "utf8")); }
    catch (error) { throw new Error(`cannot inspect package.json: ${error.message}`); }
    const runner = packageRunner(projectRoot, componentRoot);
    for (const name of ["lint", "typecheck", "check", "test", "build"]) {
      if (typeof manifest.scripts?.[name] === "string") {
        commands.push({ command: `${runner} ${name}`, source: `${relative(projectRoot, packagePath)}#scripts.${name}`, required: true });
      }
    }
  }
  const makePath = ["Makefile", "makefile"].map((name) => join(componentRoot, name)).find(existsSync);
  if (makePath) {
    const makeText = readFileSync(makePath, "utf8");
    for (const target of ["lint", "typecheck", "check", "test", "build"]) {
      if (new RegExp(`^${target}\\s*:`, "m").test(makeText) && !commands.some(({ command }) => command.endsWith(` ${target}`))) {
        commands.push({ command: `make ${target}`, source: `${relative(projectRoot, makePath)}#target:${target}`, required: true });
      }
    }
  }
  return commands;
}

function discoverComponents(projectRoot) {
  const candidates = new Set();
  const ignored = new Set([".git", ".adw", ".devcontainer", "node_modules", "worktrees", "dist", "build", "coverage", "vendor"]);
  const manifests = ["package.json", "Makefile", "makefile", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile"];
  function visit(directory, depth) {
    if (depth > 4) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const target = join(directory, entry.name);
      if (manifests.some((name) => existsSync(join(target, name))) || readdirSync(target).some((name) => /\.(?:csproj|fsproj|vbproj)$/.test(name))) candidates.add(relative(projectRoot, target));
      visit(target, depth + 1);
    }
  }
  visit(projectRoot, 0);
  if (candidates.size === 0) return [{ name: "app", path: ".", commands: detectCommands(projectRoot) }];
  const used = new Set();
  return [...candidates].sort().map((path) => {
    const base = path.split("/").at(-1).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component";
    let name = base;
    for (let suffix = 2; used.has(name); suffix += 1) name = `${base}-${suffix}`;
    used.add(name);
    return { name, path, commands: detectCommands(projectRoot, path) };
  });
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function appendProviders(lines, providers) {
  const entries = Object.entries(providers ?? {});
  if (entries.length === 0) return;
  lines.push("", "providers:");
  for (const [capability, declaration] of entries) {
    lines.push(`  ${capability}:`);
    lines.push(`    provider: ${yamlScalar(declaration.provider)}`);
    lines.push(`    required: ${declaration.required === true}`);
    for (const field of ["transport", "access"]) {
      if (declaration[field] !== undefined) lines.push(`    ${field}: ${yamlScalar(declaration[field])}`);
    }
    const settings = Object.entries(declaration.settings ?? {});
    if (settings.length > 0) {
      lines.push("    settings:");
      for (const [key, value] of settings) lines.push(`      ${yamlScalar(key)}: ${yamlScalar(value)}`);
    }
  }
}

function appendConventions(lines, conventions) {
  const keys = conventionKeys(conventions);
  if (keys.length === 0) return;
  lines.push("", "# Plain-language conventions. They never authorize an external write.", "conventions:");
  for (const key of keys) lines.push(`  ${key}: ${yamlScalar(conventions[key])}`);
}

// The 1.0 contract has no top-level validation block: a root component with
// `path: "."` owns the project-wide commands.
function projectComponents(projectRoot) {
  const discovered = discoverComponents(projectRoot);
  const rootCommands = detectCommands(projectRoot);
  const root = discovered.find(({ path }) => path === ".");
  if (root) {
    root.commands = rootCommands;
    return discovered;
  }
  if (rootCommands.length === 0) return discovered;
  const used = new Set(discovered.map(({ name }) => name));
  let name = "app";
  for (let suffix = 2; used.has(name); suffix += 1) name = `app-${suffix}`;
  return [{ name, path: ".", commands: rootCommands }, ...discovered];
}

function projectConfiguration(projectRoot, isolation, onboarding) {
  const components = projectComponents(projectRoot);
  const lines = [
    "# ADW project configuration. Every generated command cites an observable source.",
    "adw: 1",
    "",
    "git:",
    `  base_branch: ${yamlScalar(defaultBranch(projectRoot))}`,
    "",
    "docs:",
    "  branch: docs",
    "  worktree: worktrees/docs",
    "  sync_marker: SYNC.yaml",
    "",
    "execution:",
    `  mode: ${onboarding.execution.mode}`,
    `  isolation: ${isolation}`,
  ];
  // `web_access` bounds the generated container's egress; it is meaningless
  // outside the managed devcontainer, so it is not recorded there.
  if (isolation === "managed-devcontainer") lines.push(`  web_access: ${onboarding.webAccess}`);
  const runtimeVersions = Object.entries(onboarding.development?.runtimeVersions ?? {});
  if (runtimeVersions.length > 0) {
    lines.push("", "development:", "  runtime_versions:");
    for (const [runtime, version] of runtimeVersions) lines.push(`    ${runtime}: ${yamlScalar(version)}`);
  }
  lines.push("", "components:");
  for (const component of components) {
    lines.push(`  ${component.name}:`);
    lines.push(`    path: ${yamlScalar(component.path)}`);
    if (component.commands.length === 0) {
      lines.push("    validate: []");
      continue;
    }
    lines.push("    validate:");
    for (const item of component.commands) {
      lines.push(`      - command: ${yamlScalar(item.command)}`);
      lines.push(`        cwd: ${yamlScalar(component.path)}`);
      lines.push("        timeout_ms: 120000");
      lines.push(`        required: ${item.required}`);
      lines.push(`        source: ${yamlScalar(item.source)}`);
    }
  }
  appendProviders(lines, onboarding.providers);
  appendConventions(lines, onboarding.conventions);
  return `${lines.join("\n")}\n`;
}

function readOrEmpty(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function assertWritableProjectPath(projectRoot, relativePath) {
  let current = projectRoot;
  for (const part of relativePath.split("/")) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error(`${relativePath} cannot be managed through a symbolic link`);
  }
}

function resolveExecution(projectRoot, requested) {
  const containerDirectory = join(projectRoot, ".devcontainer");
  const containerConfig = join(containerDirectory, "devcontainer.json");
  const hasDirectory = existsSync(containerDirectory);
  const hasConfig = existsSync(containerConfig);
  // Security is proportional: preserve an existing project container, otherwise
  // stay on the lightweight provider sandbox. The generated managed container is
  // an explicit opt-in, never a prerequisite for adopting ADW.
  const isolation = requested ?? (hasConfig ? "project-devcontainer" : "provider-sandbox");
  if (hasDirectory && !hasConfig && isolation !== "provider-sandbox") {
    throw new Error(".devcontainer exists without devcontainer.json; resolve it or choose provider-sandbox explicitly");
  }
  if (isolation === "managed-devcontainer" && hasDirectory) {
    throw new Error("managed-devcontainer requires an absent .devcontainer directory; preserve the existing container with project-devcontainer or choose provider-sandbox");
  }
  if (isolation === "project-devcontainer" && !hasConfig) {
    throw new Error("project-devcontainer requires an existing .devcontainer/devcontainer.json");
  }
  return {
    isolation,
    action: isolation === "managed-devcontainer" ? "create" : isolation === "project-devcontainer" ? "preserve" : "none",
    required: isolation !== "provider-sandbox",
    reopen_required: isolation !== "provider-sandbox",
  };
}

function managedDevcontainerFiles(projectRoot, onboarding) {
  const templateRoot = join(pluginRoot, "templates/devcontainer");
  const generated = managedDevelopmentFiles(projectRoot, templateRoot, {
    agentTools: onboarding.agentTools,
    webAccess: onboarding.webAccess,
    integrationDomains: onboarding.networkDomains,
    runtimeVersions: onboarding.development?.runtimeVersions,
  });
  return [...generated.files].map(([name, content]) => ({
    path: `.devcontainer/${name}`,
    before: "",
    after: content,
    action: "create-managed-devcontainer",
  }));
}

function plannedFiles(projectRoot, execution, onboarding) {
  const files = [];
  const routingFiles = ["AGENTS.md", "CLAUDE.md"];
  for (const name of routingFiles) {
    const path = join(projectRoot, name);
    const before = readOrEmpty(path);
    const after = replaceManagedBlock(before, ROUTING_START, ROUTING_END, routingBlock(onboarding.conventions));
    files.push({ path: name, before, after, action: existsSync(path) ? "update-managed-block" : "create" });
  }
  const ignorePath = join(projectRoot, ".gitignore");
  const ignoreBefore = readOrEmpty(ignorePath);
  const ignoreAfter = replaceManagedBlock(ignoreBefore, IGNORE_START, IGNORE_END, ignoreBlock(ignoreBefore));
  files.push({ path: ".gitignore", before: ignoreBefore, after: ignoreAfter, action: existsSync(ignorePath) ? "update-managed-block" : "create" });
  const localPath = join(projectRoot, ".adw/local.yaml");
  const localBefore = readOrEmpty(localPath);
  const hasLocalAnswers = Object.keys(onboarding.local.identity).length > 0 || Object.keys(onboarding.local.providers).length > 0;
  if (existsSync(localPath) && hasLocalAnswers) throw new Error("onboarding local settings cannot replace an existing .adw/local.yaml; preserve or update it through a separate reviewed local change");
  const localAfter = existsSync(localPath) ? localBefore : renderLocalConfiguration(onboarding.local);
  files.push({ path: ".adw/local.yaml", before: localBefore, after: localAfter, action: existsSync(localPath) ? "preserve-local" : "create-local" });
  const preferencesPath = join(projectRoot, ".adw/preferences.md");
  const preferencesBefore = readOrEmpty(preferencesPath);
  const preferencesAfter = existsSync(preferencesPath)
    ? preferencesBefore
    : readFileSync(join(pluginRoot, "templates/preferences.md"), "utf8");
  files.push({ path: ".adw/preferences.md", before: preferencesBefore, after: preferencesAfter, action: existsSync(preferencesPath) ? "preserve-preferences" : "create-preferences" });
  const configPath = join(projectRoot, "adw.yaml");
  if (!existsSync(configPath)) {
    files.push({ path: "adw.yaml", before: "", after: projectConfiguration(projectRoot, execution.isolation, onboarding), action: "create" });
    for (const path of [".codex/config.toml", ".codex/rules/adw.rules", ".claude/settings.json"]) assertWritableProjectPath(projectRoot, path);
    for (const providerFile of permissionProjectFiles("both", (name) => readOrEmpty(join(projectRoot, name)))) {
      const before = readOrEmpty(join(projectRoot, providerFile.path));
      files.push({ path: providerFile.path, before, after: providerFile.content, action: before ? "merge-permission-policy" : "create-permission-policy" });
    }
    if (execution.isolation === "managed-devcontainer") files.push(...managedDevcontainerFiles(projectRoot, onboarding));
  }
  return files;
}

function worktreeRecords(projectRoot) {
  const output = git(projectRoot, ["worktree", "list", "--porcelain"]).stdout;
  const records = [];
  for (const paragraph of output.split(/\n\n+/)) {
    const record = {};
    for (const line of paragraph.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) record[line] = true;
      else record[line.slice(0, space)] = line.slice(space + 1);
    }
    if (record.worktree) records.push(record);
  }
  return records;
}

function docsPlan(projectRoot) {
  const target = resolve(projectRoot, "worktrees/docs");
  const records = worktreeRecords(projectRoot);
  const atTarget = records.find((record) => resolve(record.worktree) === target);
  if (atTarget) {
    if (atTarget.branch !== "refs/heads/docs") throw new Error("worktrees/docs is registered for a branch other than docs");
    return { action: "reuse", path: "worktrees/docs", branch: "docs" };
  }
  const elsewhere = records.find((record) => record.branch === "refs/heads/docs");
  if (elsewhere) throw new Error(`docs is already checked out at ${elsewhere.worktree}; move it to worktrees/docs manually`);
  if (existsSync(target) && statSync(target).isDirectory()) {
    throw new Error("worktrees/docs exists but is not a registered Git worktree; move or remove it before initialization");
  }
  const branchExists = git(projectRoot, ["show-ref", "--verify", "--quiet", "refs/heads/docs"], { allowFailure: true }).status === 0;
  return { action: branchExists ? "attach" : "create", path: "worktrees/docs", branch: "docs" };
}

async function writeChangedFiles(projectRoot, files) {
  const changed = files.filter((file) => file.before !== file.after);
  if (changed.length === 0) return;
  for (const file of changed) assertWritableProjectPath(projectRoot, file.path);
  await applyAtomicWrites(projectRoot, changed.map((file) => ({
    path: file.path,
    content: file.after,
    expected_content: existsSync(join(projectRoot, file.path)) ? file.before : null,
  })));
}

function initializeDocs(projectRoot, plan, understanding) {
  const docsPath = join(projectRoot, plan.path);
  if (plan.action === "reuse") return;
  mkdirSync(dirname(docsPath), { recursive: true });
  if (plan.action === "create") git(projectRoot, ["var", "GIT_AUTHOR_IDENT"]);
  if (plan.action === "attach") git(projectRoot, ["-c", "core.hooksPath=/dev/null", "worktree", "add", docsPath, "docs"]);
  else git(projectRoot, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--orphan", "-b", "docs", docsPath]);
  if (plan.action !== "create") return;
  const codeHead = git(projectRoot, ["rev-parse", "HEAD"], { allowFailure: true });
  const reviewedThrough = codeHead.status === 0 ? codeHead.stdout : "unresolved";
  const branch = defaultBranch(projectRoot);
  mkdirSync(join(docsPath, "components"), { recursive: true });
  mkdirSync(join(docsPath, "changes"), { recursive: true });
  for (const [path, content] of understanding.files) {
    const target = join(docsPath, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, "utf8");
  }
  if (![...understanding.files.keys()].some((path) => path.startsWith("components/"))) writeFileSync(join(docsPath, "components/.gitkeep"), "", "utf8");
  writeFileSync(join(docsPath, "changes/.gitkeep"), "", "utf8");
  writeFileSync(join(docsPath, "SYNC.yaml"), `code_branch: ${yamlScalar(branch)}\nreviewed_through: ${yamlScalar(reviewedThrough)}\nupdated_at: null\n`, "utf8");
  git(projectRoot, ["-c", "core.hooksPath=/dev/null", "add", "--all"], { cwd: docsPath });
  git(projectRoot, ["-c", "core.hooksPath=/dev/null", "commit", "-m", "Initialize ADW docs branch"], { cwd: docsPath });
}

function rollbackDocsInitialization(projectRoot, plan) {
  if (plan.action === "reuse") return;
  const docsPath = join(projectRoot, plan.path);
  git(projectRoot, ["worktree", "remove", "--force", docsPath], { allowFailure: true });
  if (existsSync(docsPath)) rmSync(docsPath, { recursive: true, force: true });
  git(projectRoot, ["worktree", "prune"], { allowFailure: true });
  if (plan.action === "create") git(projectRoot, ["branch", "-D", plan.branch], { allowFailure: true });
}

function previewDigest(projectRoot, files, docs, execution, onboarding, understanding) {
  const codeHead = git(projectRoot, ["rev-parse", "HEAD"], { allowFailure: true });
  const payload = {
    project_root: realpathSync(projectRoot),
    code_head: codeHead.status === 0 ? codeHead.stdout : null,
    files: files.map(({ path, action, before, after }) => ({ path, action, before, after })),
    docs,
    docs_files: [...understanding.files].map(([path, content]) => ({ path, content })),
    execution,
    onboarding_digest: onboardingDigest(onboarding),
  };
  return createHash("sha256").update("ADW-INIT-PREVIEW-V1\0").update(JSON.stringify(payload)).digest("hex");
}

function summarize(projectRoot, files, docs, execution, onboarding, developmentEnvironment, understanding) {
  const nextSteps = execution.reopen_required
    ? [
      "Review the preview, then commit the generated project files after approval.",
      "Rebuild and reopen the repository in its devcontainer so the isolated workspace can be created.",
      "Open the repository in its devcontainer. Project runtimes and manifest-backed dependencies install automatically after the outbound firewall is active.",
      "Authenticate Codex, Claude Code, and any configured provider tools when first used. Credentials stay in their project-scoped volumes.",
    ]
    : [
      "Review the preview, then commit the generated project files after approval.",
      "Run adw:doctor when readiness is uncertain. The selected isolation needs no container rebuild.",
      "Authenticate any configured provider tools when they are first used.",
    ];
  return {
    ok: true,
    writes: files.filter((file) => file.before !== file.after).map((file) => ({ path: file.path, action: file.action })),
    unchanged: files.filter((file) => file.before === file.after).map((file) => file.path),
    local_state: [".adw/local.yaml", ".adw/preferences.md", ".adw/cache/"],
    docs: { ...docs, generated_files: [...understanding.files.keys()], components: understanding.components.map(({ name, path }) => ({ name, path })) },
    execution: {
      ...execution,
      mode: onboarding.execution.mode,
      agent_tools: onboarding.agentTools,
      ...(execution.isolation === "managed-devcontainer" ? { web_access: onboarding.webAccess } : {}),
    },
    onboarding: onboardingSummary(onboarding),
    development_environment: developmentEnvironment,
    setup_guidance: {
      what_adw_is: "ADW helps a team plan, review, and safely carry out software changes with Codex and Claude Code.",
      preview_safety: "This preview has not changed the repository. Files are written only after your explicit approval.",
      why_information_is_needed: "ADW asks only for choices it cannot safely infer: how work should run, the workspace isolation, optional team services, and project conventions. Do not provide credentials in setup answers.",
      after_initialization: "Initialization creates project documentation, project configuration, and the selected workspace isolation. It does not authenticate tools or contact external services.",
    },
    next_steps: nextSteps,
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const projectRoot = assertProjectRoot(args.projectRoot);
  const onboarding = loadOnboarding(args.onboardingPath, pluginRoot);
  const existingConfig = existsSync(join(projectRoot, "adw.yaml"));
  if (existingConfig && (lstatSync(join(projectRoot, "adw.yaml")).isSymbolicLink() || !lstatSync(join(projectRoot, "adw.yaml")).isFile())) throw new Error("adw.yaml must be a regular non-symlink file");
  if (existingConfig && args.onboardingPath) throw new Error("onboarding cannot replace an existing adw.yaml; use an explicit reviewed configuration change");
  if (existingConfig && args.execution) throw new Error("--execution cannot replace an existing adw.yaml; use a separately reviewed manual replacement or infrastructure change");
  if (args.execution && onboarding.execution?.isolation && args.execution !== onboarding.execution.isolation) throw new Error("--execution conflicts with the onboarding isolation choice");
  const execution = existingConfig
    ? { isolation: "existing-configuration", action: "preserve", required: false, reopen_required: false }
    : resolveExecution(projectRoot, args.execution ?? onboarding.execution?.isolation);
  const files = plannedFiles(projectRoot, execution, onboarding);
  const developmentEnvironment = discoverDevelopmentEnvironment(projectRoot, { runtimeVersions: onboarding.development?.runtimeVersions });
  const understanding = discoverProjectUnderstanding(projectRoot, developmentEnvironment);
  const plannedConfig = files.find(({ path }) => path === "adw.yaml")?.after ?? readFileSync(join(projectRoot, "adw.yaml"), "utf8");
  const projectValidation = validateProjectConfig(parseYaml(plannedConfig, "adw.yaml"));
  if (!projectValidation.valid) throw new Error(`adw.yaml is invalid: ${projectValidation.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const docs = docsPlan(projectRoot);
  const approvedPreviewDigest = previewDigest(projectRoot, files, docs, execution, onboarding, understanding);
  if (args.action === "preview") {
    process.stdout.write(`${JSON.stringify({ mode: "preview", preview_digest: approvedPreviewDigest, ...summarize(projectRoot, files, docs, execution, onboarding, developmentEnvironment, understanding) }, null, 2)}\n`);
  } else {
    if (args.previewDigest !== approvedPreviewDigest) throw new Error("apply requires the exact --preview-digest shown for the reviewed initialization preview");
    try {
      initializeDocs(projectRoot, docs, understanding);
      mkdirSync(join(projectRoot, ".adw/cache"), { recursive: true });
      await writeChangedFiles(projectRoot, files);
    } catch (error) {
      rollbackDocsInitialization(projectRoot, docs);
      throw error;
    }
    process.stdout.write(`${JSON.stringify({ mode: "apply", preview_digest: approvedPreviewDigest, ...summarize(projectRoot, files, { ...docs, action: docs.action === "reuse" ? "reuse" : "ready" }, execution, onboarding, developmentEnvironment, understanding) }, null, 2)}\n`);
  }
} catch (error) {
  fail(error.message);
}
