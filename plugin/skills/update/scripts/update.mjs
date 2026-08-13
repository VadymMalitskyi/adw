#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAtomicWrites,
  loadArtifactFile,
} from "../../../lib/adw-helper.mjs";
import { permissionProjectFiles } from "../../../execution/managed-development.mjs";
import { managedDevelopmentFiles } from "../../init/scripts/development-environment.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");
const RUNTIMES = new Set(["node", "python", "go", "rust", "java", "ruby", "dotnet"]);

function fail(message, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...details }, null, 2)}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const args = { action: argv[0] };
  if (!new Set(["preview", "apply"]).has(args.action)) throw new Error("usage: update.mjs <preview|apply> --project-root <path> [--confirmed --preview-digest <sha256>]");
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--project-root") args.projectRoot = argv[++index];
    else if (value === "--preview-digest") args.previewDigest = argv[++index];
    else if (value === "--confirmed") args.confirmed = true;
    else throw new Error(`unknown argument: ${value}`);
  }
  if (!args.projectRoot) throw new Error("--project-root is required");
  if (args.action === "apply" && !args.confirmed) throw new Error("apply requires --confirmed after review of the exact preview");
  return args;
}

function git(root, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return { status: result.status, stdout: result.stdout.trim() };
}

function projectRoot(input) {
  const root = realpathSync(input);
  const result = git(root, ["rev-parse", "--show-toplevel"]);
  if (realpathSync(result.stdout) !== root) throw new Error("project root must be the Git top level");
  return root;
}

function pluginVersion() {
  const version = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("installed plugin manifest has an invalid semantic version");
  return version;
}

function readOptional(root, relativePath) {
  let target = root;
  for (const part of relativePath.split("/")) {
    target = join(target, part);
    if (existsSync(target) && lstatSync(target).isSymbolicLink()) throw new Error(`managed path cannot traverse a symbolic link: ${relativePath}`);
  }
  if (!existsSync(target)) return null;
  if (!lstatSync(target).isFile()) throw new Error(`managed path must be a regular file: ${relativePath}`);
  return readFileSync(target, "utf8");
}

function managedAgentTools(root) {
  const markerText = readOptional(root, ".devcontainer/adw-managed.json");
  if (markerText === null) throw new Error("managed-devcontainer repair requires .devcontainer/adw-managed.json");
  let marker;
  try { marker = JSON.parse(markerText); } catch (error) { throw new Error(`cannot parse managed marker: ${error.message}`); }
  if (!["codex", "claude", "both"].includes(marker.agent_tools)) throw new Error("managed marker has an invalid agent_tools value");
  return "both";
}

function existingIntegrationDomains(root) {
  const text = readOptional(root, ".devcontainer/allowed-domains.txt");
  if (text === null) return [];
  const lines = text.split(/\r?\n/);
  const start = lines.indexOf("# Explicitly configured integrations");
  if (start === -1) return [];
  const domains = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.startsWith("# ")) break;
    if (line) domains.push(line);
  }
  return domains;
}

