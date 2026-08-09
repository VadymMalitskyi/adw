#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCompatibility, CURRENT_PROJECT_SCHEMA } from "../../../lib/adw-helper.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");

function fail(message, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...details }, null, 2)}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const action = argv[0];
  if (!new Set(["preview", "apply"]).has(action) || argv.length !== 3 || argv[1] !== "--project-root" || !argv[2]) {
    throw new Error("usage: update.mjs <preview|apply> --project-root <path>");
  }
  return { action, projectRoot: argv[2] };
}

function projectRoot(input) {
  const root = realpathSync(input);
  const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0 || realpathSync(result.stdout.trim()) !== root) throw new Error("project root must be the Git top level");
  return root;
}

function schemaVersion(text) {
  const matches = [...text.matchAll(/^schema:\s*([0-9]+)\s*(?:#.*)?$/gm)];
  if (matches.length !== 1) throw new Error("adw.yaml must contain exactly one top-level integer schema field");
  return Number(matches[0][1]);
}

function pluginVersion() {
  const version = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8")).version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("installed plugin manifest has an invalid semantic version");
  return version;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const root = projectRoot(args.projectRoot);
  const current = schemaVersion(readFileSync(join(root, "adw.yaml"), "utf8"));
  const version = pluginVersion();
  const compatibility = checkCompatibility({ project_schema: current, plugin_version: version });
  const result = {
    ok: compatibility.compatible,
    mode: args.action,
    plugin_root: pluginRoot,
    plugin_version: version,
    project_schema: current,
    supported_project_schema: CURRENT_PROJECT_SCHEMA,
    compatible: compatibility.compatible,
    migration_required: false,
    writes: [],
  };
  if (!compatibility.compatible) fail(`${compatibility.reason}; automatic migration from previous ADW versions is not supported`, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  fail(error.message);
}
