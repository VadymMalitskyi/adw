#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAtomicMigration } from "../../../lib/adw-helper.mjs";

const skillDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(skillDirectory, "../..");

function fail(message, details = {}) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: message, ...details })}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  const args = { action: "report" };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "report" || value === "fix") args.action = value;
    else if (value === "--project-root") args.projectRoot = argv[++index];
    else if (value === "--proposal") args.proposal = argv[++index];
    else if (value === "--authorized") args.authorized = true;
    else if (value === "--push-authorized") args.pushAuthorized = true;
    else fail(`unknown argument: ${value}`);
  }
  if (!args.projectRoot) fail("--project-root is required");
  if (args.action === "fix" && (!args.authorized || !args.proposal)) fail("fix requires --authorized and --proposal after review of the exact proposed diff");
  if (args.pushAuthorized && (args.action !== "fix" || !args.authorized)) fail("--push-authorized is valid only for an authorized fix");
  return args;
}

function git(root, arguments_, { allowFailure = false, locks = false } = {}) {
  const result = spawnSync("git", arguments_, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: locks ? "1" : "0" },
  });
  if (!allowFailure && result.status !== 0) throw new Error(`git ${arguments_.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return { status: result.status, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

function scalar(value) {
  const text = value.trim();
  if (text === "null" || text === "~") return null;
  if (text.startsWith('"')) {
    try { return JSON.parse(text); } catch { throw new Error(`invalid quoted YAML scalar: ${text}`); }
  }
  if (text.startsWith("'")) return text.endsWith("'") ? text.slice(1, -1).replaceAll("''", "'") : text;
  return text.replace(/\s+#.*$/, "");
}

function block(text, name) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `${name}:`);
  if (start === -1) throw new Error(`adw.yaml is missing ${name}`);
  const selected = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) break;
    selected.push(lines[index]);
  }
  return selected;
}

function parseProject(text) {
  const documentation = {};
  for (const line of block(text, "documentation")) {
    const match = /^  ([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (match) documentation[match[1]] = scalar(match[2]);
  }
  const components = [];
  let current;
  for (const line of block(text, "components")) {
    const heading = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (heading) { current = { name: heading[1] }; components.push(current); continue; }
    const path = /^    path:\s*(.+?)\s*$/.exec(line);
    if (path && current) current.path = scalar(path[1]);
  }
  for (const key of ["branch", "worktree", "sync_marker", "delivery"]) if (!documentation[key]) throw new Error(`adw.yaml documentation.${key} is required`);
  if (!/^worktrees\/[^/]+$/.test(documentation.worktree)) throw new Error("documentation.worktree must be a root-level worktrees/<name> path");
  if (documentation.sync_marker !== "SYNC.yaml") throw new Error("documentation.sync_marker must be SYNC.yaml");
  if (gitCheckRef(documentation.branch) === false) throw new Error(`invalid documentation branch name: ${documentation.branch}`);
  return { documentation, components: components.filter((item) => typeof item.path === "string") };
}

function gitCheckRef(branch) {
  const result = spawnSync("git", ["check-ref-format", `refs/heads/${branch}`], { encoding: "utf8" });
  return result.status === 0;
}

function parseMarker(text) {
  const marker = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([a-z_]+):\s*(.+?)\s*$/.exec(line);
    if (match) marker[match[1]] = scalar(match[2]);
  }
  if (!marker.code_branch || !marker.reviewed_through) throw new Error("SYNC.yaml requires code_branch and reviewed_through");
  return marker;
}

function assertRoot(input) {
  const root = realpathSync(input);
  const top = realpathSync(git(root, ["rev-parse", "--show-toplevel"]).stdout);
  if (root !== top) throw new Error(`project root must be the Git top level: ${top}`);
  return root;
}

function assertClean(root, label) {
  const status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]).stdout;
  if (status) throw new Error(`${label} worktree is dirty; commit, stash, or discard those changes before synchronization`);
}

function assertLocalBranchCanPush(docsRoot, branch) {
  const remoteRef = `refs/remotes/origin/${branch}`;
  if (git(docsRoot, ["show-ref", "--verify", "--quiet", remoteRef], { allowFailure: true }).status !== 0) return { state: "no-tracking-ref" };
  const remote = git(docsRoot, ["rev-parse", remoteRef]).stdout;
  const local = git(docsRoot, ["rev-parse", "HEAD"]).stdout;
  const ancestor = git(docsRoot, ["merge-base", "--is-ancestor", remote, local], { allowFailure: true });
  if (ancestor.status !== 0) throw new Error(`docs branch is behind or diverged from origin/${branch}; fast-forward it before synchronization`);
  return { state: remote === local ? "up-to-date" : "local-ahead", remote, local };
}

function classify(path, components) {
  if (path === "README.md" || path.startsWith("docs/")) return "authoritative-documentation";
  if (path === "package.json" || /(?:^|\/)(?:[^/]+\.)?(?:lock|toml|gradle|csproj)$/.test(path)) return "manifest-or-build";
  if (path.startsWith(".github/workflows/") || path.startsWith(".gitlab-ci")) return "ci";
  const component = components.find((item) => item.path === "." || path === item.path || path.startsWith(`${item.path.replace(/\/$/, "")}/`));
  return component ? `component:${component.name}` : "unmapped";
}

function reportState(root, config) {
  const docsRoot = realpathSync(join(root, config.documentation.worktree));
  const docsRelative = relative(root, docsRoot);
  if (docsRelative === ".." || docsRelative.startsWith(`..${sep}`)) throw new Error("configured docs worktree resolves outside the project root");
  const docsTop = realpathSync(git(docsRoot, ["rev-parse", "--show-toplevel"]).stdout);
  if (docsTop !== docsRoot) throw new Error("configured documentation worktree is not a Git top level");
  const docsBranch = git(docsRoot, ["branch", "--show-current"]).stdout;
  if (docsBranch !== config.documentation.branch) throw new Error(`configured docs worktree is on ${docsBranch || "detached HEAD"}, expected ${config.documentation.branch}`);
  assertClean(root, "code");
  assertClean(docsRoot, "docs");
  const tracking = assertLocalBranchCanPush(docsRoot, config.documentation.branch);
  const markerPath = join(docsRoot, config.documentation.sync_marker);
  if (!existsSync(markerPath)) throw new Error(`missing documentation sync marker ${config.documentation.sync_marker}`);
  const marker = parseMarker(readFileSync(markerPath, "utf8"));
  const codeBranch = git(root, ["branch", "--show-current"]).stdout;
  if (!codeBranch || codeBranch !== marker.code_branch) throw new Error(`code checkout must be on marker branch ${marker.code_branch}; found ${codeBranch || "detached HEAD"}`);
  if (git(root, ["cat-file", "-e", `${marker.reviewed_through}^{commit}`], { allowFailure: true }).status !== 0) throw new Error(`SYNC.yaml reviewed_through is not a local commit: ${marker.reviewed_through}`);
  if (git(root, ["merge-base", "--is-ancestor", marker.reviewed_through, "HEAD"], { allowFailure: true }).status !== 0) throw new Error("SYNC.yaml reviewed_through is not an ancestor of the code branch; resolve the rewritten or divergent history manually");
  const head = git(root, ["rev-parse", "HEAD"]).stdout;
  const raw = git(root, ["diff", "--name-status", `${marker.reviewed_through}..${head}`, "--"]).stdout;
  const changes = raw ? raw.split("\n").map((line) => {
    const [status, ...paths] = line.split("\t");
    const path = paths.at(-1);
    return { status, path, previous_path: paths.length > 1 ? paths[0] : undefined, category: classify(path, config.components) };
  }) : [];
  return { docsRoot, markerPath, marker, head, changes, tracking, docsBranch };
}

function proposalOperations(proposalPath, docsRoot) {
  let proposal;
  try { proposal = JSON.parse(readFileSync(proposalPath, "utf8")); } catch (error) { throw new Error(`cannot read proposal JSON: ${error.message}`); }
  if (!proposal || !Array.isArray(proposal.files)) throw new Error("proposal must contain a files array");
  return proposal.files.map((file) => {
    if (!file || typeof file.path !== "string" || typeof file.content !== "string" || !(file.expected_content === null || typeof file.expected_content === "string")) {
      throw new Error("each proposal file requires path, content, and expected_content (string or null)");
    }
    const path = normalize(file.path).replaceAll("\\", "/");
    if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`) || path.includes("\0")) throw new Error(`proposal path escapes docs worktree: ${file.path}`);
    if (!(path === "architecture.md" || /^components\/[A-Za-z0-9._-]+\.md$/.test(path))) {
      throw new Error(`protected documentation path cannot be synchronized: ${file.path}`);
    }
    const destination = resolve(docsRoot, path);
    if (relative(docsRoot, destination).startsWith("..")) throw new Error(`proposal path escapes docs worktree: ${file.path}`);
    return { path, content: file.content, expected_content: file.expected_content };
  });
}

