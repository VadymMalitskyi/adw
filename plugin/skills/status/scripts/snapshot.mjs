#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyApprovalBundle, verifyApprovalDigest, validateArtifact } from "../../../lib/adw-helper.mjs";
import { permissionAgentsFromProject } from "../../../execution/managed-development.mjs";

function parseArguments(argv) {
  const index = argv.indexOf("--project-root");
  if (index === -1 || !argv[index + 1]) throw new Error("--project-root is required");
  return { projectRoot: realpathSync(argv[index + 1]) };
}

function git(projectRoot, args, cwd = projectRoot) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
}

function readJson(path) {
  try { return { value: JSON.parse(readFileSync(path, "utf8")) }; }
  catch (error) { return { error: error.message }; }
}

function executionSnapshot(projectRoot) {
  const configPath = join(projectRoot, "adw.yaml");
  if (!existsSync(configPath)) return { configured: false, active: false, reason: "adw.yaml is missing" };
  const source = readFileSync(configPath, "utf8");
  const block = source.match(/^execution:\s*\n((?:^[ \t]+.*(?:\n|$))*)/m)?.[1] ?? "";
  const isolation = block.match(/^\s+isolation:\s*["']?([^\s"']+)/m)?.[1] ?? null;
  const enforcement = block.match(/^\s+enforcement:\s*["']?([^\s"']+)/m)?.[1] ?? null;
  const permissionProfile = block.match(/^\s+profile:\s*["']?([^\s"']+)/m)?.[1] ?? null;
  const agentTools = permissionAgentsFromProject(projectRoot, { existsSync, readFileSync, lstatSync, realpathSync, relative, isAbsolute, join });
  const providerArtifacts = {
    codex: existsSync(join(projectRoot, ".codex/config.toml")) && existsSync(join(projectRoot, ".codex/rules/adw.rules")),
    claude: existsSync(join(projectRoot, ".claude/settings.json")),
  };
  const markers = {
    managed_devcontainer: process.env.ADW_MANAGED_DEVCONTAINER === "1",
    project_devcontainer: process.env.ADW_PROJECT_DEVCONTAINER === "1" || process.env.REMOTE_CONTAINERS === "true" || process.env.CODESPACES === "true",
  };
  const active = isolation === "managed-devcontainer"
    ? markers.managed_devcontainer
    : isolation === "project-devcontainer"
      ? markers.project_devcontainer
      : isolation === "provider-sandbox"
        ? null
        : false;
  return { configured: Boolean(isolation && enforcement && permissionProfile), isolation, enforcement, permissions: { profile: permissionProfile, agent_tools: agentTools, provider_artifacts: providerArtifacts }, active, markers };
}

async function changeSnapshot(changePath, changeId) {
  const specPath = join(changePath, "spec.md");
  const planPath = join(changePath, "plan.yaml");
  const approvalPath = join(changePath, "approval.json");
  const integrationsPath = join(changePath, "integrations.yaml");
  const validationPath = join(changePath, "validation.json");
  const externalEventsPath = join(changePath, "external-events");
  const snapshot = {
    change_id: changeId,
    artifacts: {
      spec: existsSync(specPath),
      plan: existsSync(planPath),
      approval: existsSync(approvalPath),
      integrations: existsSync(integrationsPath),
      validation: existsSync(validationPath),
      external_events: existsSync(externalEventsPath) ? readdirSync(externalEventsPath).filter((name) => name.endsWith(".json")).length : 0,
    },
    approval: { state: "missing" },
    validation: { state: "missing" },
    external_actions: { total: 0, valid: 0, invalid: [] },
    state: "draft",
  };
  if (existsSync(externalEventsPath)) {
    const names = readdirSync(externalEventsPath).filter((name) => name.endsWith(".json")).sort();
    snapshot.external_actions.total = names.length;
    for (const name of names) {
      const parsed = readJson(join(externalEventsPath, name));
      if (parsed.error) snapshot.external_actions.invalid.push({ path: name, reason: parsed.error });
      else {
        const schema = await validateArtifact("external-action", parsed.value);
        if (schema.valid) snapshot.external_actions.valid += 1;
        else snapshot.external_actions.invalid.push({ path: name, reason: "external action schema is invalid" });
      }
    }
  }
  if (existsSync(approvalPath)) {
    const parsed = readJson(approvalPath);
    if (parsed.error) snapshot.approval = { state: "invalid", reason: parsed.error };
    else {
      const schema = await validateArtifact("approval", parsed.value);
      let digestMatches = false;
      if (schema.valid && parsed.value.schema === 2) {
        const paths = parsed.value.inputs.map(({ path }) => path);
        const present = paths.every((path) => existsSync(join(changePath, path)));
        digestMatches = present && verifyApprovalBundle(paths.map((path) => ({ path, content: readFileSync(join(changePath, path)) })), parsed.value);
      } else if (schema.valid && parsed.value.schema === 1) {
        digestMatches = snapshot.artifacts.spec && snapshot.artifacts.plan && verifyApprovalDigest(readFileSync(specPath), readFileSync(planPath), parsed.value);
      }
      const active = schema.valid && parsed.value.status === "active" && digestMatches;
      snapshot.approval = {
        state: active ? "active" : "invalid",
        approver: parsed.value.approver,
        approved_at: parsed.value.approved_at,
        docs_commit: parsed.value.docs_commit,
        reason: active ? "digest matches current approval input bytes" : !schema.valid ? "approval schema is invalid" : parsed.value.status !== "active" ? "approval is superseded" : "approval digest is stale",
      };
    }
  }
  if (existsSync(validationPath)) {
    const parsed = readJson(validationPath);
    if (parsed.error) snapshot.validation = { state: "invalid", reason: parsed.error };
    else {
      const schema = await validateArtifact("validation", parsed.value);
      snapshot.validation = {
        state: schema.valid ? parsed.value.status : "invalid",
        recorded_at: parsed.value.recorded_at,
        code_commit: parsed.value.code_commit,
        docs_commit: parsed.value.docs_commit,
        reason: schema.valid ? undefined : "validation schema is invalid",
      };
    }
  }
  if (snapshot.validation.state === "passed") snapshot.state = "validated";
  else if (snapshot.validation.state === "failed") snapshot.state = "validation-failed";
  else if (snapshot.approval.state === "active") snapshot.state = "approved";
  else if (snapshot.artifacts.spec || snapshot.artifacts.plan) snapshot.state = "planned";
  return snapshot;
}

function worktreeSnapshot(projectRoot) {
  const result = git(projectRoot, ["worktree", "list", "--porcelain"]);
  if (result.status !== 0) return [];
  return result.stdout.trim().split(/\n\n+/).filter(Boolean).map((paragraph) => {
    const item = {};
    for (const line of paragraph.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) item[line] = true;
      else item[line.slice(0, space)] = line.slice(space + 1);
    }
    return item;
  });
}

try {
  const { projectRoot } = parseArguments(process.argv.slice(2));
  const top = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== projectRoot) throw new Error("project root must be the Git top level");
  const branch = git(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  const head = git(projectRoot, ["rev-parse", "HEAD"]);
  const porcelain = git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  const worktrees = worktreeSnapshot(projectRoot);
  const docsPath = join(projectRoot, "worktrees/docs");
  const changesPath = join(docsPath, "changes");
  const changeIds = existsSync(changesPath)
    ? readdirSync(changesPath).filter((name) => {
      if (!/^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-]+)*$/.test(name)) return false;
      const entry = lstatSync(join(changesPath, name));
      return !entry.isSymbolicLink() && entry.isDirectory();
    }).sort()
    : [];
  const changes = [];
  for (const changeId of changeIds) changes.push(await changeSnapshot(join(changesPath, changeId), changeId));
  const docsHead = existsSync(docsPath) ? git(projectRoot, ["rev-parse", "HEAD"], docsPath) : { status: 1, stdout: "" };
  const docsDirty = existsSync(docsPath) ? git(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"], docsPath) : { status: 1, stdout: "" };
  process.stdout.write(`${JSON.stringify({
    ok: true,
    read_only: true,
    project_root: projectRoot,
    code: {
      branch: branch.status === 0 ? branch.stdout.trim() : null,
      head: head.status === 0 ? head.stdout.trim() : null,
      dirty: porcelain.status === 0 ? porcelain.stdout.trim().split("\n").filter(Boolean) : [],
    },
    docs: {
      attached: worktrees.some((item) => item.branch === "refs/heads/docs" && resolve(item.worktree) === docsPath),
      path: "worktrees/docs",
      head: docsHead.status === 0 ? docsHead.stdout.trim() : null,
      dirty: docsDirty.status === 0 ? docsDirty.stdout.trim().split("\n").filter(Boolean) : [],
    },
    execution: executionSnapshot(projectRoot),
    changes,
    pull_requests: { state: "not-queried", reason: "local snapshot does not access the network; query the configured code_host capability separately" },
    draft_prs: { state: "not-queried", reason: "compatibility alias; query pull_requests through the configured code_host capability" },
  }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, read_only: true, error: error.message })}\n`);
  process.exitCode = 2;
}
