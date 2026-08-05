import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export interface MigrationWrite { path: string; content: string; expected_content?: string | null }

export async function resolveProjectPath(projectRoot: string, explicitRelativePath: string): Promise<string> {
  if (!projectRoot || !explicitRelativePath || isAbsolute(explicitRelativePath) || explicitRelativePath.includes("\0")) throw new Error("migration paths must be explicit project-relative paths");
  const root = await realpath(projectRoot);
  const target = resolve(root, explicitRelativePath);
  const rel = relative(root, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`path escapes the project root: ${explicitRelativePath}`);
  let ancestor = dirname(target);
  while (true) {
    try {
      const actual = await realpath(ancestor);
      const actualRel = relative(root, actual);
      if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new Error(`path resolves outside the project root: ${explicitRelativePath}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
  return target;
}

/** Resolve an existing directory without permitting a symlink at the requested path. */
export async function resolveProjectDirectory(projectRoot: string, explicitRelativePath: string): Promise<string> {
  const root = await realpath(projectRoot);
  const target = explicitRelativePath === "." ? root : await resolveProjectPath(projectRoot, explicitRelativePath);
  const targetStat = await lstat(target);
  if (targetStat.isSymbolicLink() || !targetStat.isDirectory()) throw new Error(`validation cwd must be a real project directory: ${explicitRelativePath}`);
  const actual = await realpath(target);
  const actualRel = relative(root, actual);
  if (actualRel === ".." || actualRel.startsWith(`..${sep}`) || isAbsolute(actualRel)) throw new Error(`validation cwd resolves outside the project root: ${explicitRelativePath}`);
  return actual;
}

export async function applyAtomicMigration(projectRoot: string, operations: MigrationWrite[]): Promise<void> {
  if (!Array.isArray(operations) || operations.length === 0) throw new Error("migration requires at least one explicit write operation");
  const destinations = await Promise.all(operations.map((operation) => resolveProjectPath(projectRoot, operation.path)));
  if (new Set(destinations).size !== destinations.length) throw new Error("migration contains duplicate destination paths");
  const root = await realpath(projectRoot);
  const transaction = await mkdtemp(resolve(root, ".adw-migration-"));
  const originals: Array<{ destination: string; backup?: string }> = [];
  try {
    for (let index = 0; index < operations.length; index += 1) {
      const operation = operations[index];
      const destination = destinations[index];
      let previous: string | null = null;
      let destinationStat: Awaited<ReturnType<typeof lstat>> | undefined;
      try {
        destinationStat = await lstat(destination);
        if (destinationStat.isSymbolicLink()) throw new Error(`destination is a symbolic link: ${operation.path}`);
        previous = await readFile(destination, "utf8");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if ("expected_content" in operation && operation.expected_content !== previous) throw new Error(`precondition failed for ${operation.path}`);
      const staged = resolve(transaction, `new-${index}`);
      await writeFile(staged, operation.content, { encoding: "utf8", mode: destinationStat?.mode ?? 0o644, flag: "wx" });
      await mkdir(dirname(destination), { recursive: true });
      if (await resolveProjectPath(projectRoot, operation.path) !== destination) throw new Error(`path changed while migration was prepared: ${operation.path}`);
      let backup: string | undefined;
      try {
        const currentStat = await lstat(destination);
        if (!destinationStat || currentStat.isSymbolicLink() || currentStat.dev !== destinationStat.dev || currentStat.ino !== destinationStat.ino) throw new Error(`destination changed while migration was prepared: ${operation.path}`);
        backup = resolve(transaction, `old-${index}`);
        await rename(destination, backup);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        if (destinationStat) throw new Error(`destination changed while migration was prepared: ${operation.path}`);
      }
      originals.push({ destination, backup });
      await rename(staged, destination);
    }
  } catch (error) {
    for (const original of originals.reverse()) {
      await rm(original.destination, { force: true });
      if (original.backup) await rename(original.backup, original.destination);
    }
    throw error;
  } finally {
    await rm(transaction, { recursive: true, force: true });
  }
}
