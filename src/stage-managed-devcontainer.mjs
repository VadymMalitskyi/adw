#!/usr/bin/env node
import { mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAtomicWrites } from "../plugin/lib/adw-helper.mjs";
import { managedDevelopmentFiles } from "../plugin/initialization/development-environment.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stageRootArgument = process.argv[2];
if (!stageRootArgument) throw new Error("usage: stage-managed-devcontainer.mjs <existing-stage-root>");
const stageRoot = realpathSync(stageRootArgument);
mkdirSync(resolve(stageRoot, ".devcontainer"), { recursive: true });
const generated = managedDevelopmentFiles(stageRoot, resolve(repositoryRoot, "plugin/templates/devcontainer"), { agentTools: "both" });
await applyAtomicWrites(stageRoot, [...generated.files].map(([name, content]) => ({
  path: `.devcontainer/${name}`,
  content,
  expected_content: null,
})));
process.stdout.write(`${JSON.stringify({ ok: true, stage_root: stageRoot, files: [...generated.files.keys()] }, null, 2)}\n`);
