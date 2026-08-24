import assert from "node:assert/strict";
import test from "node:test";
import { codexArgv } from "../../plugin/lib/execution-adapters/codex.mjs";

test("Codex adapter uses supported unattended argument surfaces", () => {
  const argv = codexArgv({ cwd: "/tmp/work", schemaPath: "/tmp/schema", resultPath: "/tmp/result" });
  assert.deepEqual(argv.slice(0, 6), ["exec", "-C", "/tmp/work", "-c", 'approval_policy="never"', "--json"]);
  assert.ok(!argv.join(" ").includes("dangerously"));
});
