// Git evidence used by the deterministic execution finalizer.  Porcelain is
// deliberately read as bytes: filenames are not line oriented data.
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { PathError, ContractError } from "./safe-files.mjs";
import { isPathInScope } from "./execution-contract.mjs";

function git(cwd, args) {
  try { return execFileSync("git", args, { cwd, encoding: "buffer", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }); }
  catch (error) { throw new ContractError(`execution git: ${Buffer.from(error.stderr ?? "").toString("utf8").trim() || `git ${args[0]} failed`}`); }
}
function text(cwd, args) { return git(cwd, args).toString("utf8").trim(); }
function confined(root, candidate) {
  const actual = realpathSync(candidate); const rel = relative(root, actual);
  if (rel === ".." || rel.startsWith(`..${sep}`)) throw new PathError("worktree resolves outside the project root");
  return actual;
}
export function porcelainPaths(status) {
  const fields = Buffer.isBuffer(status) ? status.toString("utf8").split("\0") : String(status).split("\0");
  const paths = [];
  for (let i = 0; i < fields.length - 1; i += 1) {
    const row = fields[i]; if (!row) continue;
    if (row.startsWith("? ") || row.startsWith("! ")) { paths.push(row.slice(2)); continue; }
    if (row.startsWith("1 ") || row.startsWith("u ")) { const parts = row.split(" "); paths.push(parts.at(-1)); continue; }
    if (row.startsWith("2 ")) { const parts = row.split(" "); paths.push(parts.at(-1)); if (i + 1 < fields.length) paths.push(fields[++i]); continue; }
    throw new ContractError("execution git: unsupported porcelain v2 record");
  }
  return paths.filter(Boolean);
}
export function statusSnapshot(cwd) { return git(cwd, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]).toString("base64"); }
export function headSnapshot(cwd) { return text(cwd, ["rev-parse", "HEAD"]); }
export function checkoutSnapshot(projectRoot, worktreePath = ".") {
  const cwd = worktreePath === "." ? realpathSync(projectRoot) : confined(realpathSync(projectRoot), resolve(projectRoot, worktreePath));
  return { path: worktreePath, head: headSnapshot(cwd), status: statusSnapshot(cwd) };
}
export function assertCleanStart(projectRoot, group) {
  const root = realpathSync(projectRoot); const worktree = confined(root, resolve(root, group.worktree));
  if (!existsSync(worktree) || lstatSync(worktree).isSymbolicLink()) throw new PathError(`worktree is missing or symlinked: ${group.worktree}`);
  const listed = text(root, ["worktree", "list", "--porcelain"]);
  const entry = listed.split("\n\n").find((item) => item.split("\n").includes(`worktree ${worktree}`));
  if (!entry || !entry.split("\n").includes(`branch refs/heads/${group.branch}`)) throw new ContractError(`execution git: worktree ${group.worktree} is not attached to ${group.branch}`);
  const snapshot = checkoutSnapshot(root, group.worktree);
  if (snapshot.status !== "") throw new ContractError(`execution git: worktree ${group.worktree} must be clean`);
  return snapshot;
}
export function assertScope(snapshot, scopes) {
  const raw = snapshot ? Buffer.from(snapshot, "base64") : Buffer.alloc(0);
  const outside = porcelainPaths(raw).filter((path) => !scopes.some((scope) => isPathInScope(path, scope)));
  if (outside.length) throw new ContractError("execution git: changed paths escape affected_paths");
  return true;
}
export function assertSnapshotEqual(projectRoot, expected) {
  const actual = checkoutSnapshot(projectRoot, expected.path);
  if (actual.head !== expected.head || actual.status !== expected.status) throw new ContractError(`execution git: checkout drift detected at ${expected.path}`);
  return actual;
}
export function assertTargetState(projectRoot, group, target, { allowChanges = true } = {}) {
  const actual = checkoutSnapshot(projectRoot, group.worktree);
  if (actual.head !== target.head) throw new ContractError(`execution git: HEAD changed in ${group.group_id}`);
  if (!allowChanges && actual.status !== target.status) throw new ContractError(`execution git: read-only stage changed ${group.group_id}`);
  assertScope(actual.status, group.affected_paths);
  return actual;
}
export function captureExecutionBaselines(projectRoot, packet) {
  const root = realpathSync(projectRoot); const targets = packet.groups.map((group) => ({ group_id: group.group_id, ...assertCleanStart(root, group) }));
  const targetPaths = new Set(packet.groups.map(({ worktree }) => worktree));
  const records = text(root, ["worktree", "list", "--porcelain"]).split("\n\n").filter(Boolean);
  const paths = records.map((record) => record.split("\n").find((line) => line.startsWith("worktree "))?.slice(9)).filter(Boolean);
  const coordinator = checkoutSnapshot(root);
  const non_targets = paths.map((path) => relative(root, path) || ".").filter((path) => path !== "." && !targetPaths.has(path)).map((path) => checkoutSnapshot(root, path));
  return { targets, coordinator, non_targets };
}
