#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { validateExecutionEnvelope } from "../lib/execution-contract.mjs";
import { createCodexAdapter } from "../lib/execution-adapters/codex.mjs";
import { runExecutionGroups } from "../lib/execution-runner.mjs";
import { assertTargetState, checkoutSnapshot } from "../lib/execution-git.mjs";
const index = process.argv.indexOf("--project-root");
if (index < 0 || !process.argv[index + 1]) throw new Error("--project-root is required");
const root = realpathSync(process.argv[index + 1]); let source = ""; for await (const chunk of process.stdin) source += chunk;
const envelope = validateExecutionEnvelope(JSON.parse(source));
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const git = { assertTarget: (group, options) => assertTargetState(root, group, envelope.targets.find(({ group_id }) => group_id === group.group_id), options), snapshot: (group) => checkoutSnapshot(root, group.worktree).status, assertUnchanged: (group, before) => { if (checkoutSnapshot(root, group.worktree).status !== before) throw new Error("review mutated worktree"); } };
const result = await runExecutionGroups(envelope, { adapter: createCodexAdapter(), git, emit });
if (result.groups.some(({ status }) => status !== "passed")) process.exitCode = 5;
