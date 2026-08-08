#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAtomicMigration, checkCompatibility } from "../../../lib/adw-helper.mjs";

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

function migrationPlan(root, text, current, supported) {
  const target = Math.max(...supported);
  if ((current === 0 || current === 1 || current === 2) && target === 4) {
    if (current === 0) validateLegacyShape(text);
    const isolation = existsSync(join(root, ".devcontainer/devcontainer.json")) ? "project-devcontainer" : "provider-sandbox";
    const enforcement = isolation === "project-devcontainer" ? "required" : "preferred";
    const upgraded = text.replace(/^schema:[ \t]*[012][ \t]*(?:#.*)?$/m, "schema: 4");
    const separator = upgraded.endsWith("\n") ? "" : "\n";
    const content = `${upgraded}${separator}\nexecution:\n  isolation: ${isolation}\n  enforcement: ${enforcement}\n`;
    return { from_schema: current, to_schema: 4, operations: [{ path: "adw.yaml", content, expected_content: text }] };
  }
  if (current === 3 && target === 4) {
    const content = text.replace(/^schema:[ \t]*3[ \t]*(?:#.*)?$/m, "schema: 4");
    return { from_schema: 3, to_schema: 4, operations: [{ path: "adw.yaml", content, expected_content: text }] };
  }
  throw new Error(`no bundled, contiguous migration path from project schema ${current} to supported schemas ${supported.join(", ")}`);
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
  const compatibility = current === 0 && supported.includes(4)
    ? { compatible: false, migration_required: true, reason: "legacy pre-schema project requires migration to schema 4" }
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
    const preview = { ...base, compatible: false, migration_required: true, from_schema: plan.from_schema, to_schema: plan.to_schema, writes: ["adw.yaml"], preview_digest: previewDigest, diff: { path: "adw.yaml", before, after: plan.operations[0].content } };
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
