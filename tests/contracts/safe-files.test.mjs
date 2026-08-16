import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PathError, applyAtomicWrites, isSafeRelativePath, readProjectFile, resolveProjectDirectory, resolveProjectPath } from "../../plugin/lib/safe-files.mjs";

test("only explicit traversal-free project-relative paths are accepted", () => {
  for (const accepted of ["adw.yaml", "nested/file.txt", ".devcontainer/Dockerfile", "a-b_c/d.1"]) {
    assert.equal(isSafeRelativePath(accepted), true, accepted);
  }
  for (const rejected of ["", "/etc/passwd", "../escape", "nested/../../escape", "C:\\windows", "back\\slash", "with\0nul", "a".repeat(1025)]) {
    assert.equal(isSafeRelativePath(rejected), false, JSON.stringify(rejected));
  }
});

test("path resolution refuses to follow a symlink out of the project", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-paths-"));
  const outside = await mkdtemp(join(tmpdir(), "adw-outside-"));
  await symlink(outside, join(root, "linked"));

  await assert.rejects(resolveProjectPath(root, "../escape"), PathError);
  await assert.rejects(resolveProjectPath(root, "/etc/passwd"), PathError);
  await assert.rejects(resolveProjectPath(root, "linked/out.txt"), PathError);
  await assert.rejects(resolveProjectDirectory(root, "linked"), PathError);
  assert.equal(await resolveProjectPath(root, "nested/deep/file.txt"), join(await resolveProjectPath(root, "nested"), "deep/file.txt"));
});

test("reading a project file refuses a symlink instead of following it", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-read-"));
  const outside = await mkdtemp(join(tmpdir(), "adw-read-outside-"));
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(join(outside, "secret.txt"), join(root, "adw.yaml"));

  await assert.rejects(readProjectFile(root, "adw.yaml"), PathError);
  assert.equal(await readProjectFile(root, "absent.yaml"), null);
});

test("atomic writes reject traversal, symlinked destinations, and duplicate targets", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-project-"));
  const outside = await mkdtemp(join(tmpdir(), "adw-outside-"));
  await assert.rejects(applyAtomicWrites(root, [{ path: "../outside.txt", content: "bad" }]), PathError);
  await symlink(outside, join(root, "linked"));
  await assert.rejects(applyAtomicWrites(root, [{ path: "linked/out.txt", content: "bad" }]), PathError);
  await symlink(join(outside, "target.txt"), join(root, "file-link"));
  await assert.rejects(applyAtomicWrites(root, [{ path: "file-link", content: "bad" }]), PathError);
  await assert.rejects(applyAtomicWrites(root, [
    { path: "same.txt", content: "one" },
    { path: "./same.txt", content: "two" },
  ]), /duplicate destination/);

  await applyAtomicWrites(root, [{ path: "nested/adw.yaml", content: "adw: 1\n", expected_content: null }]);
  assert.equal(await readFile(join(root, "nested/adw.yaml"), "utf8"), "adw: 1\n");
});

test("failed multi-file atomic writes restore every previous file", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-rollback-"));
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/one"), "old-one");
  await writeFile(join(root, "config/two"), "old-two");
  const originalOne = await stat(join(root, "config/one"));

  await assert.rejects(applyAtomicWrites(root, [
    { path: "config/one", content: "new-one", expected_content: "old-one" },
    { path: "config/two", content: "new-two", expected_content: "stale-value" },
  ]), /precondition failed/);

  assert.equal(await readFile(join(root, "config/one"), "utf8"), "old-one");
  assert.equal(await readFile(join(root, "config/two"), "utf8"), "old-two");
  // Rollback restores the original inode, so anything holding the old file
  // keeps reading valid bytes rather than a hole.
  assert.equal((await stat(join(root, "config/one"))).ino, originalOne.ino);
});

test("a rolled-back create leaves no partial file behind", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-partial-"));
  await writeFile(join(root, "existing"), "keep");
  await assert.rejects(applyAtomicWrites(root, [
    { path: "created", content: "new", expected_content: null },
    { path: "existing", content: "replaced", expected_content: "stale" },
  ]), /precondition failed/);
  assert.equal(await readProjectFile(root, "created"), null);
  assert.equal(await readFile(join(root, "existing"), "utf8"), "keep");
});

test("existing destinations are replaced atomically instead of being renamed away first", async () => {
  const source = await readFile(new URL("../../plugin/lib/safe-files.mjs", import.meta.url), "utf8");
  const implementation = source.slice(source.indexOf("export async function applyAtomicWrites"));
  // Hard-linking the backup keeps the destination name occupied throughout, so
  // a concurrent reader never observes a missing file.
  assert.match(implementation, /await link\(destination, backup\)/);
  assert.match(implementation, /await rename\(staged, destination\)/);
  assert.doesNotMatch(implementation, /await rename\(destination, backup\)/);
});