function existingRuntimeVersions(root, project) {
  if (project.development?.runtime_versions) return project.development.runtime_versions;
  const text = readOptional(root, ".devcontainer/project-requirements.json");
  if (text === null) throw new Error("managed-devcontainer repair requires development.runtime_versions in adw.yaml or existing .devcontainer/project-requirements.json evidence");
  let requirements;
  try { requirements = JSON.parse(text); } catch (error) { throw new Error(`cannot recover initialization-selected runtime versions from project requirements: ${error.message}`); }
  if (requirements?.schema !== 1 || !Array.isArray(requirements.runtimes) || requirements.selected_versions === null || typeof requirements.selected_versions !== "object" || Array.isArray(requirements.selected_versions)) {
    throw new Error("cannot recover initialization-selected runtime versions from invalid project requirements; add development.runtime_versions to adw.yaml");
  }
  for (const [name, selected] of Object.entries(requirements.selected_versions)) {
    const matchingEvidence = requirements.runtimes.some((runtime) => runtime?.name === name && runtime.version === selected);
    if (!RUNTIMES.has(name) || typeof selected !== "string" || !/^\d+(?:\.\d+){0,2}$/.test(selected) || !matchingEvidence) {
      throw new Error("cannot recover initialization-selected runtime versions from invalid project requirements; add development.runtime_versions to adw.yaml");
    }
  }
  const recovered = {};
  for (const runtime of requirements.runtimes) {
    if (!runtime || typeof runtime !== "object" || typeof runtime.source !== "string") continue;
    const match = /^onboarding\.development\.runtime_versions\.([a-z]+)$/.exec(runtime.source);
    if (!match) continue;
    const name = match[1];
    const selected = requirements.selected_versions[name];
    if (!RUNTIMES.has(name) || typeof selected !== "string" || runtime.name !== name || runtime.version !== selected || !/^\d+(?:\.\d+){0,2}$/.test(selected)) {
      throw new Error(`cannot safely recover initialization-selected ${name} runtime version; add development.runtime_versions.${name} to adw.yaml`);
    }
    if (recovered[name] && recovered[name] !== selected) throw new Error(`conflicting initialization-selected ${name} runtime versions; add development.runtime_versions.${name} to adw.yaml`);
    recovered[name] = selected;
  }
  return Object.fromEntries(Object.entries(recovered).sort(([left], [right]) => left.localeCompare(right)));
}

function repairPlan(root, project) {
  if (project.execution.isolation !== "managed-devcontainer") return [];
  const agentTools = managedAgentTools(root);
  const generated = managedDevelopmentFiles(root, join(pluginRoot, "templates/devcontainer"), {
    agentTools,
    webAccess: project.execution.web_access ?? "public-pages",
    integrationDomains: existingIntegrationDomains(root),
    runtimeVersions: existingRuntimeVersions(root, project),
  });
  const files = [];
  for (const [name, content] of generated.files) {
    const path = `.devcontainer/${name}`;
    const before = readOptional(root, path);
    files.push({ path, before, after: content, action: before === null ? "create-managed-file" : "repair-managed-file" });
  }
  for (const file of permissionProjectFiles(agentTools, (path) => readOptional(root, path) ?? "")) {
    const before = readOptional(root, file.path);
    files.push({ path: file.path, before, after: file.content, action: before === null ? "create-permission-policy" : "repair-permission-policy" });
  }
  return files;
}

function previewDigest(root, version, files) {
  const head = git(root, ["rev-parse", "HEAD"], true);
  const payload = {
    project_root: root,
    code_head: head.status === 0 ? head.stdout : null,
    plugin_version: version,
    files: files.map(({ path, before, after, action }) => ({ path, before, after, action })),
  };
  return createHash("sha256").update("ADW-UPDATE-PREVIEW-V1\0").update(JSON.stringify(payload)).digest("hex");
}

try {
  const args = parseArguments(process.argv.slice(2));
  const root = projectRoot(args.projectRoot);
  const loadedProject = await loadArtifactFile({ project_root: root, path: "adw.yaml", artifact: "project" });
  const project = loadedProject.data;
  const version = pluginVersion();
  const projectValidation = loadedProject.validation;
  if (!projectValidation.valid) fail("adw.yaml is invalid", { errors: projectValidation.errors, writes: [] });
  const files = repairPlan(root, project);
  const changed = files.filter(({ before, after }) => before !== after);
  const digest = previewDigest(root, version, files);
  const result = {
    ok: true,
    mode: args.action,
    plugin_root: pluginRoot,
    plugin_version: version,
    repair_required: changed.length > 0,
    preview_digest: digest,
    writes: changed.map(({ path, action }) => ({ path, action })),
  };
  if (args.action === "apply") {
    if (args.previewDigest !== digest) throw new Error("apply requires the exact --preview-digest shown for the reviewed update preview");
    if (changed.length > 0) await applyAtomicWrites(root, changed.map(({ path, before, after }) => ({ path, content: after, expected_content: before })));
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  fail(error.message);
}
