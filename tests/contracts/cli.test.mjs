import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { EXIT } from "../../plugin/lib/safe-files.mjs";

const cli = fileURLToPath(new URL("../../plugin/bin/adw.mjs", import.meta.url));

const COMMANDS = [
  "config",
  "init-preview",
  "init-apply",
  "refresh-preview",
  "refresh-apply",
  "doctor",
  "worktree-preview",
  "worktree-prepare",
  "worktree-inspect",
  "worktree-cleanup-guidance",
  "render-managed",
];

function invoke(args, input = "") {
  const result = spawnSync(process.execPath, [cli, ...args], { input, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function project() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "adw-cli-")));
  const git = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
  git(["init", "-q", "-b", "main"]);
  git(["config", "user.email", "test@example.test"]);
  git(["config", "user.name", "ADW Test"]);
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(["add", "-A"]);
  git(["commit", "-qm", "initial"]);
  return root;
}

test("the dispatcher exposes exactly the documented command surface", () => {
  const source = readFileSync(cli, "utf8");
  for (const command of COMMANDS) assert.ok(source.includes(`"${command}"`), `${command} is missing from the dispatcher`);
  const unknown = invoke(["not-a-command"]);
  assert.equal(unknown.status, EXIT.INPUT);
  const body = JSON.parse(unknown.stdout);
  assert.equal(body.ok, false);
  for (const command of COMMANDS) assert.ok(body.error.message.includes(command), `${command} is missing from the usage message`);
});

test("the dispatcher stays thin and holds no domain logic", () => {
  const source = readFileSync(cli, "utf8");
  // Reasoning belongs in skills and domain rules belong in plugin/lib. The
  // dispatcher may parse arguments and print JSON, nothing more.
  for (const forbidden of ["prefix_rule", "createHash", "spawnSync", "\"worktree\", \"add\""]) {
    assert.ok(!source.includes(forbidden), `${forbidden} belongs in a library module, not the dispatcher`);
  }
  assert.ok(source.split("\n").length < 140, "the dispatcher grew past a thin dispatcher's size");
});

test("every command answers with one JSON object on stdout", () => {
  const root = project();
  const cases = [
    [["config", "--project-root", root], ""],
    [["doctor", "--project-root", root], ""],
    [["init-preview", "--project-root", root], "{}"],
    [["worktree-preview"], "{}"],
    [["not-a-command"], ""],
  ];
  for (const [args, input] of cases) {
    const result = invoke(args, input);
    assert.doesNotThrow(() => JSON.parse(result.stdout), `${args[0]} did not print one JSON object`);
    assert.equal(result.stderr, "", `${args[0]} wrote to stderr`);
  }
});

test("exit codes are stable and distinguish input, contract, and check failures", () => {
  const root = project();

  // No configuration yet: the contract cannot be satisfied.
  assert.equal(invoke(["config", "--project-root", root]).status, EXIT.PATH_VIOLATION);

  // Missing required argument.
  assert.equal(invoke(["config"]).status, EXIT.INPUT);
  assert.equal(invoke(["init-apply", "--project-root", root], "{}").status, EXIT.INPUT);

  // Malformed stdin.
  const malformed = invoke(["worktree-preview"], "{not json");
  assert.equal(malformed.status, EXIT.INPUT);
  assert.match(JSON.parse(malformed.stdout).error.message, /not valid JSON/);

  // A rejected contract.
  const badAnswers = invoke(["init-preview", "--project-root", root], JSON.stringify({ isolation: "nonsense" }));
  assert.equal(badAnswers.status, EXIT.CONTRACT_INVALID);

  // An unsupported answer field is an input error, not a silent ignore.
  const unknownField = invoke(["init-preview", "--project-root", root], JSON.stringify({ nonsense: true }));
  assert.equal(unknownField.status, EXIT.INPUT);
  assert.match(JSON.parse(unknownField.stdout).error.message, /unsupported answer field/);
});

test("doctor exits 5 when a check fails and 0 when every check passes", () => {
  const root = project();
  const answers = JSON.stringify({ isolation: "provider-sandbox" });
  const preview = JSON.parse(invoke(["init-preview", "--project-root", root], answers).stdout);
  invoke(["init-apply", "--project-root", root, "--fingerprint", preview.fingerprint], answers);

  const healthy = invoke(["doctor", "--project-root", root]);
  assert.equal(healthy.status, EXIT.OK, healthy.stdout);
  assert.equal(JSON.parse(healthy.stdout).ok, true);

  writeFileSync(join(root, ".codex/rules/adw.rules"), "tampered\n");
  const drifted = invoke(["doctor", "--project-root", root]);
  assert.equal(drifted.status, EXIT.CHECK_FAILED);
  const failed = JSON.parse(drifted.stdout).checks.filter(({ status }) => status === "fail");
  assert.deepEqual(failed.map(({ id }) => id), ["permissions:codex"]);
});

test("a preview never writes and never reveals the reviewed bytes", () => {
  const root = project();
  const before = readdirSync(root).sort();
  const preview = JSON.parse(invoke(["init-preview", "--project-root", root], "{}").stdout);
  assert.deepEqual(readdirSync(root).sort(), before);
  // The fingerprint is internal plumbing; the file bytes stay inside the runtime.
  assert.match(preview.fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(Object.hasOwn(preview, "files"), false);
  for (const write of preview.writes) assert.deepEqual(Object.keys(write).sort(), ["action", "path"]);
});

test("the runtime rejects an unexpected positional argument instead of guessing", () => {
  const result = invoke(["config", "some-path"]);
  assert.equal(result.status, EXIT.INPUT);
  assert.match(JSON.parse(result.stdout).error.message, /unexpected argument/);
});
