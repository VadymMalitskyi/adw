#!/usr/bin/env node
// The ADW runtime CLI.
//
// This file is a dispatcher and nothing else: it parses arguments, reads JSON
// from stdin when a command takes structured input, hands the work to the
// owning library module, and prints one JSON object. Domain behavior — path
// confinement, contract validation, policy rendering — lives in plugin/lib.
// Reasoning, including branch and worktree preparation with native Git,
// lives in skills.
import { mkdirSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, applyAtomicWrites } from "../lib/safe-files.mjs";
import { loadProjectConfig, validationCommands } from "../lib/config.mjs";
import { applyInitialization, planInitialization, refreshApply, refreshPreview } from "../lib/project-setup.mjs";
import { managedDevelopmentFiles } from "../lib/managed-environment.mjs";
import { runDoctor } from "../lib/doctor.mjs";
import { explainPermission } from "../lib/permission-policy.mjs";
import { executionAssertTarget, executionFinalize, executionPreflight } from "../lib/execution-finalizer.mjs";

const pluginRoot = resolve(fileURLToPath(import.meta.url), "../..");

const COMMANDS = [
  "config",
  "init-preview",
  "init-apply",
  "refresh-preview",
  "refresh-apply",
  "doctor",
  "permissions-explain",
  "render-managed",
  "execution-preflight",
  "execution-assert-target",
  "execution-finalize",
];

function parseArguments(argv) {
  const command = argv[0];
  const options = {};
  for (let index = 1; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) throw new Error(`unexpected argument: ${value}`);
    const key = value.slice(2);
    if (["details", "stdin"].includes(key)) options[key] = true;
    else options[key] = argv[++index];
  }
  return { command, options };
}

async function readStdin() {
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  if (text.trim() === "") return {};
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`stdin is not valid JSON: ${error.message}`); }
}

function requireProjectRoot(options) {
  if (!options["project-root"]) throw new Error("--project-root is required");
  return options["project-root"];
}

async function dispatch(command, options) {
  switch (command) {
    case "config": {
      const projectRoot = realpathSync(requireProjectRoot(options));
      const config = await loadProjectConfig(projectRoot);
      return {
        exitCode: config.valid ? EXIT.OK : EXIT.CONTRACT_INVALID,
        body: { ok: config.valid, project_root: projectRoot, config_source: config.source, config: config.data, validation_commands: config.valid ? validationCommands(config.data) : [], errors: config.errors },
      };
    }
    case "init-preview":
      return { exitCode: EXIT.OK, body: { ok: true, mode: "preview", ...stripFiles(planInitialization(requireProjectRoot(options), await readStdin())) } };
    case "init-apply": {
      if (!options.fingerprint) throw new Error("--fingerprint from the reviewed init preview is required");
      return { exitCode: EXIT.OK, body: { ok: true, mode: "apply", ...await applyInitialization(requireProjectRoot(options), await readStdin(), options.fingerprint) } };
    }
    case "refresh-preview":
      return { exitCode: EXIT.OK, body: { ok: true, mode: "preview", ...await refreshPreview(requireProjectRoot(options)) } };
    case "refresh-apply": {
      if (!options.fingerprint) throw new Error("--fingerprint from the reviewed refresh preview is required");
      return { exitCode: EXIT.OK, body: { ok: true, mode: "apply", ...await refreshApply(requireProjectRoot(options), options.fingerprint) } };
    }
    case "doctor": {
      const selection = options.checks ?? "all";
      if (!["all", "permissions"].includes(selection)) throw new Error("--checks must be all or permissions");
      const report = await runDoctor(requireProjectRoot(options), { details: options.details === true, checks: selection });
      return { exitCode: report.ok ? EXIT.OK : EXIT.CHECK_FAILED, body: report };
    }
    case "permissions-explain": {
      const projectRoot = realpathSync(requireProjectRoot(options));
      const config = await loadProjectConfig(projectRoot);
      if (!config.valid) return { exitCode: EXIT.CONTRACT_INVALID, body: { ok: false, project_root: projectRoot, errors: config.errors } };
      const explanation = explainPermission(config.data.permissions, await readStdin());
      return { exitCode: EXIT.OK, body: { ok: true, project_root: projectRoot, ...explanation } };
    }
    case "render-managed": {
      // Renders the managed container into a target directory without touching
      // project configuration. Used by build and security tests.
      const target = realpathSync(options.into ?? requireProjectRoot(options));
      const input = await readStdin();
      const generated = managedDevelopmentFiles(target, join(pluginRoot, "templates/devcontainer"), {
        webAccess: input.web_access ?? "public-pages",
        integrationDomains: input.integration_domains ?? [],
        runtimeVersions: input.runtime_versions ?? {},
      });
      mkdirSync(join(target, ".devcontainer"), { recursive: true });
      await applyAtomicWrites(target, [...generated.files].map(([name, content]) => ({ path: `.devcontainer/${name}`, content })));
      return { exitCode: EXIT.OK, body: { ok: true, project_root: target, files: [...generated.files.keys()], unresolved: generated.requirements.unresolved } };
    }
    case "execution-preflight": {
      const projectRoot = realpathSync(requireProjectRoot(options));
      return { exitCode: EXIT.OK, body: { ok: true, execution_envelope: executionPreflight(projectRoot, await readStdin()) } };
    }
    case "execution-assert-target": {
      const projectRoot = realpathSync(requireProjectRoot(options));
      return { exitCode: EXIT.OK, body: { ok: true, ...executionAssertTarget(projectRoot, await readStdin()) } };
    }
    case "execution-finalize": {
      const projectRoot = realpathSync(requireProjectRoot(options));
      const body = await executionFinalize(projectRoot, await readStdin());
      return { exitCode: body.status === "passed" ? EXIT.OK : EXIT.CHECK_FAILED, body: { ok: body.status === "passed", ...body } };
    }
    default:
      throw new Error(`unknown command ${JSON.stringify(command ?? "")}; expected one of: ${COMMANDS.join(", ")}`);
  }
}

// `files` carries the full before/after bytes the fingerprint is computed over.
// Skills receive the summary; the bytes stay inside the runtime.
function stripFiles({ files, ...summary }) {
  return summary;
}

try {
  const { command, options } = parseArguments(process.argv.slice(2));
  const result = await dispatch(command, options);
  process.stdout.write(`${JSON.stringify(result.body, null, 2)}\n`);
  process.exitCode = result.exitCode;
} catch (error) {
  const exitCode = Number.isInteger(error.code) ? error.code : EXIT.INPUT;
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: exitCode, message: error.message } }, null, 2)}\n`);
  process.exitCode = exitCode;
}
