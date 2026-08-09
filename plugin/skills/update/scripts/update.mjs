#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyAtomicWrites,
  checkCompatibility,
  CURRENT_PROJECT_SCHEMA,
  loadArtifactFile,
} from "../../../lib/adw-helper.mjs";
import { permissionProjectFiles } from "../../../execution/managed-development.mjs";
import { managedDevelopmentFiles } from "../../init/scripts/development-environment.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");

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
  return marker.agent_tools;
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

function repairPlan(root, project) {
  if (project.execution.isolation !== "managed-devcontainer") return [];
  const agentTools = managedAgentTools(root);
  const generated = managedDevelopmentFiles(root, join(pluginRoot, "templates/devcontainer"), {
    agentTools,
    integrationDomains: existingIntegrationDomains(root),
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
  const compatibility = checkCompatibility({ project_schema: project?.schema, plugin_version: version });
  if (!compatibility.compatible) fail(`${compatibility.reason}; automatic migration from previous ADW schemas is not supported`, {
    plugin_version: version,
    project_schema: project.schema,
    supported_project_schema: CURRENT_PROJECT_SCHEMA,
    compatible: false,
    writes: [],
  });
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
    project_schema: project.schema,
    supported_project_schema: CURRENT_PROJECT_SCHEMA,
    compatible: true,
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
