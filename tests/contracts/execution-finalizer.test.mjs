import assert from "node:assert/strict";
import test from "node:test";
import { validateProviderResult } from "../../plugin/lib/execution-contract.mjs";

test("provider results reject unresolved contract drift", () => {
  assert.throws(() => validateProviderResult({ schema_version: 1, provider: "codex", groups: [{ group_id: "one", status: "passed", fix_cycles: 0, findings: [], raw_output: "secret" }] }));
});
