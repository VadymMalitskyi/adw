// Confined initialization and managed-file refresh.
//
// Both flows are preview/apply pairs. The preview reports the exact bytes that
// would change and a fingerprint over them; apply refuses unless it is handed
// that fingerprint back, so a user can never approve one file set and have a
// different one written. The fingerprint is internal plumbing between the
// skill's two calls — nobody is asked to read or retype it.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ContractError, InputError, applyAtomicWrites, isObject, isSafeRelativePath, normalizeRelativePath } from "./safe-files.mjs";
import { DEFAULT_DOCS_BRANCH, DEFAULT_DOCS_WORKTREE, ISOLATION_MODES, RUNTIMES, WEB_ACCESS_MODES, isValidBranchName, isValidDomain, loadProjectConfig, parseYaml, providerDomains, validateProjectConfig } from "./config.mjs";
import { permissionProjectFiles } from "./permissions.mjs";
import { managedDevelopmentFiles } from "./managed-environment.mjs";

const IGNORE_START = "# ADW:START";
const IGNORE_END = "# ADW:END";
const STARTER_FILES = [
  { path: "AGENTS.md", template: "agents.md", action: "create-agent-instructions" },
  { path: "CLAUDE.md", template: "claude.md", action: "create-agent-instructions" },
  { path: ".adw/user.md", template: "user-profile.md", action: "create-user-profile" },
];
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const CAPABILITIES = new Set(["work_tracker", "code_host", "observability", "knowledge"]);

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (!allowFailure && result.status !== 0) throw new InputError(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return { status: result.status, stdout: (result.stdout ?? "").trim() };
}

