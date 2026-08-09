import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CODEX_RULES } from "../../plugin/execution/managed-development.mjs";

const available = spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0;

test("Codex loads ADW exec rules and applies the strictest matching decision", { skip: available ? false : "Codex CLI is not installed; structural policy tests still run" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "adw-execpolicy-"));
  const rules = join(directory, "adw.rules");
  writeFileSync(rules, CODEX_RULES);
  const cases = [
    { argv: ["git", "status"], decision: "allow" },
    { argv: ["git", "commit", "-m", "test"], decision: "allow" },
    { argv: ["npm", "run", "lint"], decision: "allow" },
    { argv: ["pytest", "-q"], decision: "allow" },
    { argv: ["gh", "pr", "view", "1"], decision: "allow" },
    { argv: ["git", "push", "origin", "main"], decision: "prompt" },
    { argv: ["gh", "api", "repos/example/project"], decision: "prompt" },
    { argv: ["glab", "repo", "view"], decision: "prompt" },
    { argv: ["datadog-ci", "synthetics", "run-tests"], decision: "prompt" },
    { argv: ["git", "push", "--force", "origin", "main"], decision: "forbidden" },
    { argv: ["git", "push", "--mirror", "origin"], decision: "forbidden" },
    // Prefix policy cannot classify arbitrary later refspecs, but the generic push
    // rule must still prevent these variants from running without approval.
    { argv: ["git", "push", "origin", "main", "--force"], decision: "prompt" },
    { argv: ["git", "push", "origin", "+main"], decision: "prompt" },
    { argv: ["gh", "pr", "merge", "1"], decision: "forbidden" },
  ];
  for (const { argv, decision } of cases) {
    const result = spawnSync("codex", ["execpolicy", "check", "--pretty", "--rules", rules, ...argv], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).decision, decision, argv.join(" "));
  }
});
