// Runtime evidence and managed devcontainer rendering.
//
// The only question this module answers is: what does a usable, reproducible
// container for this repository need? It reads manifests, lockfiles, pinned
// version files, and CI/Docker declarations, and it reports what it could not
// settle so the init skill can ask a person. It deliberately does not describe
// architecture, relate components, or summarize the codebase: that is reading
// work, and reading work belongs to skills.
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { PERMISSION_PROFILE, managedClaudeSettings, renderCodexRules } from "./permissions.mjs";
import { defaultPermissionPolicy, permissionPolicyJson } from "./permission-policy.mjs";
import { ContractError } from "./safe-files.mjs";
import { RUNTIMES, WEB_ACCESS_MODES, isValidDomain } from "./config.mjs";

const MANIFESTS = new Set([
  "package.json", "pyproject.toml", "requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock", "uv.lock", "environment.yml", "environment.yaml",
  "go.mod", "Cargo.toml", "Gemfile", "Gemfile.lock", "pom.xml", "build.gradle", "build.gradle.kts",
]);
const DOTNET_PROJECT_EXTENSION = /\.(?:csproj|fsproj|vbproj)$/i;
const SOURCE_EXTENSIONS = new Map([
  [".js", "node"], [".jsx", "node"], [".mjs", "node"], [".cjs", "node"], [".ts", "node"], [".tsx", "node"],
  [".py", "python"], [".go", "go"], [".rs", "rust"], [".java", "java"], [".rb", "ruby"], [".cs", "dotnet"], [".fs", "dotnet"], [".vb", "dotnet"],
]);
const IGNORED_DIRECTORIES = new Set([".git", ".adw", ".devcontainer", ".next", ".venv", "node_modules", "vendor", "dist", "build", "coverage", "target", "venv", "worktrees"]);

const OFFICIAL_FEATURES = {
  python: "ghcr.io/devcontainers/features/python:1",
  go: "ghcr.io/devcontainers/features/go:1",
  rust: "ghcr.io/devcontainers/features/rust:1",
  java: "ghcr.io/devcontainers/features/java:1",
  ruby: "ghcr.io/devcontainers/features/ruby:1",
  dotnet: "ghcr.io/devcontainers/features/dotnet:1",
};

const CONDA_FEATURE = "ghcr.io/devcontainers/features/conda:2";

// Some VS Code extensions acquire their own private copy of a language
// runtime for their own tooling (a language server, a debugger) -- separate
// from the project SDK a feature above already installs -- by downloading it
// straight from vendor infrastructure rather than through an ecosystem
// registry this firewall allowlists. Left alone, that acquisition just hangs
// and times out as "offline" behind the managed firewall. The fix is not to
// widen the allowlist to vendor CDNs; it's to point the extension at the SDK
// the container already has. Keyed by the devcontainer feature that installs
// the SDK the redirect points to; add an entry here, not a new allowlist
// domain, if another extension turns out to need the same treatment.
const RUNTIME_TOOL_REDIRECTS = {
  [OFFICIAL_FEATURES.dotnet]: {
    "dotnetAcquisitionExtension.existingDotnetPath": [
      { extensionId: "ms-dotnettools.csharp", path: "/usr/local/dotnet/current/dotnet" },
    ],
  },
};

const ECOSYSTEM_DOMAINS = {
  node: ["registry.npmjs.org"],
  python: ["pypi.org", "files.pythonhosted.org"],
  go: ["go.dev", "proxy.golang.org", "sum.golang.org", "storage.googleapis.com"],
  rust: ["crates.io", "index.crates.io", "static.crates.io", "static.rust-lang.org"],
  java: ["repo.maven.apache.org", "plugins.gradle.org", "services.gradle.org"],
  ruby: ["rubygems.org", "index.rubygems.org"],
  dotnet: ["api.nuget.org", "globalcdn.nuget.org"],
};
const CONDA_DOMAINS = ["repo.anaconda.com", "conda.anaconda.org"];

// Both agents share one skill tree, so a managed container always carries both.
const AGENT_DOMAINS = [
  "api.openai.com", "auth.openai.com", "chatgpt.com",
  "api.anthropic.com", "claude.ai", "claude.com", "console.anthropic.com", "platform.claude.com",
];

export const MANAGED_FILES = Object.freeze([
  "devcontainer.json", "Dockerfile", "allowed-domains.txt", "egress-proxy.mjs", "init-firewall.sh",
  "post-create.sh", "codex.rules", "permission-policy.json", "git-wrapper.sh", "codex-wrapper.sh", "claude-settings.json", "claude-permission-hook.mjs",
  "project-requirements.json", "project-setup.sh", "adw-managed.json",
]);

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function readJson(path, source) {
  try { return JSON.parse(readFileSync(path, "utf8")); }
  catch (error) { throw new ContractError(`cannot inspect ${source}: ${error.message}`); }
}

function condaEnvironment(projectRoot, path) {
  const text = readText(path);
  const match = text?.match(/^\s*-\s*python\s*(?:={1,2}\s*)?([0-9]+(?:\.[0-9]+){0,2})\b/im);
  return {
    path,
    version: match?.[1] ?? null,
    source: sourcePath(projectRoot, path),
  };
}

function sourcePath(projectRoot, path, fragment = "") {
  return `${relative(projectRoot, path) || "."}${fragment}`;
}

function withinProject(projectRoot, path) {
  return path === projectRoot || path.startsWith(`${projectRoot}${sep}`);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedDirectoryEntries(directory) {
  return readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name));
}