// `existsSync` follows symbolic links, so a link pointing at a missing target
// would look absent. Every segment is inspected with `lstatSync` instead, so a
// managed path can never be written through a link.
function readOrEmpty(projectRoot, relativePath) {
  let current = projectRoot;
  let stat = null;
  for (const part of relativePath.split("/")) {
    current = join(current, part);
    try { stat = lstatSync(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      return "";
    }
    if (stat.isSymbolicLink()) throw new ContractError(`${relativePath} cannot be managed through a symbolic link`);
  }
  if (!stat.isFile()) throw new ContractError(`${relativePath} must be a regular file`);
  return readFileSync(current, "utf8");
}

// Empty directory, unborn repository, or established repository. One skill
// handles all three; only this classification differs.
export function repositoryState(directory) {
  const root = realpathSync(directory);
  if (!existsSync(join(root, ".git"))) {
    const entries = readdirSync(root);
    return { state: "empty-directory", root, needs_git_init: true, clean: entries.length === 0, entries: entries.sort() };
  }
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (realpathSync(top.stdout) !== root) throw new InputError(`project root must be the Git top level: ${top.stdout}`);
  const hasCommit = git(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status === 0;
  return { state: hasCommit ? "established" : "unborn-repository", root, needs_git_init: false, clean: true, entries: [] };
}

function detectedBaseBranch(projectRoot, state) {
  if (state === "empty-directory") {
    const configured = git(projectRoot, ["config", "--get", "init.defaultBranch"], { allowFailure: true });
    return configured.status === 0 && isValidBranchName(configured.stdout) ? configured.stdout : "main";
  }
  if (state === "unborn-repository") {
    // An unborn repository already has a branch name on HEAD. Honor it rather
    // than renaming the project's first branch behind the user's back.
    const unborn = git(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], { allowFailure: true });
    return unborn.status === 0 && isValidBranchName(unborn.stdout) ? unborn.stdout : "main";
  }
  const remote = git(projectRoot, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], { allowFailure: true });
  if (remote.status === 0) return remote.stdout.replace(/^origin\//, "");
  for (const candidate of ["main", "master"]) {
    if (git(projectRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${candidate}`], { allowFailure: true }).status === 0) return candidate;
  }
  const current = git(projectRoot, ["branch", "--show-current"], { allowFailure: true });
  if (current.status === 0 && isValidBranchName(current.stdout)) return current.stdout;
  return "main";
}

const DOCS_README = `# Documentation branch

This orphan branch carries the project's generated documentation and plans. It
shares no history with the code branches on purpose: documentation and plans
are rewritten far more often than code, and keeping them here leaves code
review to code.

- \`docs/\` — the architecture guide, component references, and their supporting
  pages, written by \`adw:generate-docs\` and reconciled by \`adw:sync-docs\`.
- \`plans/\` — one file per planned change, named
  \`<YYYY-MM-DD>-<abbreviation>-<short-description>.md\`.

It is checked out as a worktree so both branches are open at once. Nothing here
is authorization: a plan on this branch describes intended work, it never
approves it.
`;

// The docs branch is planned in preview and created in apply. It is not a file
// write, so it travels beside `writes` rather than inside it — but it is part
// of the fingerprint, so apply can never attach a worktree the user did not see.
function planDocsBranch(projectRoot, repository, docs) {
  const worktreePath = join(projectRoot, docs.worktree);
  const branchExists = !repository.needs_git_init
    && git(projectRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${docs.branch}`], { allowFailure: true }).status === 0;
  let attached = false;
  if (!repository.needs_git_init) {
    const list = git(projectRoot, ["worktree", "list", "--porcelain"], { allowFailure: true });
    attached = list.status === 0 && list.stdout.split(/\r?\n/).some((line) => line.startsWith("worktree ") && realpathOrSelf(line.slice("worktree ".length)) === realpathOrSelf(worktreePath));
  }
  if (!attached && existsSync(worktreePath) && readdirSync(worktreePath).length > 0) {
    throw new ContractError(`${docs.worktree} already exists and is not an attached worktree; move it aside or choose another docs.worktree`);
  }
  return {
    branch: docs.branch,
    worktree: docs.worktree,
    branch_action: branchExists ? "existing" : "create-orphan",
    worktree_action: attached ? "already-attached" : "attach",
  };
}

function realpathOrSelf(path) {
  try { return realpathSync(path); }
  catch { return resolve(path); }
}

// Builds the branch's first commit through Git's object database rather than
// the index, so creating it never touches the checked-out working tree.
function createDocsBranch(projectRoot, docs) {
  const identity = {};
  for (const [field, fallback] of [["name", "ADW"], ["email", "adw@localhost"]]) {
    if (git(projectRoot, ["config", "--get", `user.${field}`], { allowFailure: true }).status !== 0) {
      identity[`GIT_AUTHOR_${field.toUpperCase()}`] = fallback;
      identity[`GIT_COMMITTER_${field.toUpperCase()}`] = fallback;
    }
  }
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: projectRoot, encoding: "utf8", input: DOCS_README });
  if (blob.status !== 0) throw new ContractError(`cannot write the docs branch README: ${(blob.stderr || blob.stdout).trim()}`);
  const tree = spawnSync("git", ["mktree"], { cwd: projectRoot, encoding: "utf8", input: `100644 blob ${blob.stdout.trim()}\tREADME.md\n` });
  if (tree.status !== 0) throw new ContractError(`cannot build the docs branch tree: ${(tree.stderr || tree.stdout).trim()}`);
  const commit = spawnSync("git", ["commit-tree", tree.stdout.trim(), "-m", "Start the ADW documentation branch"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, ...identity, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (commit.status !== 0) throw new ContractError(`cannot commit the docs branch root: ${(commit.stderr || commit.stdout).trim()}`);
  git(projectRoot, ["branch", docs.branch, commit.stdout.trim()]);
}

function applyDocsBranch(projectRoot, plan) {
  mkdirSync(join(projectRoot, "worktrees"), { recursive: true });
  if (plan.branch_action === "create-orphan") createDocsBranch(projectRoot, plan);
  if (plan.worktree_action === "attach") git(projectRoot, ["worktree", "add", plan.worktree, plan.branch]);
  mkdirSync(join(projectRoot, plan.worktree, "plans"), { recursive: true });
}

function packageRunner(projectRoot, componentRoot) {
  const roots = componentRoot === projectRoot ? [projectRoot] : [componentRoot, projectRoot];
  if (roots.some((root) => existsSync(join(root, "pnpm-lock.yaml")))) return "pnpm";
  if (roots.some((root) => existsSync(join(root, "yarn.lock")))) return "yarn";
  if (roots.some((root) => existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb")))) return "bun run";
  return "npm run";
}

// Validation commands are only ever taken from the project's own manifests, so
// every generated command cites the file that declares it.
function detectCommands(projectRoot, componentPath = ".") {
  const commands = [];
  const componentRoot = resolve(projectRoot, componentPath);
  const packagePath = join(componentRoot, "package.json");
  if (existsSync(packagePath)) {
    let manifest;
    try { manifest = JSON.parse(readFileSync(packagePath, "utf8")); }
    catch (error) { throw new ContractError(`cannot inspect package.json: ${error.message}`); }
    const runner = packageRunner(projectRoot, componentRoot);
    for (const name of ["lint", "typecheck", "check", "test", "build"]) {
      if (typeof manifest.scripts?.[name] === "string") {
        commands.push({ command: `${runner} ${name}`, source: `${relative(projectRoot, packagePath)}#scripts.${name}` });
      }
    }
  }
  const makePath = ["Makefile", "makefile"].map((name) => join(componentRoot, name)).find(existsSync);
  if (makePath) {
    const makeText = readFileSync(makePath, "utf8");
    for (const target of ["lint", "typecheck", "check", "test", "build"]) {
      if (new RegExp(`^${target}\\s*:`, "m").test(makeText) && !commands.some(({ command }) => command.endsWith(` ${target}`))) {
        commands.push({ command: `make ${target}`, source: `${relative(projectRoot, makePath)}#target:${target}` });
      }
    }
  }
  return commands;
}

export function detectComponents(projectRoot) {
  const candidates = new Set();
  const ignored = new Set([".git", ".adw", ".devcontainer", "node_modules", "worktrees", "dist", "build", "coverage", "vendor"]);
  const manifests = ["package.json", "Makefile", "makefile", "pyproject.toml", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile"];
  function visit(directory, depth) {
    if (depth > 4) return;
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || ignored.has(entry.name)) continue;
      const target = join(directory, entry.name);
      if (manifests.some((name) => existsSync(join(target, name))) || readdirSync(target).some((name) => /\.(?:csproj|fsproj|vbproj)$/.test(name))) candidates.add(relative(projectRoot, target));
      visit(target, depth + 1);
    }
  }
  visit(projectRoot, 0);
  const rootCommands = detectCommands(projectRoot);
  const used = new Set();
  const nested = [...candidates].sort().map((path) => {
    const base = path.split("/").at(-1).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "component";
    let name = base;
    for (let suffix = 2; used.has(name); suffix += 1) name = `${base}-${suffix}`;
    used.add(name);
    return { name, path, validate: detectCommands(projectRoot, path) };
  });
  if (nested.length === 0 || rootCommands.length > 0) {
    let name = "app";
    for (let suffix = 2; used.has(name); suffix += 1) name = `app-${suffix}`;
    return [{ name, path: ".", validate: rootCommands }, ...nested];
  }
  return nested;
}

function yamlScalar(value) {
  return JSON.stringify(String(value));
}

function renderProjectConfig({ baseBranch, docs, isolation, webAccess, runtimeVersions, components, providers, includeGit, includeDocs, includeComponents }) {
  const lines = [
    "# ADW project policy. Omit a setting to use repository discovery or ADW's safe default.",
    "adw: 1",
  ];
  if (includeGit) {
    lines.push("", "git:", `  base_branch: ${yamlScalar(baseBranch)}`);
  }
  if (includeDocs) {
    lines.push("", "docs:", `  branch: ${yamlScalar(docs.branch)}`, `  worktree: ${yamlScalar(docs.worktree)}`);
  }
  // `web_access` bounds the generated container's egress; it means nothing
  // outside the managed devcontainer, so it is recorded only there.
  if (isolation !== "provider-sandbox" || webAccess !== "public-pages") {
    lines.push("", "execution:", `  isolation: ${isolation}`);
    if (isolation === "managed-devcontainer") lines.push(`  web_access: ${webAccess}`);
  }
  const runtimes = Object.entries(runtimeVersions);
  if (runtimes.length > 0) {
    lines.push("", "development:", "  runtime_versions:");
    for (const [runtime, version] of runtimes) lines.push(`    ${runtime}: ${yamlScalar(version)}`);
  }
  if (includeComponents) {
    lines.push("", "components:");
    for (const component of components) {
      lines.push(`  ${component.name}:`);
      lines.push(`    path: ${yamlScalar(component.path)}`);
      if (component.validate.length === 0) {
        lines.push("    validate: []");
        continue;
      }
      lines.push("    validate:");
      for (const item of component.validate) {
        lines.push(`      - command: ${yamlScalar(item.command)}`);
        lines.push(`        cwd: ${yamlScalar(component.path)}`);
        if (item.source) lines.push(`        source: ${yamlScalar(item.source)}`);
      }
    }
  }
  const providerEntries = Object.entries(providers);
  if (providerEntries.length > 0) {
    lines.push("", "providers:");
    for (const [capability, declaration] of providerEntries) {
      lines.push(`  ${capability}:`);
      lines.push(`    provider: ${yamlScalar(declaration.provider)}`);
      lines.push(`    required: ${declaration.required === true}`);
      for (const field of ["transport", "access"]) {
        if (declaration[field] !== undefined) lines.push(`    ${field}: ${yamlScalar(declaration[field])}`);
      }
      if ((declaration.domains ?? []).length > 0) {
        lines.push("    domains:");
        for (const domain of declaration.domains) lines.push(`      - ${yamlScalar(domain)}`);
      }
      const settings = Object.entries(declaration.settings ?? {});
      if (settings.length > 0) {
        lines.push("    settings:");
        for (const [key, value] of settings) lines.push(`      ${yamlScalar(key)}: ${yamlScalar(value)}`);
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

// The project-local profile is private context, not shared configuration. It
// remains in the workspace so a managed devcontainer can read it without
// mounting the host home directory.
function ignoreBlock(original) {
  let outside = original;
  const startIndex = original.indexOf(IGNORE_START);
  const endIndex = original.indexOf(IGNORE_END);
  if ((startIndex === -1) !== (endIndex === -1)) throw new ContractError("found an incomplete ADW block in .gitignore");
  if (startIndex !== -1) {
    if (endIndex < startIndex) throw new ContractError("the ADW .gitignore block ends before it starts");
    outside = `${original.slice(0, startIndex)}${original.slice(endIndex + IGNORE_END.length)}`;
  }
  const rules = new Set(outside.split(/\r?\n/).map((line) => line.trim()));
  const managed = [];
  if (!["/worktrees/", "worktrees/"].some((rule) => rules.has(rule))) managed.push("/worktrees/");
  if (!["/.adw/user.md", ".adw/user.md"].some((rule) => rules.has(rule))) managed.push("/.adw/user.md");
  return [IGNORE_START, ...managed, IGNORE_END].join("\n");
}

function replaceManagedBlock(original, start, end, body) {
  const startIndex = original.indexOf(start);
  const endIndex = original.indexOf(end);
  if ((startIndex === -1) !== (endIndex === -1)) throw new ContractError(`found an incomplete managed block (${start} ... ${end})`);
  if (startIndex !== -1) {
    if (original.indexOf(start, startIndex + start.length) !== -1 || original.indexOf(end, endIndex + end.length) !== -1) {
      throw new ContractError(`found duplicate managed block markers for ${start}`);
    }
    if (endIndex < startIndex) throw new ContractError(`managed block ends before it starts: ${start}`);
    return `${original.slice(0, startIndex)}${body}${original.slice(endIndex + end.length)}`;
  }
  if (!original) return `${body}\n`;
  return `${original}${original.endsWith("\n") ? "" : "\n"}${body}\n`;
}

function checkAnswers(answers) {
  if (!isObject(answers)) throw new InputError("answers must be a JSON object");
  for (const key of Object.keys(answers)) {
    if (!["isolation", "web_access", "base_branch", "docs", "runtime_versions", "components", "providers"].includes(key)) {
      throw new InputError(`unsupported answer field: ${key}`);
    }
  }
  const isolation = answers.isolation;
  if (isolation !== undefined && !ISOLATION_MODES.includes(isolation)) throw new ContractError(`isolation must be one of: ${ISOLATION_MODES.join(", ")}`);
  const webAccess = answers.web_access ?? "public-pages";
  if (!WEB_ACCESS_MODES.includes(webAccess)) throw new ContractError(`web_access must be one of: ${WEB_ACCESS_MODES.join(", ")}`);
  if (answers.base_branch !== undefined && !isValidBranchName(answers.base_branch)) throw new ContractError("base_branch must be a valid Git branch name");
  const rawDocs = answers.docs ?? {};
  if (!isObject(rawDocs)) throw new ContractError("docs must be a mapping object with optional branch and worktree");
  for (const key of Object.keys(rawDocs)) {
    if (!["branch", "worktree"].includes(key)) throw new ContractError(`unsupported docs field: ${key}`);
  }
  if (rawDocs.branch !== undefined && !isValidBranchName(rawDocs.branch)) throw new ContractError("docs.branch must be a valid Git branch name");
  if (rawDocs.worktree !== undefined && !isSafeRelativePath(rawDocs.worktree)) throw new ContractError("docs.worktree must be a project-relative path");
  const docs = {
    branch: rawDocs.branch ?? DEFAULT_DOCS_BRANCH,
    worktree: rawDocs.worktree === undefined ? DEFAULT_DOCS_WORKTREE : normalizeRelativePath(rawDocs.worktree),
  };
  if (!docs.worktree.startsWith("worktrees/")) throw new ContractError("docs.worktree must live under worktrees/, the path ADW keeps ignored on the base branch");
  const runtimeVersions = answers.runtime_versions ?? {};
  if (!isObject(runtimeVersions)) throw new ContractError("runtime_versions must be a mapping object");
  for (const [name, version] of Object.entries(runtimeVersions)) {
    if (!RUNTIMES.includes(name)) throw new ContractError(`unsupported runtime: ${name}`);
    if (typeof version !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(version)) throw new ContractError(`runtime version for ${name} must be numeric`);
  }
  const providers = answers.providers ?? {};
  if (!isObject(providers)) throw new ContractError("providers must be a mapping object");
  for (const [capability, declaration] of Object.entries(providers)) {
    if (!CAPABILITIES.has(capability)) throw new ContractError(`unsupported provider capability: ${capability}`);
    if (!isObject(declaration)) throw new ContractError(`provider ${capability} must be a mapping object`);
    for (const domain of declaration.domains ?? []) {
      if (!isValidDomain(domain)) throw new ContractError(`provider ${capability} declares an invalid domain: ${String(domain)}`);
    }
  }
  let components = answers.components;
  if (components !== undefined) {
    if (!Array.isArray(components) || components.length === 0) throw new ContractError("components must be a non-empty array");
    components = components.map((component) => {
      if (!isObject(component) || !IDENTIFIER.test(component.name ?? "")) throw new ContractError("each component requires a lowercase name");
      if (component.path !== "." && !isSafeRelativePath(component.path)) throw new ContractError(`component ${component.name} requires a project-relative path`);
      return { name: component.name, path: component.path, validate: (component.validate ?? []).map((item) => (typeof item === "string" ? { command: item } : item)) };
    });
  }
  return { isolation, webAccess, runtimeVersions, providers, components, docs, docsExplicit: answers.docs !== undefined, baseBranch: answers.base_branch };
}

// Preserve an existing project-owned container; never silently convert it.
function checkIsolation(projectRoot, isolation) {
  const containerDirectory = join(projectRoot, ".devcontainer");
  const containerConfig = join(containerDirectory, "devcontainer.json");
  const hasDirectory = existsSync(containerDirectory);
  const hasConfig = existsSync(containerConfig);
  const managedMarker = existsSync(join(containerDirectory, "adw-managed.json"));
  if (isolation === "managed-devcontainer" && hasDirectory && !managedMarker) {
    throw new ContractError("managed-devcontainer would replace a project-owned .devcontainer; keep it with project-devcontainer, or remove it deliberately first");
  }
  if (isolation === "project-devcontainer" && !hasConfig) throw new ContractError("project-devcontainer requires an existing .devcontainer/devcontainer.json");
  return {
    isolation,
    container: isolation === "managed-devcontainer" ? (managedMarker ? "refresh-managed" : "create-managed") : isolation === "project-devcontainer" ? "preserve-project-owned" : "none",
    reopen_required: isolation !== "provider-sandbox",
  };
}

// Init should create the strongest practical boundary by default. A repository
// that already owns a devcontainer is the exception: preserve it rather than
// replacing it with ADW's generated one.
function defaultInitializationIsolation(projectRoot) {
  return existsSync(join(projectRoot, ".devcontainer", "devcontainer.json"))
    ? "project-devcontainer"
    : "managed-devcontainer";
}

function fingerprint(domain, payload) {
  return createHash("sha256").update(`${domain}\0`).update(JSON.stringify(payload)).digest("hex");
}

function pluginRoot() {
  return resolve(fileURLToPath(import.meta.url), "../..");
}

function pluginVersion() {
  const version = JSON.parse(readFileSync(join(pluginRoot(), ".codex-plugin/plugin.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new ContractError("installed plugin manifest has an invalid semantic version");
  return version;
}

function managedFiles(projectRoot, { webAccess, integrationDomains, runtimeVersions, permissionPolicy }) {
  const generated = managedDevelopmentFiles(projectRoot, join(pluginRoot(), "templates/devcontainer"), {
    webAccess,
    integrationDomains,
    runtimeVersions,
    permissionPolicy,
    pluginVersion: pluginVersion(),
  });
  return { requirements: generated.requirements, files: [...generated.files].map(([name, content]) => ({ path: `.devcontainer/${name}`, content })) };
}

// Agent instructions and the private profile are seeded only when they are
// absent, so init never overwrites what a project or a person already wrote.
// Nothing refreshes or repairs them afterwards: from here they are owned by the
// repository and by whoever works in this checkout.
function starterFiles(projectRoot, docs) {
  const values = { project: basename(projectRoot), docs_branch: docs.branch, docs_worktree: docs.worktree };
  return STARTER_FILES
    .filter(({ path }) => !existsSync(join(projectRoot, path)))
    .map(({ path, template, action }) => {
      const source = readFileSync(join(pluginRoot(), "templates", template), "utf8");
      const content = Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, value), source);
      if (content.includes("{{")) throw new ContractError(`the ${template} template has a placeholder this project cannot fill`);
      return { path, action, content };
    });
}

export function planInitialization(directory, rawAnswers = {}) {
  const answers = checkAnswers(rawAnswers);
  const repository = repositoryState(directory);
  const projectRoot = repository.root;
  if (repository.state === "empty-directory" && !repository.clean) {
    throw new ContractError(`initializing an unversioned directory requires it to be empty; found: ${repository.entries.join(", ")}`);
  }
  const execution = checkIsolation(projectRoot, answers.isolation ?? defaultInitializationIsolation(projectRoot));
  const baseBranch = answers.baseBranch ?? detectedBaseBranch(projectRoot, repository.state);
  if (answers.docs.branch === baseBranch) throw new ContractError(`docs.branch must differ from the base branch (${baseBranch})`);
  const docs = planDocsBranch(projectRoot, repository, answers.docs);
  const components = answers.components ?? detectComponents(projectRoot);

  const files = [];
  const add = (path, after, action) => {
    const before = readOrEmpty(projectRoot, path);
    files.push({ path, before, after, action });
  };

  if (existsSync(join(projectRoot, "adw.yaml"))) {
    throw new ContractError("adw.yaml already exists; edit the shared project policy deliberately, then run adw:doctor for generated-file repair");
  }
  // This file is both the shared policy and the durable activation marker.
  // Even a project that uses only inferred defaults needs the minimal
  // `adw: 1` contract so an installed plugin cannot mistake an arbitrary
  // repository for an initialized ADW project.
  add("adw.yaml", renderProjectConfig({
    baseBranch,
    docs: answers.docs,
    isolation: execution.isolation,
    webAccess: answers.webAccess,
    runtimeVersions: answers.runtimeVersions,
    components: answers.components ?? components,
    providers: answers.providers,
    includeGit: answers.baseBranch !== undefined,
    includeDocs: answers.docsExplicit,
    includeComponents: answers.components !== undefined,
  }), "create-project-policy");

  for (const file of permissionProjectFiles((path) => readOrEmpty(projectRoot, path))) {
    const before = readOrEmpty(projectRoot, file.path);
    files.push({ path: file.path, before, after: file.content, action: before ? "merge-permission-policy" : "create-permission-policy" });
  }

  for (const file of starterFiles(projectRoot, answers.docs)) add(file.path, file.content, file.action);

  let requirements = null;
  if (execution.isolation === "managed-devcontainer") {
    const integrationDomains = [...new Set(Object.values(answers.providers).flatMap(({ domains }) => domains ?? []))].sort();
    const generated = managedFiles(projectRoot, { webAccess: answers.webAccess, integrationDomains, runtimeVersions: answers.runtimeVersions });
    requirements = generated.requirements;
    for (const file of generated.files) add(file.path, file.content, "create-managed-devcontainer");
  }

  const ignoreBefore = readOrEmpty(projectRoot, ".gitignore");
  const ignoreAfter = replaceManagedBlock(ignoreBefore, IGNORE_START, IGNORE_END, ignoreBlock(ignoreBefore));
  files.push({ path: ".gitignore", before: ignoreBefore, after: ignoreAfter, action: ignoreBefore ? "update-managed-block" : "create" });

  const policy = files.find(({ path }) => path === "adw.yaml");
  if (policy) {
    const config = validateProjectConfig(parseYaml(policy.after, "adw.yaml"));
    if (!config.valid) throw new ContractError(`generated adw.yaml is invalid: ${config.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  }

  const writes = files.filter((file) => file.before !== file.after);
  return {
    project_root: projectRoot,
    repository: { state: repository.state, git_init: repository.needs_git_init, base_branch: baseBranch },
    docs,
    execution,
    components: components.map(({ name, path, validate }) => ({ name, path, commands: validate.length })),
    writes: writes.map(({ path, action }) => ({ path, action })),
    unchanged: files.filter((file) => file.before === file.after).map(({ path }) => path),
    unresolved: requirements?.unresolved ?? [],
    runtime_versions: requirements?.selected_versions ?? answers.runtimeVersions,
    fingerprint: fingerprint("ADW-INIT-V1", {
      project_root: projectRoot,
      repository: repository.state,
      git_init: repository.needs_git_init,
      docs,
      files: files.map(({ path, action, before, after }) => ({ path, action, before, after })),
    }),
    files,
  };
}

export async function applyInitialization(directory, rawAnswers, expectedFingerprint) {
  const plan = planInitialization(directory, rawAnswers);
  if (plan.fingerprint !== expectedFingerprint) throw new InputError("apply requires the fingerprint returned by the reviewed init preview");
  if (plan.repository.git_init) git(plan.project_root, ["init", "-q", "-b", plan.repository.base_branch]);
  const changed = plan.files.filter((file) => file.before !== file.after);
  if (changed.length > 0) {
    await applyAtomicWrites(plan.project_root, changed.map((file) => ({
      path: file.path,
      content: file.after,
      expected_content: file.before === "" && !existsSync(join(plan.project_root, file.path)) ? null : file.before,
    })));
  }
  // Last, so a failure here cannot leave the reviewed file set half-written.
  applyDocsBranch(plan.project_root, plan.docs);
  const { files, ...summary } = plan;
  return { ...summary, applied: true };
}

// Only ADW-owned files are refreshed. Application code, project-owned
// containers, and `adw.yaml` itself are never rewritten here.
export function planRefresh(directory, config) {
  const projectRoot = realpathSync(directory);
  const files = [];
  for (const file of permissionProjectFiles((path) => readOrEmpty(projectRoot, path), { repairManagedRules: true, policy: config.permissions })) {
    const before = readOrEmpty(projectRoot, file.path);
    files.push({ path: file.path, before, after: file.content, action: before ? "repair-permission-policy" : "create-permission-policy" });
  }
  if (config.execution.isolation === "managed-devcontainer") {
    const generated = managedFiles(projectRoot, {
      webAccess: config.execution.web_access,
      integrationDomains: providerDomains(config),
      runtimeVersions: config.development.runtime_versions,
      permissionPolicy: config.permissions,
    });
    for (const file of generated.files) {
      const before = readOrEmpty(projectRoot, file.path);
      files.push({ path: file.path, before, after: file.content, action: before ? "repair-managed-file" : "create-managed-file" });
    }
  }
  const ignoreBefore = readOrEmpty(projectRoot, ".gitignore");
  const ignoreAfter = replaceManagedBlock(ignoreBefore, IGNORE_START, IGNORE_END, ignoreBlock(ignoreBefore));
  files.push({ path: ".gitignore", before: ignoreBefore, after: ignoreAfter, action: ignoreBefore ? "repair-managed-ignore" : "create-managed-ignore" });
  const writes = files.filter((file) => file.before !== file.after);
  return {
    project_root: projectRoot,
    plugin_version: pluginVersion(),
    refresh_required: writes.length > 0,
    writes: writes.map(({ path, action }) => ({ path, action })),
    unchanged: files.filter((file) => file.before === file.after).map(({ path }) => path),
    fingerprint: fingerprint("ADW-REFRESH-V1", {
      project_root: projectRoot,
      plugin_version: pluginVersion(),
      files: files.map(({ path, action, before, after }) => ({ path, action, before, after })),
    }),
    files,
  };
}

export async function refreshPreview(directory) {
  const projectRoot = realpathSync(directory);
  const config = await loadProjectConfig(projectRoot);
  if (!config.valid) throw new ContractError(`adw.yaml is invalid: ${config.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const { files, ...summary } = planRefresh(projectRoot, config.data);
  return summary;
}

export async function refreshApply(directory, expectedFingerprint) {
  const projectRoot = realpathSync(directory);
  const config = await loadProjectConfig(projectRoot);
  if (!config.valid) throw new ContractError(`adw.yaml is invalid: ${config.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const plan = planRefresh(projectRoot, config.data);
  if (plan.fingerprint !== expectedFingerprint) throw new InputError("apply requires the fingerprint returned by the reviewed refresh preview");
  const changed = plan.files.filter((file) => file.before !== file.after);
  if (changed.length > 0) {
    await applyAtomicWrites(projectRoot, changed.map((file) => ({
      path: file.path,
      content: file.after,
      expected_content: file.before === "" && !existsSync(join(projectRoot, file.path)) ? null : file.before,
    })));
  }
  const { files, ...summary } = plan;
  return { ...summary, applied: true };
}