function markerText(marker, head) {
  const branch = JSON.stringify(String(marker.code_branch));
  return `code_branch: ${branch}\nreviewed_through: ${JSON.stringify(head)}\nupdated_at: ${JSON.stringify(new Date().toISOString())}\n`;
}

try {
  const args = parseArguments(process.argv.slice(2));
  const root = assertRoot(args.projectRoot);
  const config = parseProject(readFileSync(join(root, "adw.yaml"), "utf8"));
  const state = reportState(root, config);
  const baseReport = {
    ok: true,
    mode: args.action,
    read_only: args.action === "report",
    plugin_root: pluginRoot,
    code_branch: state.marker.code_branch,
    reviewed_through: state.marker.reviewed_through,
    code_head: state.head,
    changes: state.changes,
    drift: state.changes.length > 0,
    authoritative_docs: state.changes.filter((item) => item.category === "authoritative-documentation").map((item) => item.path),
    allowed_context_targets: ["architecture.md", "components/*.md"],
    tracking: state.tracking,
  };
  if (args.action === "report") {
    process.stdout.write(`${JSON.stringify(baseReport, null, 2)}\n`);
  } else {
    const operations = proposalOperations(args.proposal, state.docsRoot);
    const markerRelative = relative(state.docsRoot, state.markerPath);
    operations.push({ path: markerRelative, content: markerText(state.marker, state.head), expected_content: readFileSync(state.markerPath, "utf8") });
    if (args.pushAuthorized) {
      if (config.documentation.delivery !== "direct-push") throw new Error("configured documentation delivery is not direct-push");
      git(state.docsRoot, ["var", "GIT_AUTHOR_IDENT"]);
    }
    await applyAtomicMigration(state.docsRoot, operations);
    const diff = git(state.docsRoot, ["diff", "--no-ext-diff", "--", ...operations.map((item) => item.path)]).stdout;
    const result = { ...baseReport, read_only: false, written: operations.map((item) => item.path), diff, committed: false, pushed: false };
    if (args.pushAuthorized) {
      git(state.docsRoot, ["add", "--", ...operations.map((item) => item.path)], { locks: true });
      git(state.docsRoot, ["commit", "-m", `Synchronize docs through ${state.head.slice(0, 12)}`], { locks: true });
      result.committed = true;
      result.docs_commit = git(state.docsRoot, ["rev-parse", "HEAD"]).stdout;
      const pushed = git(state.docsRoot, ["push", "origin", `${state.docsBranch}:${state.docsBranch}`], { allowFailure: true, locks: true });
      if (pushed.status !== 0) throw new Error(`non-force docs push failed; the local commit was preserved for recovery: ${pushed.stderr || pushed.stdout}`);
      result.pushed = true;
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  fail(error.message);
}
