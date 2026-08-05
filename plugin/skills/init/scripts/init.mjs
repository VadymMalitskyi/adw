#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROUTING_START = "<!-- ADW:START -->";
const ROUTING_END = "<!-- ADW:END -->";
const IGNORE_START = "# ADW:START";
const IGNORE_END = "# ADW:END";
const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");

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
    else fail(`unknown argument: ${value}`);
  }
  if (!args.projectRoot) fail("--project-root is required");
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

function routingBlock() {
  return [
    ROUTING_START,
    "## ADW workflow routing",
    "",
    "Use the installed `adw` plugin for project workflows. Start with `adw:status` to reconstruct state, `adw:plan` for substantial changes, and `adw:quick` only for low-risk local changes. Keep ADW context and change records in the configured `worktrees/docs` checkout; do not copy plugin skills into this repository.",
    ROUTING_END,
  ].join("\n");
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
  const current = git(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
  return current.status === 0 ? current.stdout : "main";
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
  if (commands.length === 0) commands.push({
    command: "<unresolved>",
    source: "unresolved: no supported manifest or task-runner target proves a validation command",
    required: false,
  });
  return commands;
}

function discoverComponents(projectRoot) {
  const candidates = new Set();
  const rootPackage = join(projectRoot, "package.json");
  if (existsSync(rootPackage)) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(rootPackage, "utf8")); }
    catch (error) { throw new Error(`cannot inspect package.json: ${error.message}`); }
    const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
    for (const workspace of workspaces ?? []) {
      if (typeof workspace !== "string" || /[*?[\]{}]/.test(workspace)) continue;
      const target = resolve(projectRoot, workspace);
      if (target !== projectRoot && existsSync(target) && lstatSync(target).isDirectory()) candidates.add(relative(projectRoot, target));
    }
  }
  for (const parentName of ["apps", "packages", "services"]) {
    const parent = join(projectRoot, parentName);
    if (!existsSync(parent) || !lstatSync(parent).isDirectory() || lstatSync(parent).isSymbolicLink()) continue;
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const componentPath = `${parentName}/${entry.name}`;
      const componentRoot = join(projectRoot, componentPath);
      if (["package.json", "Makefile", "makefile", "pyproject.toml"].some((name) => existsSync(join(componentRoot, name)))) {
        candidates.add(componentPath);
      }
    }
  }
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

function projectConfiguration(projectRoot) {
  const components = discoverComponents(projectRoot);
  const commands = detectCommands(projectRoot);
  const lines = [
    "# ADW project configuration. Every executable command cites an observable source.",
    "schema: 2",
    "",
    "git:",
    `  default_branch: ${yamlScalar(defaultBranch(projectRoot))}`,
    "",
    "documentation:",
    "  mode: branch",
    "  branch: docs",
    "  worktree: worktrees/docs",
    "  sync_marker: SYNC.yaml",
    "  delivery: direct-push",
    "",
    "components:",
  ];
  for (const component of components) {
    lines.push(`  ${component.name}:`);
    lines.push(`    path: ${yamlScalar(component.path)}`);
    if (!(components.length === 1 && component.path === ".")) {
      lines.push("    validation:");
      lines.push("      default:");
      for (const item of component.commands) {
        lines.push(`        - command: ${yamlScalar(item.command)}`);
        lines.push(`          source: ${yamlScalar(item.source)}`);
        lines.push(`          required: ${item.required}`);
      }
    }
  }
  lines.push("");
  lines.push("validation:");
  lines.push("  default:");
  for (const item of commands) {
    lines.push(`    - command: ${yamlScalar(item.command)}`);
    lines.push(`      source: ${yamlScalar(item.source)}`);
    lines.push(`      required: ${item.required}`);
  }
  return `${lines.join("\n")}\n`;
}

