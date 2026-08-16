import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CODEX_RULES } from "../../plugin/lib/permissions.mjs";

const available = spawnSync("codex", ["--version"], { encoding: "utf8" }).status === 0;

test("Codex loads ADW exec rules and applies the strictest matching decision", { skip: available ? false : "Codex CLI is not installed; structural policy tests still run" }, () => {
  const directory = mkdtempSync(join(tmpdir(), "adw-execpolicy-"));
  const rules = join(directory, "adw.rules");
  writeFileSync(rules, CODEX_RULES);
  const cases = [
    // Ordinary workspace development stays automatic.
    { argv: ["git", "status"], decision: "allow" },
    { argv: ["git", "commit", "-m", "test"], decision: "allow" },
    { argv: ["git", "switch", "-c", "adw/change/group"], decision: "allow" },
    { argv: ["git", "worktree", "list"], decision: "allow" },
    { argv: ["npm", "run", "lint"], decision: "allow" },
    { argv: ["pytest", "-q"], decision: "allow" },
    { argv: ["gh", "pr", "view", "1"], decision: "allow" },

    // Every external or history-rewriting effect reaches a person first.
    { argv: ["git", "push", "origin", "main"], decision: "prompt" },
    { argv: ["git", "tag", "v1.2.3"], decision: "prompt" },
    { argv: ["git", "branch", "-D", "adw/change/group"], decision: "prompt" },
    { argv: ["git", "worktree", "remove", "worktrees/group"], decision: "prompt" },
    { argv: ["git", "worktree", "prune"], decision: "prompt" },
    { argv: ["git", "rebase", "main"], decision: "prompt" },
    { argv: ["git", "merge", "feature"], decision: "prompt" },
    { argv: ["git", "reset", "HEAD~1"], decision: "prompt" },
    { argv: ["gh", "api", "repos/example/project"], decision: "prompt" },
    { argv: ["gh", "pr", "create"], decision: "prompt" },
    { argv: ["glab", "repo", "view"], decision: "prompt" },
    // Unknown provider CLI shapes receive no auto-approval rule and therefore
    // fall through to Codex's sandbox/approval policy.
    { argv: ["datadog-ci", "synthetics", "run-tests"], decision: undefined },

    // Refused outright.
    { argv: ["git", "push", "--force", "origin", "main"], decision: "forbidden" },
    { argv: ["git", "push", "--mirror", "origin"], decision: "forbidden" },
    { argv: ["git", "reset", "--hard", "HEAD~1"], decision: "forbidden" },
    { argv: ["git", "clean", "-fd"], decision: "forbidden" },
    { argv: ["gh", "pr", "merge", "1"], decision: "forbidden" },
    { argv: ["gh", "release", "create", "v1.2.3"], decision: "forbidden" },
    { argv: ["npm", "publish"], decision: "forbidden" },
    { argv: ["kubectl", "apply", "-f", "deploy.yaml"], decision: "forbidden" },
    { argv: ["gh", "auth", "token"], decision: "forbidden" },

    // The rule engine matches a command prefix, so force options and refspecs
    // that trail the recognized prefix only reach the `git push` prompt. The
    // managed container's root-owned git wrapper and the Claude permission hook
    // reject those before Git runs.
    { argv: ["git", "push", "origin", "main", "--force"], decision: "prompt" },
    { argv: ["git", "push", "origin", "+main"], decision: "prompt" },
  ];
  for (const { argv, decision } of cases) {
    const result = spawnSync("codex", ["execpolicy", "check", "--pretty", "--rules", rules, ...argv], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).decision, decision, argv.join(" "));
  }
});
