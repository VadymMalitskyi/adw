#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyApprovalDigest, validateArtifact } from "../../../lib/adw-helper.mjs";

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

async function changeSnapshot(changePath, changeId) {
  const specPath = join(changePath, "spec.md");
  const planPath = join(changePath, "plan.yaml");
  const approvalPath = join(changePath, "approval.json");
  const validationPath = join(changePath, "validation.json");
  const snapshot = {
    change_id: changeId,
    artifacts: {
      spec: existsSync(specPath),
      plan: existsSync(planPath),
      approval: existsSync(approvalPath),
      validation: existsSync(validationPath),
    },
    approval: { state: "missing" },
    validation: { state: "missing" },
    state: "draft",
  };
  if (existsSync(approvalPath)) {
    const parsed = readJson(approvalPath);
    if (parsed.error) snapshot.approval = { state: "invalid", reason: parsed.error };
    else {
      const schema = await validateArtifact("approval", parsed.value);
      const digestMatches = snapshot.artifacts.spec && snapshot.artifacts.plan && verifyApprovalDigest(readFileSync(specPath), readFileSync(planPath), parsed.value);
      const active = schema.valid && parsed.value.status === "active" && digestMatches;
      snapshot.approval = {
        state: active ? "active" : "invalid",
        approver: parsed.value.approver,
        approved_at: parsed.value.approved_at,
        docs_commit: parsed.value.docs_commit,
        reason: active ? "digest matches current spec and plan bytes" : !schema.valid ? "approval schema is invalid" : parsed.value.status !== "active" ? "approval is superseded" : "approval digest is stale",
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
    changes,
    draft_prs: { state: "not-queried", reason: "local snapshot does not access the network; query the configured GitHub integration separately" },
  }, null, 2)}\n`);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ ok: false, read_only: true, error: error.message })}\n`);
  process.exitCode = 2;
}
