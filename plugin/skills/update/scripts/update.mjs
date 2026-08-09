#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAtomicMigration, checkCompatibility } from "../../../lib/adw-helper.mjs";
import { CODEX_RULES, PERMISSION_PROFILE, managedClaudeSettings, permissionAgentsFromProject, permissionProjectFiles } from "../../../execution/managed-development.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");

function fail(message, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...details })}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const args = { action: "preview" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "preview" || value === "apply") args.action = value;
    else if (value === "--project-root") args.projectRoot = argv[++index];
    else if (value === "--confirmed") args.confirmed = true;
    else if (value === "--preview-digest") args.previewDigest = argv[++index];
    else fail(`unknown argument: ${value}`);
  }
  if (!args.projectRoot) fail("--project-root is required");
  return args;
}

function git(root, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (!allowFailure && result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return { status: result.status, stdout: result.stdout.trim() };
}

function projectRoot(input) {
  const root = realpathSync(input);
  const top = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).stdout);
  if (root !== top) throw new Error(`project root must be the Git top level: ${top}`);
  return root;
}

function readProjectFile(root, path, { optional = false } = {}) {
  const destination = join(root, path);
  if (!existsSync(destination)) {
    if (optional) return "";
    throw new Error(`${path} is missing`);
  }
  if (lstatSync(destination).isSymbolicLink()) throw new Error(`${path} cannot be migrated through a symbolic link`);
  const rel = relative(realpathSync(root), realpathSync(destination));
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel)) throw new Error(`${path} resolves outside the project root`);
  return readFileSync(destination, "utf8");
}

