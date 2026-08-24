import assert from "node:assert/strict";
import test from "node:test";
import { resolveValidation } from "../../plugin/lib/execution-validation.mjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("validation references resolve only exact configured tuples", async () => {
  const root = mkdtempSync(join(tmpdir(), "adw-validation-")); writeFileSync(join(root, "adw.yaml"), "adw: 1\ncomponents:\n  app:\n    path: .\n    validate:\n      - command: npm test\n        cwd: .\n");
  const result = await resolveValidation(root, { component: "app", cwd: ".", command: "npm test" });
  assert.equal(result.command, "npm test");
  await assert.rejects(resolveValidation(root, { component: "app", cwd: ".", command: "npm run nope" }));
});
