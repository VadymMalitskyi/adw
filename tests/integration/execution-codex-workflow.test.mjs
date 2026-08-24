import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";

test("Codex workflow entrypoint is shipped with the plugin", () => {
  assert.equal(existsSync(new URL("../../plugin/workflows/adw-execute-phase-codex.mjs", import.meta.url)), true);
});
