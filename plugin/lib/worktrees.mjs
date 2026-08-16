// Deterministic Git mechanics for parallel execution groups.
//
// This module prepares and inspects one isolated branch and worktree per group.
// It never spawns agents, implements tasks, commits implementation work,
// pushes, opens pull requests, or mutates trackers: the coordinating skill owns
// all of that. What lives here is exactly the part that must not be
// interpreted — path disjointness, confinement, and a durable marker commit
// that lets a later session resume from Git alone rather than from chat
// history.
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { ContractError, InputError, PathError, isObject, isSafeRelativePath, normalizeRelativePath } from "./safe-files.mjs";
import { isValidBranchName } from "./config.mjs";

const IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const CHANGE_ID = /^[a-z0-9](?:[a-z0-9_-]|\.[a-z0-9_-]+)*$/;
const COMMIT = /^[0-9a-f]{40}$/;
const MARKER_SUBJECT = "Prepare ADW execution group";
const TRAILERS = Object.freeze({
  change: "ADW-Change-ID",
  group: "ADW-Group-ID",
  baseBranch: "ADW-Base-Branch",
  baseCommit: "ADW-Base-Commit",
  packetDigest: "ADW-Packet-Digest",
});

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  if (!allowFailure && result.status !== 0) throw new InputError(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  return { status: result.status, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

function requireRelativePath(value, label) {
  if (!isSafeRelativePath(value)) throw new ContractError(`${label} must be an explicit traversal-free project-relative path`);
  const normalized = normalizeRelativePath(value.replace(/^\.\//, ""));
  if (normalized === ".") throw new ContractError(`${label} must not be the project root`);
  return normalized;
}

function assertInsideProject(projectRoot, relativePath, label) {
  const target = resolve(projectRoot, relativePath);
  const rel = relative(projectRoot, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new PathError(`${label} escapes the project root: ${relativePath}`);
  // Reject a symlinked ancestor so a prepared worktree cannot be redirected.
  let current = projectRoot;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new PathError(`${label} cannot be created through a symbolic link: ${relativePath}`);
  }
  return target;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

// The packet digest binds the interpreted work a group was prepared for, so a
// resumed group can prove it is still executing the same instructions.
function packetDigest(group) {
  const payload = { group_id: group.group_id, tasks: group.tasks, affected_paths: group.affected_paths, validation: group.validation };
  return createHash("sha256").update("ADW-GROUP-PACKET-V1\0").update(canonicalJson(payload)).digest("hex");
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

// Concurrent groups must not write the same files. A plan that genuinely needs
// a shared file must place that file in an earlier, sequential group.
function assertDisjointPaths(groups, sharedPaths) {
  const shared = new Set(sharedPaths.map((value, index) => requireRelativePath(value, `shared_paths[${index}]`)));
  for (let left = 0; left < groups.length; left += 1) {
    for (let right = left + 1; right < groups.length; right += 1) {
      for (const leftPath of groups[left].affected_paths) {
        for (const rightPath of groups[right].affected_paths) {
          if (!pathsOverlap(leftPath, rightPath)) continue;
          if (shared.has(leftPath) && shared.has(rightPath)) continue;
          throw new ContractError(`groups ${groups[left].group_id} and ${groups[right].group_id} both write ${leftPath === rightPath ? leftPath : `${leftPath} and ${rightPath}`}; parallel groups require disjoint write paths`);
        }
      }
    }
  }
}

export function normalizeGroupRequest(raw) {
  if (!isObject(raw)) throw new InputError("worktree input must be a JSON object");
  const projectRoot = realpathSync(String(raw.project_root ?? ""));
  const top = git(projectRoot, ["rev-parse", "--show-toplevel"]);
  if (realpathSync(top.stdout) !== projectRoot) throw new InputError("project_root must be the Git top level");
  if (typeof raw.change_id !== "string" || !CHANGE_ID.test(raw.change_id)) throw new ContractError("change_id must be a safe change id");
  if (!isValidBranchName(raw.base_branch)) throw new ContractError("base_branch must be a valid Git branch name");
  if (typeof raw.base_commit !== "string" || !COMMIT.test(raw.base_commit)) throw new ContractError("base_commit must be a 40-hex commit");
  if (!Array.isArray(raw.groups) || raw.groups.length === 0) throw new ContractError("at least one group is required");

  const groups = [];
  const ids = new Set();
  const branches = new Set();
  const worktrees = new Set();
  for (const item of raw.groups) {
    if (!isObject(item)) throw new ContractError("each group must be an object");
    const groupId = item.group_id;
    if (typeof groupId !== "string" || !IDENTIFIER.test(groupId)) throw new ContractError(`group_id must be a safe identifier: ${String(groupId)}`);
    if (ids.has(groupId)) throw new ContractError(`duplicate group id: ${groupId}`);
    ids.add(groupId);
    const tasks = item.tasks ?? [];
    if (!Array.isArray(tasks) || tasks.length === 0 || tasks.some((task) => typeof task !== "string" || task.length === 0)) {
      throw new ContractError(`group ${groupId} requires a non-empty list of interpreted task directives`);
    }
    const affected = (item.affected_paths ?? []).map((value, index) => requireRelativePath(value, `group ${groupId} affected_paths[${index}]`));
    if (affected.length === 0) throw new ContractError(`group ${groupId} requires at least one affected path`);
    const validation = (item.validation ?? []).map((entry, index) => {
      if (typeof entry === "string") return { command: entry, cwd: ".", required: true };
      if (!isObject(entry) || typeof entry.command !== "string" || entry.command.length === 0) throw new ContractError(`group ${groupId} validation[${index}] requires a command`);
      const cwd = entry.cwd === undefined || entry.cwd === "." ? "." : requireRelativePath(entry.cwd, `group ${groupId} validation[${index}].cwd`);
      return { command: entry.command, cwd, required: entry.required !== false, ...(entry.timeout_ms ? { timeout_ms: entry.timeout_ms } : {}) };
    });
    const branch = item.branch ?? `adw/${raw.change_id}/${groupId}`;
    if (!isValidBranchName(branch)) throw new ContractError(`group ${groupId} branch is not a valid Git branch name`);
    const worktree = requireRelativePath(item.worktree ?? `worktrees/${raw.change_id}/${groupId}`, `group ${groupId} worktree`);
    if (branches.has(branch)) throw new ContractError(`duplicate group branch: ${branch}`);
    if (worktrees.has(worktree)) throw new ContractError(`duplicate group worktree: ${worktree}`);
    branches.add(branch);
    worktrees.add(worktree);
    const group = { group_id: groupId, branch, worktree, tasks, affected_paths: affected, validation };
    group.packet_digest = packetDigest(group);
    groups.push(group);
  }
  assertDisjointPaths(groups, raw.shared_paths ?? []);
  return { projectRoot, changeId: raw.change_id, baseBranch: raw.base_branch, baseCommit: raw.base_commit, groups };
}

function worktreeRecords(projectRoot) {
  const records = [];
  for (const paragraph of git(projectRoot, ["worktree", "list", "--porcelain"]).stdout.split(/\n\n+/)) {
    const record = {};
    for (const line of paragraph.split("\n")) {
      const space = line.indexOf(" ");
      if (space === -1) record[line] = true;
      else record[line.slice(0, space)] = line.slice(space + 1);
    }
    if (record.worktree) records.push(record);
  }
  return records;
}

function branchExists(projectRoot, branch) {
  return git(projectRoot, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFailure: true }).status === 0;
}

// Reconstruct the group's durable marker commit from Git alone, so a resumed
// session never has to trust chat history or an unverified record file.
function readMarker(projectRoot, branch) {
  const log = git(projectRoot, ["log", "--format=%x01%H%x00%P%x00%s%x00%b", branch], { allowFailure: true });
  if (log.status !== 0) return null;
  const markers = [];
  for (const entry of log.stdout.split("\x01")) {
    if (entry.trim() === "") continue;
    const [commit, parents, subject, body = ""] = entry.split("\0");
    if (!subject?.startsWith(`${MARKER_SUBJECT} `)) continue;
    const trailers = {};
    for (const line of body.split("\n")) {
      const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(\S.*)$/.exec(line.trim());
      if (match) trailers[match[1]] = match[2].trim();
    }
    markers.push({ commit: commit.trim(), trailers, parents: parents.trim().split(" ").filter(Boolean) });
  }
  if (markers.length === 0) return null;
  if (markers.length > 1) return { ambiguous: true, count: markers.length };
  return markers[0];
}

function inspectGroup(projectRoot, context, group) {
  const state = {
    group_id: group.group_id,
    branch: group.branch,
    worktree: group.worktree,
    packet_digest: group.packet_digest,
    branch_exists: branchExists(projectRoot, group.branch),
    worktree_attached: false,
    head: null,
    dirty: [],
    action: "create",
    reusable: false,
    blockers: [],
  };
  const target = assertInsideProject(projectRoot, group.worktree, `group ${group.group_id} worktree`);
  const records = worktreeRecords(projectRoot);
  const atTarget = records.find((record) => resolve(record.worktree) === target);
  const elsewhere = records.find((record) => record.branch === `refs/heads/${group.branch}` && resolve(record.worktree) !== target);

  if (elsewhere) state.blockers.push(`branch ${group.branch} is already checked out at ${relative(projectRoot, resolve(elsewhere.worktree))}`);
  if (atTarget && atTarget.branch !== `refs/heads/${group.branch}`) state.blockers.push(`${group.worktree} is registered for ${atTarget.branch ?? "a detached HEAD"} rather than ${group.branch}`);
  if (!atTarget && existsSync(target)) {
    const stat = lstatSync(target);
    if (stat.isSymbolicLink()) state.blockers.push(`${group.worktree} is a symbolic link`);
    else if (!stat.isDirectory() || readdirSync(target).length > 0) state.blockers.push(`${group.worktree} already exists and is not an ADW worktree`);
  }

  if (state.branch_exists) {
    const marker = readMarker(projectRoot, group.branch);
    if (!marker) state.blockers.push(`branch ${group.branch} exists without an ADW group marker commit`);
    else if (marker.ambiguous) state.blockers.push(`branch ${group.branch} contains ${marker.count} ADW group marker commits`);
    else {
      const expected = {
        [TRAILERS.change]: context.changeId,
        [TRAILERS.group]: group.group_id,
        [TRAILERS.baseBranch]: context.baseBranch,
        [TRAILERS.baseCommit]: context.baseCommit,
        [TRAILERS.packetDigest]: group.packet_digest,
      };
      for (const [key, value] of Object.entries(expected)) {
        if (marker.trailers[key] !== value) state.blockers.push(`branch ${group.branch} marker ${key} is ${marker.trailers[key] ?? "missing"} but this run expects ${value}`);
      }
      if (marker.parents.length !== 1 || marker.parents[0] !== context.baseCommit) state.blockers.push(`branch ${group.branch} marker commit does not sit directly on ${context.baseCommit}`);
      state.marker_commit = marker.commit;
      if (state.blockers.length === 0) {
        state.action = atTarget ? "reuse" : "attach";
        state.reusable = true;
      }
    }
  }
  if (atTarget) {
    state.worktree_attached = true;
    const head = git(projectRoot, ["-C", target, "rev-parse", "HEAD"], { allowFailure: true });
    if (head.status === 0) state.head = head.stdout;
    const dirty = git(projectRoot, ["-C", target, "status", "--porcelain=v1", "--untracked-files=all"], { allowFailure: true });
    if (dirty.status === 0) state.dirty = dirty.stdout.split("\n").filter(Boolean);
  }
  if (state.blockers.length > 0) state.action = "blocked";
  return state;
}

function assertBase(projectRoot, context) {
  const type = git(projectRoot, ["cat-file", "-t", context.baseCommit], { allowFailure: true });
  if (type.status !== 0 || type.stdout !== "commit") throw new ContractError(`base_commit does not exist in this repository: ${context.baseCommit}`);
  if (!branchExists(projectRoot, context.baseBranch)) throw new ContractError(`base_branch does not exist locally: ${context.baseBranch}`);
  if (git(projectRoot, ["merge-base", "--is-ancestor", context.baseCommit, context.baseBranch], { allowFailure: true }).status !== 0) {
    throw new ContractError(`base_branch ${context.baseBranch} does not contain base_commit ${context.baseCommit}`);
  }
}

function prepareGroup(projectRoot, context, group, state) {
  if (state.action === "reuse") return { ...state, prepared: false, reason: "existing branch and worktree match this exact base and packet" };
  const target = assertInsideProject(projectRoot, group.worktree, `group ${group.group_id} worktree`);
  mkdirSync(dirname(target), { recursive: true });
  const hooks = ["-c", "core.hooksPath=/dev/null"];
  if (state.action === "attach") {
    git(projectRoot, [...hooks, "worktree", "add", target, group.branch]);
    return { ...state, action: "attach", prepared: true, worktree_attached: true, head: git(projectRoot, ["-C", target, "rev-parse", "HEAD"]).stdout };
  }
  git(projectRoot, [...hooks, "worktree", "add", "--detach", target, context.baseCommit]);
  try {
    git(projectRoot, ["-C", target, ...hooks, "switch", "--create", group.branch, context.baseCommit]);
    const message = [
      `${MARKER_SUBJECT} ${group.group_id}`,
      "",
      `${TRAILERS.change}: ${context.changeId}`,
      `${TRAILERS.group}: ${group.group_id}`,
      `${TRAILERS.baseBranch}: ${context.baseBranch}`,
      `${TRAILERS.baseCommit}: ${context.baseCommit}`,
      `${TRAILERS.packetDigest}: ${group.packet_digest}`,
    ].join("\n");
    git(projectRoot, ["-C", target, ...hooks, "commit", "--allow-empty", "--no-verify", "-m", message]);
    const head = git(projectRoot, ["-C", target, "rev-parse", "HEAD"]).stdout;
    const parents = git(projectRoot, ["-C", target, "log", "-1", "--format=%P"]).stdout.split(" ").filter(Boolean);
    if (parents.length !== 1 || parents[0] !== context.baseCommit) throw new ContractError(`group ${group.group_id} marker commit did not land directly on ${context.baseCommit}`);
    return { ...state, action: "create", prepared: true, worktree_attached: true, head, marker_commit: head };
  } catch (error) {
    // Leave nothing half-prepared; the coordinator can retry deterministically.
    git(projectRoot, ["worktree", "remove", "--force", target], { allowFailure: true });
    git(projectRoot, ["worktree", "prune"], { allowFailure: true });
    git(projectRoot, ["branch", "-D", group.branch], { allowFailure: true });
    throw error;
  }
}

// ADW never removes a branch or worktree by itself; a person decides when the
// work in them is genuinely disposable.
export function cleanupGuidance(groups) {
  return groups.map((group) => ({
    group_id: group.group_id,
    commands: [`git worktree remove ${group.worktree}`, `git branch -d ${group.branch}`],
    note: `Run these only after ${group.branch} is merged or intentionally abandoned. ADW never deletes them for you.`,
  }));
}

export function inspectGroups(input) {
  const context = normalizeGroupRequest(input);
  assertBase(context.projectRoot, context);
  const groups = context.groups.map((group) => inspectGroup(context.projectRoot, context, group));
  const blocked = groups.filter((state) => state.blockers.length > 0);
  return {
    ok: blocked.length === 0,
    change_id: context.changeId,
    base_branch: context.baseBranch,
    base_commit: context.baseCommit,
    groups,
    blocked: blocked.map(({ group_id, blockers }) => ({ group_id, blockers })),
  };
}

export function prepareGroups(input) {
  const context = normalizeGroupRequest(input);
  assertBase(context.projectRoot, context);
  const states = context.groups.map((group) => inspectGroup(context.projectRoot, context, group));
  const blocked = states.filter((state) => state.blockers.length > 0);
  if (blocked.length > 0) {
    return {
      ok: false,
      error: "one or more groups are blocked; resolve them before preparing",
      change_id: context.changeId,
      groups: states,
      blocked: blocked.map(({ group_id, blockers }) => ({ group_id, blockers })),
    };
  }
  const prepared = context.groups.map((group, index) => prepareGroup(context.projectRoot, context, group, states[index]));
  return {
    ok: true,
    change_id: context.changeId,
    base_branch: context.baseBranch,
    base_commit: context.baseCommit,
    groups: prepared,
    cleanup: cleanupGuidance(context.groups),
  };
}

export function groupCleanupGuidance(input) {
  const context = normalizeGroupRequest(input);
  return { ok: true, change_id: context.changeId, groups: cleanupGuidance(context.groups) };
}
