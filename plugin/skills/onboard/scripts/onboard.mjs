#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAPABILITIES,
  loadLocalAnswers,
  localConfigurationSummary,
  renderLocalConfiguration,
} from "../../../lib/local-configuration.mjs";
import { loadArtifactFile } from "../../../lib/adw-helper.mjs";

const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function fail(message) {
  throw new Error(message);
}

function parseArguments(argv) {
  const args = { action: "preview" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "preview" || value === "apply") args.action = value;
    else if (value === "--confirmed") args.confirmed = true;
    else if (value === "--replace-local") args.replaceLocal = true;
    else if (value === "--project-root") args.projectRoot = argv[++index];
    else if (value === "--answers") args.answersPath = argv[++index];
    else if (value === "--preview-digest") args.previewDigest = argv[++index];
    else fail(`unknown argument: ${value}`);
  }
  if (!args.projectRoot) fail("--project-root is required");
  if (!args.answersPath) fail("--answers is required");
  if (args.action === "apply" && !args.confirmed) fail("apply requires --confirmed after the user approves the preview");
  return args;
}

function git(projectRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  if (!allowFailure && result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function projectRoot(input) {
  const root = realpathSync(input);
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (realpathSync(top.stdout) !== root) fail(`project root must be the Git top level: ${top.stdout}`);
  return root;
}

async function parseProjectConfiguration(root) {
  const path = join(root, "adw.yaml");
  if (!existsSync(path)) fail("adw.yaml is missing; only a project maintainer should initialize the project with adw:init");
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile()) fail("adw.yaml must be a non-symlink file");
  const source = readFileSync(path, "utf8");
  const loaded = await loadArtifactFile({ project_root: root, path: "adw.yaml", artifact: "project" });
  const project = loaded.data;
  const validation = loaded.validation;
  if (!validation.valid) fail(`adw.yaml is invalid: ${validation.errors.map((item) => `${item.path} ${item.message}`).join("; ")}`);
  const { mode, branch, worktree } = project.documentation;
  if (mode !== "branch") fail("documentation.mode must equal branch");
  if (branch.startsWith("-") || git(root, ["check-ref-format", `refs/heads/${branch}`], { allowFailure: true }).status !== 0) {
    fail(`documentation.branch is not a safe Git branch name: ${branch}`);
  }
  const worktreeTarget = resolve(root, worktree);
  const relativeTarget = relative(root, worktreeTarget);
  if (!/^worktrees\/[^/]+$/.test(worktree) || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`)) {
    fail("documentation.worktree must be a confined root-relative worktrees/<name> path");
  }

  const integrations = Object.fromEntries(CAPABILITIES.filter((capability) => project.integrations?.[capability]).map((capability) => [capability, project.integrations[capability]]));
  return { source, documentation: { branch, worktree, target: worktreeTarget }, integrations };
}

function worktreeRecords(root) {
  const output = git(root, ["worktree", "list", "--porcelain"]).stdout;
  if (!output) return [];
  return output.split(/\n\n+/).map((paragraph) => {
    const record = {};
    for (const line of paragraph.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) record[line] = true;
      else record[line.slice(0, space)] = line.slice(space + 1);
    }
    return record;
  }).filter((record) => record.worktree);
}

function docsPlan(root, documentation) {
  const tracked = git(root, ["ls-files", "--error-unmatch", "--", documentation.worktree], { allowFailure: true });
  if (tracked.status === 0) fail(`${documentation.worktree} is tracked by Git; repair project initialization before attaching a local worktree`);
  const ignored = git(root, ["check-ignore", "--no-index", "--quiet", documentation.worktree], { allowFailure: true });
  if (ignored.status !== 0) fail(`${documentation.worktree} is not ignored by Git; repair project initialization before attaching a local worktree`);
  const records = worktreeRecords(root);
  const branchRef = `refs/heads/${documentation.branch}`;
  const atTarget = records.find((record) => resolve(record.worktree) === documentation.target);
  if (atTarget) {
    if (atTarget.branch !== branchRef) fail(`${documentation.worktree} is registered for ${atTarget.branch ?? "a detached commit"}, not ${documentation.branch}`);
    return { action: "reuse", path: documentation.worktree, branch: documentation.branch };
  }
  const elsewhere = records.find((record) => record.branch === branchRef);
  if (elsewhere) fail(`${documentation.branch} is already checked out at ${elsewhere.worktree}; move it to ${documentation.worktree} manually`);
  if (existsSync(documentation.target)) fail(`${documentation.worktree} exists but is not the configured Git worktree; move it aside before onboarding`);

  const local = git(root, ["show-ref", "--verify", "--quiet", branchRef], { allowFailure: true });
  if (local.status === 0) return { action: "attach-local", path: documentation.worktree, branch: documentation.branch };

  const remoteNames = git(root, ["remote"]).stdout.split("\n").filter(Boolean);
  const configuredRefs = new Set(remoteNames.map((remote) => `refs/remotes/${remote}/${documentation.branch}`));
  const remoteRefs = git(root, ["for-each-ref", "--format=%(refname)", "refs/remotes"]).stdout
    .split("\n")
    .filter((ref) => configuredRefs.has(ref));
  if (remoteRefs.length === 0) fail(`no local or remote-tracking ${documentation.branch} branch is available; fetch the configured docs branch and rerun adw:onboard`);
  if (remoteRefs.length > 1) fail(`multiple remotes expose ${documentation.branch}; choose and create the local tracking branch before onboarding`);
  return {
    action: "attach-remote",
    path: documentation.worktree,
    branch: documentation.branch,
    start_point: remoteRefs[0],
  };
}

function localPlan(root, local) {
  const directory = join(root, ".adw");
  const path = join(directory, "local.yaml");
  if (existsSync(directory)) {
    const entry = lstatSync(directory);
    if (entry.isSymbolicLink() || !entry.isDirectory()) fail(".adw must be a non-symlink directory");
  }
  if (existsSync(path)) {
    const entry = lstatSync(path);
    if (entry.isSymbolicLink() || !entry.isFile()) fail(".adw/local.yaml must be a non-symlink file");
  }
  const tracked = git(root, ["ls-files", "--error-unmatch", "--", ".adw/local.yaml"], { allowFailure: true });
  if (tracked.status === 0) fail(".adw/local.yaml is tracked by Git; move personal settings out of committed history before onboarding");
  const ignored = git(root, ["check-ignore", "--no-index", "--quiet", ".adw/local.yaml"], { allowFailure: true });
  if (ignored.status !== 0) fail(".adw/local.yaml is not ignored by Git; repair project initialization before writing personal settings");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = renderLocalConfiguration(local);
  return {
    path,
    relativePath: ".adw/local.yaml",
    before,
    after,
    action: before === after ? "unchanged" : before ? "update-local" : "create-local",
  };
}

function previewDigest(root, project, docs, local) {
  const head = git(root, ["rev-parse", "HEAD"]).stdout;
  const payload = {
    project_root: root,
    code_head: head,
    project_configuration: project.source,
    docs,
    local: { path: local.relativePath, action: local.action, before: local.before, after: local.after },
  };
  return createHash("sha256").update("ADW-ONBOARD-PREVIEW-V1\0").update(JSON.stringify(payload)).digest("hex");
}

function attachDocs(root, docs) {
  if (docs.action === "reuse") return;
  const target = resolve(root, docs.path);
  const parent = dirname(target);
  if (existsSync(parent)) {
    const entry = lstatSync(parent);
    if (entry.isSymbolicLink() || !entry.isDirectory()) fail(`${relative(root, parent)} must be a non-symlink directory`);
  } else {
    mkdirSync(parent, { recursive: true });
  }
  if (docs.action === "attach-local") git(root, ["-c", "core.hooksPath=/dev/null", "worktree", "add", target, docs.branch]);
  else if (docs.action === "attach-remote") git(root, ["-c", "core.hooksPath=/dev/null", "worktree", "add", "--track", "-b", docs.branch, target, docs.start_point]);
  else fail(`unsupported docs action: ${docs.action}`);
}

function writeLocal(local) {
  if (local.action === "unchanged") return;
  mkdirSync(dirname(local.path), { recursive: true });
  const temporary = `${local.path}.tmp-${process.pid}`;
  writeFileSync(temporary, local.after, { encoding: "utf8", mode: 0o600, flag: "wx" });
  renameSync(temporary, local.path);
}

try {
  const args = parseArguments(process.argv.slice(2));
  const root = projectRoot(args.projectRoot);
  const project = await parseProjectConfiguration(root);
  const local = loadLocalAnswers(args.answersPath, project.integrations, pluginRoot);
  const docs = docsPlan(root, project.documentation);
  const localFile = localPlan(root, local);
  const digest = previewDigest(root, project, docs, localFile);
  const summary = {
    ok: true,
    mode: args.action,
    preview_digest: digest,
    project_root: root,
    docs,
    local: { path: localFile.relativePath, action: localFile.action, ...localConfigurationSummary(local) },
    integrations: Object.fromEntries(Object.entries(project.integrations).map(([capability, value]) => [capability, {
      provider: value.provider,
      requirement: value.requirement,
    }])),
  };
  if (args.action === "preview") {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    if (args.previewDigest !== digest) fail("apply requires the exact --preview-digest shown for the reviewed onboarding preview");
    if (localFile.action === "update-local" && !args.replaceLocal) fail("updating an existing .adw/local.yaml requires --replace-local after explicit confirmation that omitted fields will be cleared");
    attachDocs(root, docs);
    writeLocal(localFile);
    process.stdout.write(`${JSON.stringify({ ...summary, applied: true }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 2;
}
