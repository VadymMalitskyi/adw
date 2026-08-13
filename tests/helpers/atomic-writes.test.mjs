import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAtomicWrites, PathError } from "../../plugin/lib/adw-helper.mjs";

test("atomic writes use only explicit project-relative paths and reject traversal and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-project-"));
  const outside = await mkdtemp(join(tmpdir(), "adw-outside-"));
  await assert.rejects(applyAtomicWrites(root, [{ path: "../outside.txt", content: "bad" }]), PathError);
  await symlink(outside, join(root, "linked"));
  await assert.rejects(applyAtomicWrites(root, [{ path: "linked/out.txt", content: "bad" }]), PathError);
  await symlink(join(outside, "target.txt"), join(root, "file-link"));
  await assert.rejects(applyAtomicWrites(root, [{ path: "file-link", content: "bad" }]), PathError);
  await applyAtomicWrites(root, [{ path: "nested/adw.yaml", content: "schema: 2\n", expected_content: null }]);
  assert.equal(await readFile(join(root, "nested/adw.yaml"), "utf8"), "schema: 2\n");
});

test("failed multi-file atomic writes restore every previous artifact", async () => {
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
  assert.equal((await stat(join(root, "config/one"))).ino, originalOne.ino);
});

test("existing destinations are replaced atomically instead of being renamed away first", async () => {
  const source = await readFile(new URL("../../src/helpers/runtime-bundle.mjs", import.meta.url), "utf8");
  const implementation = source.slice(source.indexOf("export async function applyAtomicWrites"), source.indexOf("class CodedError"));
  assert.match(implementation, /await link\(destination, backup\)/);
  assert.match(implementation, /await rename\(staged, destination\)/);
  assert.doesNotMatch(implementation, /await rename\(destination, backup\)/);
});
