import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";

test("Codex workflow entrypoint is shipped with the plugin", () => {
  assert.equal(existsSync(new URL("../../plugin/workflows/adw-execute-phase-codex.mjs", import.meta.url)), true);
});

test("Claude workflow entrypoint is shipped with the plugin", () => {
  const path = new URL("../../plugin/workflows/adw-execute-phase-claude.mjs", import.meta.url);
  assert.equal(existsSync(path), true);
  const source = readFileSync(path, "utf8");
  assert.match(source, /^export const meta = /, "Claude requires workflow metadata as the first statement");
  assert.match(source, /pipeline\([\s\S]*runImplement[\s\S]*runReview[\s\S]*runFix[\s\S]*runReview[\s\S]*runFix[\s\S]*runReview/, "Claude must use the bounded implement/review/fix sequence");
  assert.match(source, /execution-assert-target/, "every Claude stage must use the shared Git gate");
  assert.match(source, /--envelope-file[\s\S]*--envelope-sha256/, "Claude gate commands must bind a short temporary-envelope reference");
  assert.match(source, /disallowedTools: \["Edit", "Write", "NotebookEdit"\]/, "review agents must not receive direct editing tools");
  assert.match(source, /provider: "claude"/, "Claude must return the shared provider result shape");
  assert.doesNotMatch(source, /claude\s+-p|resumeFromRunId|validateCommands/, "Claude workflow must not use another billing route, unsafe cache reuse, or agent-owned validation");
});
