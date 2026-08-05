import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("the checked-in helper bundle is exactly reproducible from its runtime source", () => {
  const source = readFileSync(resolve(repositoryRoot, "src/helpers/runtime-bundle.mjs"));
  const bundle = readFileSync(resolve(repositoryRoot, "plugin/lib/adw-helper.mjs"));
  assert.deepEqual(bundle, source);
  const check = spawnSync(process.execPath, ["src/helpers/build-bundle.mjs", "--check"], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr || check.stdout);
});
