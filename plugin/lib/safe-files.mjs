// Path confinement and scoped atomic writes.
//
// This is the lowest layer of the ADW runtime: every managed write in the
// plugin goes through `applyAtomicWrites`, and every project-relative path a
// skill supplies is resolved through `resolveProjectPath` first. The exit codes
// and error classes live here because this module is the one every other
// library module already depends on.
import { link, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

export const EXIT = Object.freeze({ OK: 0, INPUT: 2, CONTRACT_INVALID: 3, CHECK_FAILED: 5, PATH_VIOLATION: 7, WRITE_FAILED: 8, INTERNAL: 9 });

class CodedError extends Error { constructor(message, code, options) { super(message, options); this.code = code; } }
export class InputError extends CodedError { constructor(message, options) { super(message, EXIT.INPUT, options); } }
export class ContractError extends CodedError { constructor(message, options) { super(message, EXIT.CONTRACT_INVALID, options); } }
export class PathError extends CodedError { constructor(message, options) { super(message, EXIT.PATH_VIOLATION, options); } }
export class WriteError extends CodedError { constructor(message, options) { super(message, EXIT.WRITE_FAILED, options); } }

export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Project-relative, traversal-free, NUL-free, and never absolute. Used both by
// contract validation and by the write path, so the two can never disagree.
export function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 1024) return false;
  if (value.includes("\0") || value.includes("\\")) return false;
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) return false;
  return !value.split("/").includes("..");
}

export function normalizeRelativePath(value) {
  const normalized = posix.normalize(value).replace(/\/+$/, "");
  return normalized.length === 0 ? "." : normalized;
}

export async function resolveProjectPath(projectRoot, explicitRelativePath) {
  if (typeof projectRoot !== "string" || !projectRoot || !isSafeRelativePath(explicitRelativePath)) {
    throw new PathError("paths must be explicit traversal-free project-relative paths");
  }
  const root = await realpath(projectRoot);
  const target = resolve(root, explicitRelativePath);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new PathError(`path escapes the project root: ${explicitRelativePath}`);
  // Walk up to the nearest existing ancestor and prove it still resolves inside
  // the project, so a symlinked parent directory cannot redirect the write.
  let ancestor = dirname(target);
  for (;;) {
    try {
      const actual = await realpath(ancestor);
      const actualRel = relative(root, actual);
      if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new PathError(`path resolves outside the project root: ${explicitRelativePath}`);
      break;
    } catch (error) {
      if (error instanceof PathError || error.code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return target;
}

export async function resolveProjectDirectory(projectRoot, explicitRelativePath) {
  const root = await realpath(projectRoot);
  const target = explicitRelativePath === "." ? root : await resolveProjectPath(projectRoot, explicitRelativePath);
  let targetStat;
  try { targetStat = await lstat(target); }
  catch (error) { if (error.code === "ENOENT") throw new PathError(`directory does not exist: ${explicitRelativePath}`); throw error; }
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new PathError(`must be a real project directory: ${explicitRelativePath}`);
  const actual = await realpath(target);
  const actualRel = relative(root, actual);
  if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new PathError(`directory resolves outside the project root: ${explicitRelativePath}`);
  return actual;
}

// Reads a confined project file, returning null when it is absent. Symlinks and
// non-regular files are refused rather than followed.
export async function readProjectFile(projectRoot, relativePath) {
  const target = await resolveProjectPath(projectRoot, relativePath);
  let stat;
  try { stat = await lstat(target); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new PathError(`must be a regular non-symlink file: ${relativePath}`);
  return await readFile(target, "utf8");
}

export async function applyAtomicWrites(projectRoot, operations) {
  if (!Array.isArray(operations) || operations.length === 0) throw new InputError("atomic write requires at least one explicit operation");
  for (const operation of operations) if (!operation || typeof operation.path !== "string" || typeof operation.content !== "string") throw new InputError("each atomic write operation requires string path and content fields");
  const destinations = await Promise.all(operations.map((operation) => resolveProjectPath(projectRoot, operation.path)));
  if (new Set(destinations).size !== destinations.length) throw new InputError("atomic write contains duplicate destination paths");
  const root = await realpath(projectRoot);
  const transaction = await mkdtemp(resolve(root, ".adw-atomic-write-"));
  const originals = [];
  try {
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const destination = destinations[index];
      let previous = null;
      let destinationStat;
      try {
        destinationStat = await lstat(destination);
        if (destinationStat.isSymbolicLink()) throw new PathError(`destination is a symbolic link: ${operation.path}`);
        previous = await readFile(destination, "utf8");
      } catch (error) { if (error instanceof PathError || error.code !== "ENOENT") throw error; }
      if (Object.hasOwn(operation, "expected_content") && operation.expected_content !== previous) throw new WriteError(`precondition failed for ${operation.path}`);
      const staged = resolve(transaction, `new-${index}`);
      await writeFile(staged, operation.content, { encoding: "utf8", mode: destinationStat?.mode ?? 0o644, flag: "wx" });
      await mkdir(dirname(destination), { recursive: true });
      // Re-resolve immediately before mutation so a replaced parent symlink is caught.
      if (await resolveProjectPath(projectRoot, operation.path) !== destination) throw new PathError(`path changed while atomic writes were prepared: ${operation.path}`);
      let backup;
      try {
        const currentStat = await lstat(destination);
        if (!destinationStat || currentStat.isSymbolicLink() || currentStat.dev !== destinationStat.dev || currentStat.ino !== destinationStat.ino) throw new WriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
        backup = resolve(transaction, `old-${index}`);
        // Preserve the old inode for rollback without first removing its
        // destination name, so the following rename replaces the destination
        // atomically instead of exposing an absent-path window.
        await link(destination, backup);
        const backupStat = await lstat(backup);
        const latestStat = await lstat(destination);
        if (backupStat.isSymbolicLink() || latestStat.isSymbolicLink() || backupStat.dev !== destinationStat.dev || backupStat.ino !== destinationStat.ino || latestStat.dev !== destinationStat.dev || latestStat.ino !== destinationStat.ino) throw new WriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        if (destinationStat) throw new WriteError(`destination changed while atomic writes were prepared: ${operation.path}`);
      }
      const original = { destination, backup, committed: false };
      originals.push(original);
      await rename(staged, destination);
      original.committed = true;
    }
  } catch (error) {
    for (const original of originals.reverse()) {
      if (!original.committed) continue;
      if (original.backup) await rename(original.backup, original.destination);
      else await rm(original.destination, { force: true });
    }
    if (error instanceof InputError || error instanceof PathError || error instanceof WriteError) throw error;
    throw new WriteError(error.message, { cause: error });
  } finally {
    await rm(transaction, { recursive: true, force: true });
  }
}