function readOrEmpty(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function plannedFiles(projectRoot) {
  const files = [];
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    const path = join(projectRoot, name);
    const before = readOrEmpty(path);
    const after = replaceManagedBlock(before, ROUTING_START, ROUTING_END, routingBlock());
    files.push({ path: name, before, after, action: existsSync(path) ? "update-managed-block" : "create" });
  }
  const ignorePath = join(projectRoot, ".gitignore");
  const ignoreBefore = readOrEmpty(ignorePath);
  const ignoreAfter = replaceManagedBlock(ignoreBefore, IGNORE_START, IGNORE_END, ignoreBlock(ignoreBefore));
  files.push({ path: ".gitignore", before: ignoreBefore, after: ignoreAfter, action: existsSync(ignorePath) ? "update-managed-block" : "create" });
  const configPath = join(projectRoot, "adw.yaml");
  if (!existsSync(configPath)) files.push({ path: "adw.yaml", before: "", after: projectConfiguration(projectRoot), action: "create" });
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

function writeChangedFiles(projectRoot, files) {
  for (const file of files) {
    if (file.before === file.after) continue;
    const destination = join(projectRoot, file.path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, file.after, "utf8");
  }
}

function initializeDocs(projectRoot, plan) {
  const docsPath = join(projectRoot, plan.path);
  if (plan.action === "reuse") return;
  mkdirSync(dirname(docsPath), { recursive: true });
  if (plan.action === "attach") git(projectRoot, ["worktree", "add", docsPath, "docs"]);
  else git(projectRoot, ["worktree", "add", "--orphan", "-b", "docs", docsPath]);
  if (plan.action !== "create") return;
  const architecture = readFileSync(join(pluginRoot, "templates/architecture.md"), "utf8");
  const codeHead = git(projectRoot, ["rev-parse", "HEAD"], { allowFailure: true });
  const reviewedThrough = codeHead.status === 0 ? codeHead.stdout : "unresolved";
  const branch = defaultBranch(projectRoot);
  writeFileSync(join(docsPath, "README.md"), "# ADW project records\n\nKeep concise agent context and reviewable change records on this branch.\n", "utf8");
  writeFileSync(join(docsPath, "architecture.md"), architecture, "utf8");
  mkdirSync(join(docsPath, "components"), { recursive: true });
  mkdirSync(join(docsPath, "changes"), { recursive: true });
  writeFileSync(join(docsPath, "components/.gitkeep"), "", "utf8");
  writeFileSync(join(docsPath, "changes/.gitkeep"), "", "utf8");
  writeFileSync(join(docsPath, "SYNC.yaml"), `code_branch: ${yamlScalar(branch)}\nreviewed_through: ${yamlScalar(reviewedThrough)}\nupdated_at: null\n`, "utf8");
  git(projectRoot, ["add", "README.md", "architecture.md", "components/.gitkeep", "changes/.gitkeep", "SYNC.yaml"], { cwd: docsPath });
  git(projectRoot, ["commit", "-m", "Initialize ADW docs branch"], { cwd: docsPath });
}

function summarize(files, docs) {
  return {
    ok: true,
    writes: files.filter((file) => file.before !== file.after).map((file) => ({ path: file.path, action: file.action })),
    unchanged: files.filter((file) => file.before === file.after).map((file) => file.path),
    local_state: [".adw/local.yaml", ".adw/cache/"],
    docs,
    devcontainer: "untouched",
  };
}

try {
  const args = parseArguments(process.argv.slice(2));
  const projectRoot = assertProjectRoot(args.projectRoot);
  const files = plannedFiles(projectRoot);
  const docs = docsPlan(projectRoot);
  if (args.action === "preview") {
    process.stdout.write(`${JSON.stringify({ mode: "preview", ...summarize(files, docs) }, null, 2)}\n`);
  } else {
    // Ignore rules must exist before any local state or worktree is created.
    writeChangedFiles(projectRoot, files.filter((file) => file.path === ".gitignore"));
    mkdirSync(join(projectRoot, ".adw/cache"), { recursive: true });
    const localConfig = join(projectRoot, ".adw/local.yaml");
    if (!existsSync(localConfig)) writeFileSync(localConfig, [
      "# Machine-local ADW settings. This file is ignored by Git.",
      "# Credentials belong in provider clients or credential stores, never here.",
      "# integrations:",
      "#   work_tracker:",
      "#     transport: auto",
      "",
    ].join("\n"), "utf8");
    writeChangedFiles(projectRoot, files.filter((file) => file.path !== ".gitignore"));
    initializeDocs(projectRoot, docs);
    process.stdout.write(`${JSON.stringify({ mode: "apply", ...summarize(files, { ...docs, action: docs.action === "reuse" ? "reuse" : "ready" }) }, null, 2)}\n`);
  }
} catch (error) {
  fail(error.message);
}