function addUnique(list, key, item) {
  if (!list.some((candidate) => candidate[key] === item[key] && candidate.source === item.source)) list.push(item);
}

function workspacePattern(workspace) {
  if (typeof workspace !== "string") return null;
  const normalized = workspace.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..") || /[{}\[\]]/.test(normalized)) return null;
  let expression = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`^${expression}$`);
}

function workspaceMatchers(manifest) {
  const workspaces = Array.isArray(manifest?.workspaces) ? manifest.workspaces : manifest?.workspaces?.packages;
  return (workspaces ?? []).map(workspacePattern).filter(Boolean);
}

function componentRoots(projectRoot) {
  const roots = new Set([projectRoot]);
  const packagePath = join(projectRoot, "package.json");
  if (existsSync(packagePath)) {
    const manifest = readJson(packagePath, "package.json");
    const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : manifest.workspaces?.packages;
    for (const workspace of (workspaces ?? []).filter((value) => typeof value === "string" && !/[*?{}\[\]]/.test(value))) {
      const target = resolve(projectRoot, workspace);
      if (withinProject(projectRoot, target) && target !== projectRoot && existsSync(target) && lstatSync(target).isDirectory() && !lstatSync(target).isSymbolicLink()) roots.add(target);
    }
  }
  function visit(directory, depth) {
    if (depth > 4) return;
    for (const entry of sortedDirectoryEntries(directory)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const target = join(directory, entry.name);
      if ([...MANIFESTS].some((name) => existsSync(join(target, name))) || sortedDirectoryEntries(target).some((child) => child.isFile() && DOTNET_PROJECT_EXTENSION.test(child.name))) roots.add(target);
      visit(target, depth + 1);
    }
  }
  visit(projectRoot, 0);
  return [...roots].sort((left, right) => compareText(relative(projectRoot, left), relative(projectRoot, right)));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function inComponent(projectRoot, componentRoot, command) {
  const path = relative(projectRoot, componentRoot) || ".";
  return path === "." ? command : `(cd ${shellQuote(path)} && ${command})`;
}

function numericVersion(value, fallback = null) {
  const match = String(value ?? "").trim().match(/(?:^|[^0-9])(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return fallback;
  return [match[1], match[2], match[3]].filter((part) => part !== undefined).join(".");
}

function pythonRequiresVersion(text) {
  return numericVersion(text?.match(/^requires-python\s*=\s*["']([^"']+)["']/m)?.[1], null);
}

function rustToolchainVersion(text) {
  if (!text) return null;
  const candidate = text.match(/^channel\s*=\s*["']([^"']+)["']/m)?.[1] ?? text.trim().split(/\s+/)[0];
  if (/^(stable|beta|nightly)$/.test(candidate)) return null;
  return /^(stable|beta|nightly)-\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : numericVersion(candidate, null);
}

function javaVersion(text) {
  if (!text) return null;
  const patterns = [
    /<maven\.compiler\.release>(\d+)<\/maven\.compiler\.release>/,
    /<maven\.compiler\.source>(\d+)<\/maven\.compiler\.source>/,
    /JavaLanguageVersion\.of\((\d+)\)/,
    /sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?(\d+)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function dotnetGlobalJson(projectRoot, componentRoot) {
  for (let root = componentRoot; withinProject(projectRoot, root); root = resolve(root, "..")) {
    const path = join(root, "global.json");
    if (existsSync(path)) {
      const version = readJson(path, sourcePath(projectRoot, path))?.sdk?.version;
      return typeof version === "string" && numericVersion(version, null)
        ? { raw: version, version: numericVersion(version, null), source: `${sourcePath(projectRoot, path)}#sdk.version` }
        : { raw: null, version: null, source: `${sourcePath(projectRoot, path)}#sdk.version` };
    }
    if (root === projectRoot) break;
  }
  return null;
}

function dotnetTargetFrameworkVersion(projectRoot, projectPath) {
  const text = readFileSync(projectPath, "utf8");
  const frameworks = [...text.matchAll(/<TargetFramework(?:s)?>\s*([^<]+?)\s*<\/TargetFramework(?:s)?>/gi)].flatMap((match) => match[1].split(";"));
  const versions = [...new Set(frameworks.map((framework) => framework.trim().match(/^net(\d+(?:\.\d+)?)(?:[-.]|$)/i)?.[1]).filter(Boolean))];
  if (versions.length !== 1) return null;
  return { raw: versions[0], version: versions[0], source: `${sourcePath(projectRoot, projectPath)}#TargetFramework` };
}

// Versions declared outside a manifest: asdf/mise tool files first, then CI
// workflows and Dockerfiles, which pin the version the project actually builds
// against.
function declaredRuntimeVersion(projectRoot, componentRoot, runtime) {
  const toolKeys = { node: "nodejs", python: "python", go: "golang", rust: "rust", java: "java", ruby: "ruby", dotnet: "dotnet" };
  for (const root of componentRoot === projectRoot ? [componentRoot] : [componentRoot, projectRoot]) {
    const path = join(root, ".tool-versions");
    const text = readText(path);
    if (text === null) continue;
    const match = text.match(new RegExp(`^${toolKeys[runtime]}\\s+(\\S+)`, "m"));
    if (match) return { raw: match[1], version: runtime === "rust" ? rustToolchainVersion(match[1]) : numericVersion(match[1], null), source: `${sourcePath(projectRoot, path)}#${toolKeys[runtime]}` };
  }
  const candidates = [];
  const workflows = join(projectRoot, ".github/workflows");
  if (existsSync(workflows) && lstatSync(workflows).isDirectory() && !lstatSync(workflows).isSymbolicLink()) {
    for (const entry of sortedDirectoryEntries(workflows)) {
      if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) candidates.push(join(workflows, entry.name));
    }
  }
  for (const name of [".gitlab-ci.yml", "Dockerfile"]) {
    const path = join(projectRoot, name);
    if (existsSync(path)) candidates.push(path);
  }
  const yamlKeys = { node: "node-version", python: "python-version", go: "go-version", rust: "toolchain", java: "java-version", ruby: "ruby-version", dotnet: "dotnet-version" };
  const imageNames = { node: "node", python: "python", go: "golang", rust: "rust", java: "(?:eclipse-temurin|openjdk)", ruby: "ruby", dotnet: "mcr\\.microsoft\\.com/dotnet/sdk" };
  for (const path of candidates.sort()) {
    const text = readFileSync(path, "utf8");
    const yaml = text.match(new RegExp(`^\\s*${yamlKeys[runtime]}:\\s*["']?([0-9][0-9A-Za-z._-]*)`, "m"));
    const image = text.match(new RegExp(`(?:FROM|image:)\\s+${imageNames[runtime]}:([0-9][0-9A-Za-z._-]*)`, "i"));
    const raw = yaml?.[1] ?? image?.[1];
    if (!raw) continue;
    return { raw, version: runtime === "rust" ? rustToolchainVersion(raw) : numericVersion(raw, null), source: `${sourcePath(projectRoot, path)}#${yaml ? yamlKeys[runtime] : "image"}` };
  }
  return null;
}

function scanSourceKinds(projectRoot) {
  const found = new Map();
  function visit(directory, depth) {
    if (depth > 5) return;
    for (const entry of sortedDirectoryEntries(directory)) {
      if (entry.isSymbolicLink() || IGNORED_DIRECTORIES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path, depth + 1);
      else {
        const extension = entry.name.includes(".") ? `.${entry.name.split(".").at(-1).toLowerCase()}` : "";
        const runtime = SOURCE_EXTENSIONS.get(extension);
        if (runtime && !found.has(runtime)) found.set(runtime, sourcePath(projectRoot, path));
      }
    }
  }
  visit(projectRoot, 0);
  return found;
}

// Native packages a container needs before common dependencies can build.
function dependencySystemPackages(projectRoot, files, packages) {
  const mappings = [
    { pattern: /["'\s](?:canvas)[@"'\s:<=>]/i, names: ["libcairo2-dev", "libpango1.0-dev", "libjpeg-dev", "libgif-dev", "librsvg2-dev"] },
    { pattern: /\b(?:psycopg2|psycopg2-binary)\b/i, names: ["libpq-dev"] },
    { pattern: /\bmysqlclient\b/i, names: ["default-libmysqlclient-dev"] },
    { pattern: /\blxml\b/i, names: ["libxml2-dev", "libxslt1-dev"] },
    { pattern: /\b(?:pillow|pil)\b/i, names: ["libjpeg-dev", "zlib1g-dev"] },
    { pattern: /\bcryptography\b/i, names: ["libssl-dev", "libffi-dev"] },
  ];
  for (const path of files) {
    const text = readText(path);
    if (text === null) continue;
    for (const mapping of mappings) {
      if (!mapping.pattern.test(text)) continue;
      for (const name of mapping.names) addUnique(packages, "name", { name, source: sourcePath(projectRoot, path) });
    }
  }
}

function environmentEvidence(projectRoot) {
  const variables = [];
  const ports = [];
  for (const name of [".env.example", ".env.sample", ".env.template"]) {
    const path = join(projectRoot, name);
    const text = readText(path);
    if (text === null) continue;
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      addUnique(variables, "name", { name: match[1], source: sourcePath(projectRoot, path), status: "value-required" });
      if (/(?:^|_)PORT$/.test(match[1]) && /^\d{2,5}$/.test(match[2].trim())) addUnique(ports, "port", { port: Number(match[2].trim()), source: `${sourcePath(projectRoot, path)}#${match[1]}` });
    }
  }
  const packagePath = join(projectRoot, "package.json");
  if (existsSync(packagePath)) {
    const manifest = readJson(packagePath, "package.json");
    for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
      if (typeof command !== "string") continue;
      const match = command.match(/(?:--port(?:=|\s+)|\bPORT=)(\d{2,5})\b/);
      if (match) addUnique(ports, "port", { port: Number(match[1]), source: `package.json#scripts.${name}` });
    }
  }
  return { variables, ports };
}

function composeEvidence(projectRoot, unresolved, ports) {
  const path = ["compose.yaml", "compose.yml", "docker-compose.yaml", "docker-compose.yml"].map((name) => join(projectRoot, name)).find(existsSync);
  if (!path) return;
  const text = readFileSync(path, "utf8");
  for (const match of text.matchAll(/["']?(\d{2,5}):\d{2,5}(?:\/(?:tcp|udp))?["']?/g)) {
    addUnique(ports, "port", { port: Number(match[1]), source: sourcePath(projectRoot, path) });
  }
  unresolved.push({ requirement: "compose services", source: sourcePath(projectRoot, path), reason: "ADW does not mount the host Docker socket or infer a safe multi-container topology" });
}

function selectedRuntimeVersions(runtimes, unresolved) {
  const selected = new Map();
  for (const name of [...new Set(runtimes.map((runtime) => runtime.name))]) {
    const versions = [...new Set(runtimes.filter((runtime) => runtime.name === name && runtime.version).map((runtime) => runtime.version))];
    if (versions.length > 1) {
      unresolved.push({ requirement: `${name} runtime version`, source: runtimes.filter((runtime) => runtime.name === name).map((runtime) => runtime.source).join(", "), reason: `conflicting detected versions: ${versions.join(", ")}` });
      continue;
    }
    if (versions.length === 1) selected.set(name, versions[0]);
  }
  return selected;
}

function checkRuntimeVersions(runtimeVersions) {
  if (runtimeVersions === null || typeof runtimeVersions !== "object" || Array.isArray(runtimeVersions)) throw new ContractError("runtime_versions must be a mapping object");
  for (const [name, version] of Object.entries(runtimeVersions)) {
    if (!RUNTIMES.includes(name)) throw new ContractError(`unsupported runtime: ${name}`);
    if (typeof version !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(version)) throw new ContractError(`runtime version for ${name} must be numeric`);
  }
  return runtimeVersions;
}

export function discoverDevelopmentEnvironment(projectRoot, { runtimeVersions = {} } = {}) {
  checkRuntimeVersions(runtimeVersions);
  const runtimes = [];
  const systemPackages = [];
  const setupCommands = [];
  const unresolved = [];
  const dependencyFiles = [];
  const condaEnvironmentFiles = [];
  const roots = componentRoots(projectRoot);
  const rootPackagePath = join(projectRoot, "package.json");
  const rootPackage = existsSync(rootPackagePath) ? readJson(rootPackagePath, "package.json") : null;
  const rootWorkspaceMatchers = workspaceMatchers(rootPackage);
  const rootNodeVersionFile = [".nvmrc", ".node-version"].map((name) => join(projectRoot, name)).find(existsSync);
  const rootNodeDeclared = rootPackage ? declaredRuntimeVersion(projectRoot, projectRoot, "node") : null;
  const rootNodeRequested = rootNodeVersionFile ? readFileSync(rootNodeVersionFile, "utf8").trim() : rootPackage?.engines?.node ?? rootNodeDeclared?.raw;
  const rootNodeSource = rootNodeVersionFile ? sourcePath(projectRoot, rootNodeVersionFile) : rootPackage?.engines?.node ? "package.json#engines.node" : rootNodeDeclared?.source;
  const rootHasLockedInstall = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"].some((name) => existsSync(join(projectRoot, name)));

  for (const componentRoot of roots) {
    const component = relative(projectRoot, componentRoot) || ".";
    const packagePath = join(componentRoot, "package.json");
    if (existsSync(packagePath)) {
      const manifest = readJson(packagePath, sourcePath(projectRoot, packagePath));
      const versionFile = [".nvmrc", ".node-version"].map((name) => join(componentRoot, name)).find(existsSync);
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "node");
      const isRootWorkspace = componentRoot !== projectRoot && rootWorkspaceMatchers.some((matcher) => matcher.test(component.replaceAll("\\", "/")));
      const inheritedWorkspaceVersion = isRootWorkspace ? rootNodeRequested : null;
      const rawVersion = versionFile ? readFileSync(versionFile, "utf8").trim() : manifest.engines?.node ?? inheritedWorkspaceVersion ?? declared?.raw;
      const parsedVersion = numericVersion(rawVersion, null);
      const version = parsedVersion ? parsedVersion.split(".")[0] : null;
      const versionSource = versionFile ? sourcePath(projectRoot, versionFile) : manifest.engines?.node ? `${sourcePath(projectRoot, packagePath)}#engines.node` : inheritedWorkspaceVersion ? rootNodeSource : declared?.source ?? sourcePath(projectRoot, packagePath);
      runtimes.push({ name: "node", version, requested: rawVersion ?? null, source: versionSource, component });
      addUnique(systemPackages, "name", { name: "build-essential", source: sourcePath(projectRoot, packagePath) });
      dependencyFiles.push(packagePath);
      const hasDependencies = Object.keys({ ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}), ...(manifest.optionalDependencies ?? {}) }).length > 0;
      const componentHasLock = ["pnpm-lock.yaml", "yarn.lock", "package-lock.json"].some((name) => existsSync(join(componentRoot, name)));
      if (!hasDependencies && !componentHasLock && !(isRootWorkspace && rootHasLockedInstall)) {
        // A dependency-free package needs no install command or lockfile.
      } else if (isRootWorkspace && rootHasLockedInstall) {
        // The root lockfile-backed install already covers this exact workspace.
      } else if (existsSync(join(componentRoot, "pnpm-lock.yaml"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "corepack pnpm install --frozen-lockfile"), source: sourcePath(projectRoot, join(componentRoot, "pnpm-lock.yaml")) });
      else if (existsSync(join(componentRoot, "yarn.lock"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "corepack yarn install --immutable"), source: sourcePath(projectRoot, join(componentRoot, "yarn.lock")) });
      else if (existsSync(join(componentRoot, "package-lock.json"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "npm ci"), source: sourcePath(projectRoot, join(componentRoot, "package-lock.json")) });
      else if (existsSync(join(componentRoot, "bun.lock")) || existsSync(join(componentRoot, "bun.lockb"))) unresolved.push({ requirement: `install Node dependencies in ${component}`, source: sourcePath(projectRoot, packagePath), reason: "Bun projects require an explicitly pinned Bun runtime" });
      else unresolved.push({ requirement: `install Node dependencies in ${component}`, source: sourcePath(projectRoot, packagePath), reason: "no lockfile proves a reproducible install command" });
    }

    const condaPath = ["environment.yml", "environment.yaml"].map((name) => join(componentRoot, name)).find(existsSync);
    if (condaPath) {
      const conda = condaEnvironment(projectRoot, condaPath);
      condaEnvironmentFiles.push(conda.path);
      dependencyFiles.push(conda.path);
      if (conda.version) {
        runtimes.push({ name: "python", version: conda.version, requested: conda.version, source: conda.source, component });
      } else {
        unresolved.push({ requirement: `Python runtime in Conda environment for ${component}`, source: conda.source, reason: "environment.yml does not declare a numeric Python version" });
      }
      setupCommands.push({ command: inComponent(projectRoot, componentRoot, `conda env create --file ${conda.path.split(sep).pop()}`), source: conda.source });
    }

    const pyprojectPath = join(componentRoot, "pyproject.toml");
    const pythonFiles = ["requirements.txt", "Pipfile", "Pipfile.lock", "poetry.lock", "uv.lock"].map((name) => join(componentRoot, name)).filter(existsSync);
    if (!condaPath && (existsSync(pyprojectPath) || pythonFiles.length > 0)) {
      const versionFile = join(componentRoot, ".python-version");
      const pyproject = readText(pyprojectPath);
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "python");
      const versionFileValue = existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : null;
      const pythonRequirement = pyproject?.match(/^requires-python\s*=\s*["']([^"']+)["']/m)?.[1] ?? null;
      const version = versionFileValue !== null ? numericVersion(versionFileValue, null) : pythonRequiresVersion(pyproject) ?? declared?.version ?? null;
      const versionSource = existsSync(versionFile) ? sourcePath(projectRoot, versionFile) : pythonRequiresVersion(pyproject) ? `${sourcePath(projectRoot, pyprojectPath)}#requires-python` : declared?.source ?? sourcePath(projectRoot, existsSync(pyprojectPath) ? pyprojectPath : pythonFiles[0]);
      runtimes.push({ name: "python", version, requested: versionFileValue ?? pythonRequirement ?? declared?.raw ?? null, source: versionSource, component });
      for (const name of ["build-essential", "python-is-python3", "python3-dev", "python3-pip", "python3-venv"]) addUnique(systemPackages, "name", { name, source: existsSync(pyprojectPath) ? sourcePath(projectRoot, pyprojectPath) : sourcePath(projectRoot, pythonFiles[0]) });
      dependencyFiles.push(...pythonFiles, ...(existsSync(pyprojectPath) ? [pyprojectPath] : []));
      if (existsSync(join(componentRoot, "uv.lock"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "python -m pip install --user uv && \"$HOME/.local/bin/uv\" sync --frozen"), source: sourcePath(projectRoot, join(componentRoot, "uv.lock")) });
      else if (existsSync(join(componentRoot, "poetry.lock"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "python -m pip install --user poetry && \"$HOME/.local/bin/poetry\" install --no-interaction --sync"), source: sourcePath(projectRoot, join(componentRoot, "poetry.lock")) });
      else if (existsSync(join(componentRoot, "Pipfile.lock"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "python -m pip install --user pipenv && \"$HOME/.local/bin/pipenv\" sync --dev"), source: sourcePath(projectRoot, join(componentRoot, "Pipfile.lock")) });
      else if (existsSync(join(componentRoot, "requirements.txt"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "python -m venv .venv && .venv/bin/python -m pip install -r requirements.txt"), source: sourcePath(projectRoot, join(componentRoot, "requirements.txt")) });
      else if (existsSync(pyprojectPath)) {
        setupCommands.push({ command: inComponent(projectRoot, componentRoot, "python -m venv .venv && .venv/bin/python -m pip install -e ."), source: sourcePath(projectRoot, pyprojectPath) });
        unresolved.push({ requirement: `reproducible Python dependency resolution in ${component}`, source: sourcePath(projectRoot, pyprojectPath), reason: "pyproject.toml has no supported lockfile" });
      }
    }

    const goPath = join(componentRoot, "go.mod");
    if (existsSync(goPath)) {
      const text = readFileSync(goPath, "utf8");
      const toolchain = text.match(/^toolchain\s+go([0-9.]+)/m)?.[1];
      const language = text.match(/^go\s+([0-9.]+)/m)?.[1];
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "go");
      const version = toolchain ?? language ?? declared?.version ?? null;
      runtimes.push({ name: "go", version, requested: version, source: toolchain || language ? `${sourcePath(projectRoot, goPath)}#${toolchain ? "toolchain" : "go"}` : declared?.source ?? sourcePath(projectRoot, goPath), component });
      setupCommands.push({ command: inComponent(projectRoot, componentRoot, "go mod download"), source: sourcePath(projectRoot, goPath) });
    }

    const cargoPath = join(componentRoot, "Cargo.toml");
    if (existsSync(cargoPath)) {
      const toolchainPath = ["rust-toolchain.toml", "rust-toolchain"].map((name) => join(componentRoot, name)).find(existsSync);
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "rust");
      const version = toolchainPath ? rustToolchainVersion(readFileSync(toolchainPath, "utf8")) : declared?.version ?? null;
      runtimes.push({ name: "rust", version, requested: version, source: toolchainPath ? sourcePath(projectRoot, toolchainPath) : declared?.source ?? sourcePath(projectRoot, cargoPath), component });
      for (const name of ["build-essential", "pkg-config", "libssl-dev"]) addUnique(systemPackages, "name", { name, source: sourcePath(projectRoot, cargoPath) });
      if (version) setupCommands.push({ command: inComponent(projectRoot, componentRoot, existsSync(join(componentRoot, "Cargo.lock")) ? "cargo fetch --locked" : "cargo fetch"), source: sourcePath(projectRoot, existsSync(join(componentRoot, "Cargo.lock")) ? join(componentRoot, "Cargo.lock") : cargoPath) });
      else unresolved.push({ requirement: `Rust runtime version in ${component}`, source: sourcePath(projectRoot, cargoPath), reason: "Cargo.toml does not pin a toolchain; add rust-toolchain.toml" });
    }

    const pomPath = join(componentRoot, "pom.xml");
    const gradlePath = ["build.gradle", "build.gradle.kts"].map((name) => join(componentRoot, name)).find(existsSync);
    if (existsSync(pomPath) || gradlePath) {
      const manifestPath = existsSync(pomPath) ? pomPath : gradlePath;
      const versionFile = join(componentRoot, ".java-version");
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "java");
      const manifestText = readFileSync(manifestPath, "utf8");
      const version = existsSync(versionFile) ? numericVersion(readFileSync(versionFile, "utf8"), null) : javaVersion(manifestText) ?? declared?.version ?? null;
      runtimes.push({ name: "java", version, requested: version, source: existsSync(versionFile) ? sourcePath(projectRoot, versionFile) : javaVersion(manifestText) ? sourcePath(projectRoot, manifestPath) : declared?.source ?? sourcePath(projectRoot, manifestPath), component });
      if (version) {
        if (existsSync(pomPath)) setupCommands.push({ command: inComponent(projectRoot, componentRoot, existsSync(join(componentRoot, "mvnw")) ? "sh ./mvnw -q dependency:go-offline" : "mvn -q dependency:go-offline"), source: sourcePath(projectRoot, pomPath) });
        else setupCommands.push({ command: inComponent(projectRoot, componentRoot, existsSync(join(componentRoot, "gradlew")) ? "sh ./gradlew --no-daemon dependencies" : "gradle --no-daemon dependencies"), source: sourcePath(projectRoot, gradlePath) });
      } else unresolved.push({ requirement: `Java runtime version in ${component}`, source: sourcePath(projectRoot, manifestPath), reason: "the build does not expose a supported Java toolchain declaration" });
    }

    const gemPath = join(componentRoot, "Gemfile");
    if (existsSync(gemPath)) {
      const versionFile = join(componentRoot, ".ruby-version");
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "ruby");
      const version = existsSync(versionFile) ? numericVersion(readFileSync(versionFile, "utf8"), null) : declared?.version ?? null;
      runtimes.push({ name: "ruby", version, requested: version, source: existsSync(versionFile) ? sourcePath(projectRoot, versionFile) : declared?.source ?? sourcePath(projectRoot, gemPath), component });
      if (version && existsSync(join(componentRoot, "Gemfile.lock"))) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "bundle install"), source: sourcePath(projectRoot, join(componentRoot, "Gemfile.lock")) });
      else unresolved.push({ requirement: `Ruby runtime and locked dependencies in ${component}`, source: sourcePath(projectRoot, gemPath), reason: "both .ruby-version and Gemfile.lock are required for autonomous setup" });
    }

    const dotnetProjectPath = sortedDirectoryEntries(componentRoot)
      .filter((entry) => entry.isFile() && DOTNET_PROJECT_EXTENSION.test(entry.name))
      .map((entry) => join(componentRoot, entry.name))
      .sort()[0];
    if (dotnetProjectPath) {
      const global = dotnetGlobalJson(projectRoot, componentRoot);
      const declared = declaredRuntimeVersion(projectRoot, componentRoot, "dotnet");
      const framework = dotnetTargetFrameworkVersion(projectRoot, dotnetProjectPath);
      const version = global?.version ?? declared?.version ?? framework?.version ?? null;
      const source = global?.source ?? declared?.source ?? framework?.source ?? sourcePath(projectRoot, dotnetProjectPath);
      runtimes.push({ name: "dotnet", version, requested: global?.raw ?? declared?.raw ?? framework?.raw ?? null, source, component });
      dependencyFiles.push(dotnetProjectPath);
      const lockPath = join(componentRoot, "packages.lock.json");
      if (version && existsSync(lockPath)) setupCommands.push({ command: inComponent(projectRoot, componentRoot, "dotnet restore --locked-mode"), source: sourcePath(projectRoot, lockPath) });
      else if (version) {
        setupCommands.push({ command: inComponent(projectRoot, componentRoot, "dotnet restore"), source: sourcePath(projectRoot, dotnetProjectPath) });
        unresolved.push({ requirement: `reproducible .NET dependency resolution in ${component}`, source: sourcePath(projectRoot, dotnetProjectPath), reason: "no packages.lock.json proves a locked restore" });
      } else unresolved.push({ requirement: `.NET SDK version in ${component}`, source, reason: "global.json, .tool-versions, or supported CI/Docker SDK declaration is required" });
    }
  }

  const sourceKinds = scanSourceKinds(projectRoot);
  for (const [name, source] of sourceKinds) {
    if (!runtimes.some((runtime) => runtime.name === name)) unresolved.push({ requirement: `${name} source runtime`, source, reason: "source code exists without a supported manifest or pinned runtime declaration" });
  }

  dependencySystemPackages(projectRoot, dependencyFiles, systemPackages);
  const { variables, ports } = environmentEvidence(projectRoot);
  composeEvidence(projectRoot, unresolved, ports);
  for (const variable of variables) unresolved.push({ requirement: `environment variable ${variable.name}`, source: variable.source, reason: "values and secrets are never inferred or committed" });

  // A person may choose a version only where the repository does not pin one.
  // That choice stays visible in the generated evidence instead of silently
  // falling back to a distro default, which makes a container unusable later.
  for (const runtime of runtimes) {
    const chosen = runtimeVersions[runtime.name];
    if (!runtime.version && chosen) {
      const detectedSource = runtime.source;
      runtime.version = chosen;
      runtime.requested = chosen;
      runtime.source = `adw.yaml#development.runtime_versions.${runtime.name}`;
      runtime.detected_source = detectedSource;
      if (runtime.name === "dotnet") {
        const componentRoot = resolve(projectRoot, runtime.component);
        const lockPath = join(componentRoot, "packages.lock.json");
        const command = inComponent(projectRoot, componentRoot, existsSync(lockPath) ? "dotnet restore --locked-mode" : "dotnet restore");
        if (!setupCommands.some((item) => item.command === command)) setupCommands.push({ command, source: existsSync(lockPath) ? sourcePath(projectRoot, lockPath) : detectedSource });
        if (!existsSync(lockPath)) unresolved.push({ requirement: `reproducible .NET dependency resolution in ${runtime.component}`, source: detectedSource, reason: "no packages.lock.json proves a locked restore" });
      }
    }
  }

  // Source-only and empty projects have no manifest to amend above, but a
  // chosen runtime still makes their managed container usable.
  for (const [name, version] of Object.entries(runtimeVersions)) {
    if (runtimes.some((runtime) => runtime.name === name)) continue;
    runtimes.push({
      name,
      version,
      requested: version,
      source: `adw.yaml#development.runtime_versions.${name}`,
      ...(sourceKinds.has(name) ? { detected_source: sourceKinds.get(name) } : {}),
      component: ".",
    });
  }

  // An explicit choice resolves the exact missing requirement recorded above.
  for (let index = unresolved.length - 1; index >= 0; index -= 1) {
    const item = unresolved[index];
    if (item.requirement.startsWith(".NET SDK version") && runtimeVersions.dotnet) unresolved.splice(index, 1);
    else if (item.requirement.endsWith(" source runtime") && runtimeVersions[item.requirement.slice(0, -" source runtime".length)]) unresolved.splice(index, 1);
  }

  const selected = selectedRuntimeVersions(runtimes, unresolved);
  if (selected.has("node") && Number(selected.get("node").split(".")[0]) < 20) {
    unresolved.push({ requirement: "Node runtime version", source: runtimes.find((runtime) => runtime.name === "node").source, reason: "ADW requires Node.js 20 or newer inside the managed container" });
    selected.delete("node");
  }
  for (const runtime of runtimes) {
    if (!runtime.version && !unresolved.some((item) => item.requirement.startsWith(`${runtime.name === "rust" ? "Rust" : runtime.name} runtime`))) {
      unresolved.push({ requirement: `${runtime.name} runtime version`, source: runtime.source, reason: "no deterministic version could be inferred" });
    }
  }

  const features = {};
  for (const [name, version] of selected) {
    if (name === "node" || (name === "python" && (version === "3.12" || condaEnvironmentFiles.length > 0))) continue;
    if (OFFICIAL_FEATURES[name]) features[OFFICIAL_FEATURES[name]] = name === "java" ? { version, installMaven: "true", installGradle: "true" } : { version };
  }
  if (condaEnvironmentFiles.length > 0) features[CONDA_FEATURE] = { version: "24.11.3" };

  return {
    schema: 1,
    runtimes,
    selected_versions: Object.fromEntries([...selected].sort(([left], [right]) => compareText(left, right))),
    features,
    system_packages: systemPackages.sort((left, right) => compareText(left.name, right.name) || compareText(left.source, right.source)),
    setup_commands: setupCommands,
    allowed_domains: [...new Set([
      ...runtimes.flatMap(({ name }) => ECOSYSTEM_DOMAINS[name] ?? []),
      ...(condaEnvironmentFiles.length > 0 ? CONDA_DOMAINS : []),
    ])].sort(),
    forward_ports: ports.sort((left, right) => left.port - right.port),
    environment_variables: variables,
    unresolved,
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function setupScript(requirements) {
  const lines = ["#!/usr/bin/env bash", "set -euo pipefail", "IFS=$'\\n\\t'", "cd /workspace", ""];
  if (requirements.setup_commands.length === 0) lines.push("echo \"ADW found no lockfile-backed project dependency setup commands.\"");
  else {
    for (const item of requirements.setup_commands) {
      lines.push(`# Evidence: ${item.source.replaceAll("\n", " ")}`);
      lines.push(item.command);
      lines.push("");
    }
    lines.push("echo \"ADW project dependencies are ready.\"");
  }
  return `${lines.join("\n")}\n`;
}

function normalizedIntegrationDomains(domains) {
  if (!Array.isArray(domains)) throw new ContractError("integration domains must be an array");
  for (const domain of domains) if (!isValidDomain(domain)) throw new ContractError(`invalid integration domain: ${String(domain)}`);
  return [...new Set(domains)].sort();
}

export function managedDevelopmentFiles(projectRoot, templateRoot, { webAccess = "public-pages", integrationDomains = [], runtimeVersions = {}, pluginVersion, permissionPolicy = defaultPermissionPolicy() } = {}) {
  if (!WEB_ACCESS_MODES.includes(webAccess)) throw new ContractError(`unsupported web access profile: ${webAccess}`);
  const configuredIntegrationDomains = normalizedIntegrationDomains(integrationDomains);
  const requirements = discoverDevelopmentEnvironment(projectRoot, { runtimeVersions });
  const requirementsText = stableJson(requirements);
  const projectSetup = setupScript(requirements);

  const config = readJson(join(templateRoot, "devcontainer.json"), "managed devcontainer template");
  config.build.args.ADW_AGENT_TOOLS = "both";
  config.build.args.ADW_WEB_ACCESS = webAccess;
  const nodeVersion = requirements.selected_versions.node;
  if (nodeVersion) config.build.args.NODE_MAJOR = nodeVersion.split(".")[0];
  config.build.args.ADW_PROJECT_APT_PACKAGES = [...new Set(requirements.system_packages.map(({ name }) => name))].sort().join(" ");
  if (Object.keys(requirements.features).length > 0) config.features = requirements.features;
  for (const [feature, settings] of Object.entries(RUNTIME_TOOL_REDIRECTS)) {
    if (!requirements.features[feature]) continue;
    config.customizations.vscode.settings = { ...config.customizations.vscode.settings, ...settings };
  }
  if (requirements.forward_ports.length > 0) config.forwardPorts = requirements.forward_ports.map(({ port }) => port);
  config.postCreateCommand = "sudo /usr/local/bin/adw-init-firewall && sudo /usr/local/bin/adw-post-create && /usr/local/bin/adw-project-setup";

  const dockerfile = readFileSync(join(templateRoot, "Dockerfile"), "utf8");
  const allowedBase = readFileSync(join(templateRoot, "allowed-domains.txt"), "utf8").trimEnd();
  const includedDomains = new Set(allowedBase.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")));
  const domainSections = [];
  const addDomainSection = (heading, domains) => {
    const unique = [...new Set(domains)].filter((domain) => !includedDomains.has(domain));
    if (unique.length === 0) return;
    unique.forEach((domain) => includedDomains.add(domain));
    domainSections.push(`# ${heading}\n${unique.join("\n")}`);
  };
  addDomainSection("Agent inference and authentication", AGENT_DOMAINS);
  addDomainSection("Explicitly configured integrations", configuredIntegrationDomains);
  addDomainSection("Project dependency sources detected during ADW initialization", requirements.allowed_domains);
  const allowedDomains = `${allowedBase}${domainSections.length > 0 ? `\n\n${domainSections.join("\n\n")}` : ""}\n`;
  const sandboxDomains = allowedDomains.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const codexRules = renderCodexRules(permissionPolicy);
  const policyJson = permissionPolicyJson(permissionPolicy);
  const claudeSettings = managedClaudeSettings({ allowedDomains: sandboxDomains, webAccess, policy: permissionPolicy });

  const marker = readJson(join(templateRoot, "adw-managed.json"), "managed devcontainer marker");
  marker.schema = 3;
  marker.web_access = webAccess;
  marker.plugin_version = pluginVersion ?? readJson(resolve(templateRoot, "../../.codex-plugin/plugin.json"), "Codex plugin manifest").version;
  marker.codex_version = config.build.args.CODEX_VERSION;
  marker.claude_code_version = config.build.args.CLAUDE_CODE_VERSION;
  marker.permission_profile = PERMISSION_PROFILE;
  marker.integration_domains = configuredIntegrationDomains;
  marker.allowed_domains_sha256 = sha256(allowedDomains);
  marker.codex_rules_sha256 = sha256(codexRules);
  marker.permission_policy_sha256 = sha256(policyJson);
  marker.git_wrapper_sha256 = sha256(readFileSync(join(templateRoot, "git-wrapper.sh"), "utf8"));
  marker.codex_wrapper_sha256 = sha256(readFileSync(join(templateRoot, "codex-wrapper.sh"), "utf8"));
  marker.claude_settings_sha256 = sha256(claudeSettings);
  marker.claude_hook_sha256 = sha256(readFileSync(join(templateRoot, "claude-permission-hook.mjs"), "utf8"));
  marker.egress_proxy_sha256 = sha256(readFileSync(join(templateRoot, "egress-proxy.mjs"), "utf8"));
  marker.requirements_schema = requirements.schema;
  marker.project_requirements_sha256 = sha256(requirementsText);
  marker.project_setup_sha256 = sha256(projectSetup);
  delete marker.agent_tools;

  const files = new Map([
    ["devcontainer.json", stableJson(config)],
    ["Dockerfile", dockerfile],
    ["allowed-domains.txt", allowedDomains],
    ["egress-proxy.mjs", readFileSync(join(templateRoot, "egress-proxy.mjs"), "utf8")],
    ["init-firewall.sh", readFileSync(join(templateRoot, "init-firewall.sh"), "utf8")],
    ["post-create.sh", readFileSync(join(templateRoot, "post-create.sh"), "utf8")],
    ["codex.rules", codexRules],
    ["permission-policy.json", policyJson],
    ["git-wrapper.sh", readFileSync(join(templateRoot, "git-wrapper.sh"), "utf8")],
    ["codex-wrapper.sh", readFileSync(join(templateRoot, "codex-wrapper.sh"), "utf8")],
    ["claude-settings.json", claudeSettings],
    ["claude-permission-hook.mjs", readFileSync(join(templateRoot, "claude-permission-hook.mjs"), "utf8")],
    ["project-requirements.json", requirementsText],
    ["project-setup.sh", projectSetup],
    ["adw-managed.json", stableJson(marker)],
  ]);
  const missing = MANAGED_FILES.filter((name) => !files.has(name));
  if (missing.length > 0) throw new ContractError(`managed rendering is missing: ${missing.join(", ")}`);
  return { requirements, files };
}
