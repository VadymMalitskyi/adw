import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyAtomicMigration, checkCompatibility, PathError } from "../../plugin/lib/adw-helper.mjs";

test("compatibility accepts only the current project schema and rejects future plugin evidence", () => {
  assert.equal(checkCompatibility({ project_schema: 5, plugin_version: "1.4.0", artifact_plugin_version: "1.0.0" }).compatible, true);
  const old = checkCompatibility({ project_schema: 4, plugin_version: "2.0.0" });
  assert.equal(old.compatible, false);
  assert.equal(old.migration_required, false);
  const future = checkCompatibility({ project_schema: 5, plugin_version: "1.9.0", artifact_plugin_version: "2.0.0" });
  assert.equal(future.compatible, false);
  assert.equal(future.migration_required, false);
});

test("migration writes only explicit project-relative paths and rejects traversal and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-project-"));
  const outside = await mkdtemp(join(tmpdir(), "adw-outside-"));
  await assert.rejects(applyAtomicMigration(root, [{ path: "../outside.txt", content: "bad" }]), PathError);
  await symlink(outside, join(root, "linked"));
  await assert.rejects(applyAtomicMigration(root, [{ path: "linked/out.txt", content: "bad" }]), PathError);
  await symlink(join(outside, "target.txt"), join(root, "file-link"));
  await assert.rejects(applyAtomicMigration(root, [{ path: "file-link", content: "bad" }]), PathError);
  await applyAtomicMigration(root, [{ path: "nested/adw.yaml", content: "schema: 2\n", expected_content: null }]);
  assert.equal(await readFile(join(root, "nested/adw.yaml"), "utf8"), "schema: 2\n");
});

test("failed multi-file migration restores every previous artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "adw-rollback-"));
  await mkdir(join(root, "config"));
  await writeFile(join(root, "config/one"), "old-one");
  await writeFile(join(root, "config/two"), "old-two");
  await assert.rejects(applyAtomicMigration(root, [
    { path: "config/one", content: "new-one", expected_content: "old-one" },
    { path: "config/two", content: "new-two", expected_content: "stale-value" }
  ]), /precondition failed/);
  assert.equal(await readFile(join(root, "config/one"), "utf8"), "old-one");
  assert.equal(await readFile(join(root, "config/two"), "utf8"), "old-two");
});