function schemaVersion(text) {
  const matches = [...text.matchAll(/^schema:\s*([0-9]+)\s*(?:#.*)?$/gm)];
  if (matches.length !== 1) throw new Error("adw.yaml must contain exactly one top-level integer schema field");
  return Number(matches[0][1]);
}

function supportedSchemas() {
  const versions = readdirSync(join(pluginRoot, "schemas"))
    .map((name) => /^project\.v([0-9]+)\.schema\.json$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b);
  return versions.length === 0 ? [] : [versions.at(-1)];
}

function pluginVersion() {
  return JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
}

function validateLegacyShape(text) {
  for (const section of ["git", "documentation", "components", "validation"]) {
    if (!new RegExp(`^${section}:\\s*$`, "m").test(text)) throw new Error(`legacy schema 0 configuration is missing required ${section} section; migrate manually`);
  }
}

function managedContainerOperations(root) {
  const directory = join(root, ".devcontainer");
  const templateDirectory = join(pluginRoot, "templates/devcontainer");
  const dockerPath = join(directory, "Dockerfile");
  const postCreatePath = join(directory, "post-create.sh");
  if (!existsSync(dockerPath) || !existsSync(postCreatePath)) throw new Error("managed-devcontainer migration requires its Dockerfile and post-create.sh");
  const currentDocker = readFileSync(join(templateDirectory, "Dockerfile"), "utf8");
  const legacyDocker = currentDocker
    .replace(/^COPY \.devcontainer\/(?:codex\.rules|claude-settings\.json|claude-permission-hook\.mjs).*\n/gm, "")
    .replace(" /etc/adw/codex.rules", "")
    .replace(" /etc/claude-code/managed-settings.d/20-adw.json", "")
    .replace(" /usr/local/bin/adw-claude-permission-hook", "")
    .replace(" /etc/adw/codex.rules", "")
    .replace(" /etc/claude-code/managed-settings.d/20-adw.json", "")
    .replace(" /usr/local/bin/adw-claude-permission-hook", "");
  const currentPostCreate = readFileSync(join(templateDirectory, "post-create.sh"), "utf8");
  const legacyPostCreate = currentPostCreate.replace(/\nif \[\[ "\$agent_tools" == "codex"[\s\S]*?\nfi\n/, "\n");
  const allowedDomains = readProjectFile(root, ".devcontainer/allowed-domains.txt").split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const claudeSettings = managedClaudeSettings({ allowedDomains });
  const operations = [];
  for (const [path, current, legacy] of [
    [".devcontainer/Dockerfile", currentDocker, legacyDocker],
    [".devcontainer/post-create.sh", currentPostCreate, legacyPostCreate],
  ]) {
    const previous = readProjectFile(root, path);
    if (previous === current) continue;
    if (previous !== legacy) throw new Error(`${path} has drifted from the prior ADW managed template; migrate it through a separate reviewed change`);
    operations.push({ path, content: current, expected_content: previous });
  }
  for (const [path, content] of [
    [".devcontainer/codex.rules", CODEX_RULES],
    [".devcontainer/claude-settings.json", claudeSettings],
    [".devcontainer/claude-permission-hook.mjs", readFileSync(join(templateDirectory, "claude-permission-hook.mjs"), "utf8")],
  ]) {
    const previous = readProjectFile(root, path, { optional: true });
    if (previous && previous !== content) throw new Error(`${path} differs from the ADW managed-development policy`);
    if (previous !== content) operations.push({ path, content, expected_content: previous || null });
  }
  let marker;
  try { marker = JSON.parse(readProjectFile(root, ".devcontainer/adw-managed.json")); }
  catch (error) { throw new Error(`cannot migrate .devcontainer/adw-managed.json: ${error.message}`); }
  if (![1, 2].includes(marker.schema) || marker.profile !== "managed-devcontainer") throw new Error(".devcontainer/adw-managed.json is not a supported ADW managed marker");
  const hook = readFileSync(join(templateDirectory, "claude-permission-hook.mjs"), "utf8");
  const migratedMarker = {
    ...marker,
    schema: 2,
    plugin_version: pluginVersion(),
    permission_profile: PERMISSION_PROFILE,
    codex_rules_sha256: createHash("sha256").update(CODEX_RULES).digest("hex"),
    claude_settings_sha256: createHash("sha256").update(claudeSettings).digest("hex"),
    claude_hook_sha256: createHash("sha256").update(hook).digest("hex"),
  };
  const markerContent = `${JSON.stringify(migratedMarker, null, 2)}\n`;
  const previousMarker = readProjectFile(root, ".devcontainer/adw-managed.json");
  if (previousMarker !== markerContent) operations.push({ path: ".devcontainer/adw-managed.json", content: markerContent, expected_content: previousMarker });
  return operations;
}

function migrationPlan(root, text, current, supported) {
  const target = Math.max(...supported);
  let content;
  if ((current === 0 || current === 1 || current === 2) && target === 5) {
    if (current === 0) validateLegacyShape(text);
    const isolation = existsSync(join(root, ".devcontainer/devcontainer.json")) ? "project-devcontainer" : "provider-sandbox";
    const enforcement = isolation === "project-devcontainer" ? "required" : "preferred";
    const upgraded = text.replace(/^schema:[ \t]*[012][ \t]*(?:#.*)?$/m, "schema: 5");
    const separator = upgraded.endsWith("\n") ? "" : "\n";
    content = `${upgraded}${separator}\nexecution:\n  isolation: ${isolation}\n  enforcement: ${enforcement}\n  permissions:\n    profile: ${PERMISSION_PROFILE}\n`;
  }
  if ((current === 3 || current === 4) && target === 5) {
    content = text.replace(new RegExp(`^schema:[ \\t]*${current}[ \\t]*(?:#.*)?$`, "m"), "schema: 5");
    if (!/^  permissions:\s*$/m.test(content)) content = content.replace(/^(  enforcement:[^\n]*)$/m, `$1\n  permissions:\n    profile: ${PERMISSION_PROFILE}`);
  }
  if (!content) throw new Error(`no bundled, contiguous migration path from project schema ${current} to supported schemas ${supported.join(", ")}`);
  const operations = [{ path: "adw.yaml", content, expected_content: text }];
  const agentTools = permissionAgentsFromProject(root, { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join });
  const readExisting = (path) => readProjectFile(root, path, { optional: true });
  for (const file of permissionProjectFiles(agentTools, readExisting)) {
    const previous = readExisting(file.path);
    if (previous !== file.content) operations.push({ path: file.path, content: file.content, expected_content: previous || null });
  }
  if (/^  isolation:\s*managed-devcontainer\s*$/m.test(content)) operations.push(...managedContainerOperations(root));
  return { from_schema: current, to_schema: 5, operations };
}

function digest(plan) {
  return createHash("sha256").update("ADW-MIGRATION-PREVIEW-V1\0").update(JSON.stringify(plan)).digest("hex");
}

try {
  const args = parseArguments(process.argv.slice(2));
  const root = projectRoot(args.projectRoot);
  const configPath = join(root, "adw.yaml");
  const before = readFileSync(configPath, "utf8");
  const current = schemaVersion(before);
  const supported = supportedSchemas();
  const version = pluginVersion();
  const compatibility = current === 0 && supported.includes(5)
    ? { compatible: false, migration_required: true, reason: "legacy pre-schema project requires migration to schema 5" }
    : checkCompatibility({ project_schema: current, supported_project_schemas: supported, plugin_version: version });
  const base = { ok: true, mode: args.action, plugin_root: pluginRoot, plugin_version: version, project_schema: current, supported_project_schemas: supported, historical_artifacts: "untouched" };
  if (compatibility.compatible) {
    process.stdout.write(`${JSON.stringify({ ...base, compatible: true, migration_required: false, writes: [] }, null, 2)}\n`);
  } else if (!compatibility.migration_required) {
    fail(compatibility.reason, { compatible: false, migration_required: false });
  } else {
    const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
    if (status) throw new Error("project worktree is dirty; commit, stash, or discard changes before migration");
    const plan = migrationPlan(root, before, current, supported);
    const previewDigest = digest(plan);
    const diffs = plan.operations.map((operation) => ({ path: operation.path, before: operation.expected_content, after: operation.content }));
    const preview = { ...base, compatible: false, migration_required: true, from_schema: plan.from_schema, to_schema: plan.to_schema, writes: plan.operations.map(({ path }) => path), preview_digest: previewDigest, diffs, diff: diffs.length === 1 ? diffs[0] : undefined };
    if (args.action === "preview") {
      process.stdout.write(`${JSON.stringify(preview, null, 2)}\n`);
    } else {
      if (!args.confirmed || !args.previewDigest) throw new Error("apply requires --confirmed and the exact --preview-digest shown during preview");
      if (args.previewDigest !== previewDigest) throw new Error("migration preview is stale; run preview again and review the new digest");
      await applyAtomicMigration(root, plan.operations);
      const migratedSchema = schemaVersion(readFileSync(configPath, "utf8"));
      const afterCompatibility = checkCompatibility({ project_schema: migratedSchema, supported_project_schemas: supported, plugin_version: version });
      if (!afterCompatibility.compatible) throw new Error(`migration completed but compatibility validation failed: ${afterCompatibility.reason}`);
      process.stdout.write(`${JSON.stringify({ ...preview, mode: "apply", migrated: true, compatible_after: true }, null, 2)}\n`);
    }
  }
} catch (error) {
  fail(error.message);
}
