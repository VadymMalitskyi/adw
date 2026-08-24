// `adw doctor` is the pre-execution gate: it must notice every kind of drift,
// it must stop early when the project contract cannot be read, and it must
// never write. All of that is asserted against the real CLI on a project built
// by the real init flow.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const cli = join(repositoryRoot, "plugin/bin/adw.mjs");
const EXIT_CONTRACT_INVALID = 3;
const EXIT_CHECK_FAILED = 5;

function git(root, ...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function adw(command, options = [], { stdin = "", env = {} } = {}) {
  return spawnSync(process.execPath, [cli, command, ...options], { encoding: "utf8", input: stdin, env: { ...process.env, ...env } });
}

function body(result) {
  try { return JSON.parse(result.stdout); }
  catch (error) { throw new Error(`CLI did not print JSON (${error.message}): ${result.stdout}${result.stderr}`); }
}

function snapshot(root) {
  const files = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => (left.name < right.name ? -1 : 1))) {
      if (entry.name === ".git") continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.set(relative(root, path), createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  visit(root);
  return files;
}

function doctor(root, { env = {}, checks } = {}) {
  const options = ["--project-root", root, ...(checks ? ["--checks", checks] : [])];
  const result = adw("doctor", options, { env });
  const report = body(result);
  return {
    status: result.status,
    report,
    statusOf: (id) => report.checks.find((check) => check.id === id)?.status,
    ids: report.checks.map(({ id }) => id),
    failures: report.checks.filter((check) => check.status === "fail").map(({ id }) => id),
  };
}

function managedProject(prefix = "adw-doctor-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "user.name", "ADW Test");
  git(root, "config", "user.email", "adw@example.invalid");
  writeFileSync(join(root, "README.md"), "# fixture\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");

  const stdin = `${JSON.stringify({ isolation: "managed-devcontainer", web_access: "public-pages", runtime_versions: {} })}\n`;
  const preview = adw("init-preview", ["--project-root", root], { stdin });
  assert.equal(preview.status, 0, preview.stdout || preview.stderr);
  const applied = adw("init-apply", ["--project-root", root, "--fingerprint", body(preview).fingerprint], { stdin });
  assert.equal(applied.status, 0, applied.stdout || applied.stderr);
  return root;
}

test("a freshly initialized managed project passes every check except its runtime, and that one inside the container", () => {
  const root = managedProject();

  const outside = doctor(root);
  assert.equal(outside.status, EXIT_CHECK_FAILED);
  assert.equal(outside.report.ok, false);
  assert.deepEqual(outside.failures, ["execution:runtime"]);
  assert.equal(outside.report.isolation, "managed-devcontainer");
  assert.equal(outside.report.read_only, true);

  const inside = doctor(root, { env: { ADW_MANAGED_DEVCONTAINER: "1" } });
  assert.equal(inside.status, 0, JSON.stringify(inside.failures));
  assert.equal(inside.report.ok, true);
  assert.deepEqual(inside.failures, []);
  assert.equal(inside.statusOf("execution:runtime"), "pass");
  for (const id of ["plugin", "repository", "project-contract", "execution:managed-files", "execution:managed-marker", "execution:agent-versions", "execution:mounts", "execution:unsafe-mounts", "execution:hardening", "execution:domains", "execution:generated-files", "execution:permission-files", "permissions:configuration", "permissions:codex", "permissions:claude", "ignore:worktrees", "docs:worktree"]) {
    assert.equal(inside.statusOf(id), "pass", `${id} must pass on a fresh managed project`);
  }
  assert.equal(inside.statusOf("components"), "info");
});

test("each kind of drift fails its own check and exits 5", async (t) => {
  const cases = [
    {
      name: "a generated managed file",
      drift: (root) => writeFileSync(join(root, ".devcontainer/project-setup.sh"), `${readFileSync(join(root, ".devcontainer/project-setup.sh"), "utf8")}\n# unreviewed drift\n`),
      failing: "execution:generated-files",
      stillPassing: ["execution:managed-files", "execution:hardening", "execution:managed-marker"],
    },
    {
      name: "a missing managed file",
      drift: (root) => rmSync(join(root, ".devcontainer/git-wrapper.sh")),
      failing: "execution:managed-files",
      stillPassing: [],
    },
    {
      name: "the managed marker",
      drift: (root) => {
        const path = join(root, ".devcontainer/adw-managed.json");
        const marker = JSON.parse(readFileSync(path, "utf8"));
        marker.plugin_version = "0.0.1";
        writeFileSync(path, `${JSON.stringify(marker, null, 2)}\n`);
      },
      failing: "execution:managed-marker",
      stillPassing: ["execution:managed-files", "execution:hardening"],
    },
    {
      name: "the container-owned Codex rules",
      drift: (root) => writeFileSync(join(root, ".devcontainer/codex.rules"), "prefix_rule(pattern = [\"rm\"], decision = \"allow\")\n"),
      failing: "execution:permission-files",
      stillPassing: ["permissions:codex"],
    },
    {
      name: "the container-owned Codex wrapper",
      drift: (root) => writeFileSync(join(root, ".devcontainer/codex-wrapper.sh"), "#!/usr/bin/env bash\nexec /usr/bin/codex \"$@\"\n"),
      failing: "execution:permission-files",
      stillPassing: ["execution:managed-files"],
    },
    {
      name: "the container-owned egress allowlist",
      drift: (root) => writeFileSync(join(root, ".devcontainer/allowed-domains.txt"), `${readFileSync(join(root, ".devcontainer/allowed-domains.txt"), "utf8")}evil.example.com\n`),
      failing: "execution:domains",
      stillPassing: ["execution:managed-files"],
    },
    {
      name: "the project Codex policy",
      drift: (root) => writeFileSync(join(root, ".codex/rules/adw.rules"), "prefix_rule(pattern = [\"rm\"], decision = \"allow\")\n"),
      failing: "permissions:codex",
      stillPassing: ["permissions:configuration", "permissions:claude"],
    },
    {
      name: "the project Claude policy",
      drift: (root) => {
        const path = join(root, ".claude/settings.json");
        const settings = JSON.parse(readFileSync(path, "utf8"));
        settings.permissions.deny = [];
        writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
      },
      failing: "permissions:claude",
      stillPassing: ["permissions:configuration", "permissions:codex"],
    },
    {
      name: "a deleted project policy file",
      drift: (root) => rmSync(join(root, ".claude/settings.json")),
      failing: "permissions:configuration",
      stillPassing: ["permissions:codex"],
    },
  ];

  for (const { name, drift, failing, stillPassing } of cases) {
    await t.test(name, () => {
      const root = managedProject("adw-doctor-drift-");
      drift(root);
      const result = doctor(root, { env: { ADW_MANAGED_DEVCONTAINER: "1" } });
      assert.equal(result.status, EXIT_CHECK_FAILED);
      assert.equal(result.report.ok, false);
      assert.ok(result.failures.includes(failing), `expected ${failing} to fail; failures were ${result.failures.join(", ") || "none"}`);
      for (const id of stillPassing) assert.equal(result.statusOf(id), "pass", `${id} must not be collateral damage`);
    });
  }
});

test("doctor requires the activation contract and stops for invalid policy", async (t) => {
  await t.test("a missing adw.yaml", () => {
    const root = managedProject("adw-doctor-missing-config-");
    rmSync(join(root, "adw.yaml"));

    const result = doctor(root, { env: { ADW_MANAGED_DEVCONTAINER: "1" } });
    assert.equal(result.status, EXIT_CHECK_FAILED);
    assert.equal(result.statusOf("project-contract"), "fail");
    assert.equal(result.report.isolation, null);
    assert.match(result.report.checks.find(({ id }) => id === "project-contract").summary, /run adw:init/);
  });

  await t.test("an adw.yaml that does not match the contract", () => {
    const root = managedProject("adw-doctor-invalid-config-");
    writeFileSync(join(root, "adw.yaml"), "adw: 1\nbogus: true\n");

    const result = doctor(root, { env: { ADW_MANAGED_DEVCONTAINER: "1" } });
    assert.equal(result.status, EXIT_CHECK_FAILED);
    assert.deepEqual(result.ids, ["runtime:node", "plugin", "repository", "project-contract"]);
    const contract = result.report.checks.at(-1);
    assert.equal(contract.status, "fail");
    assert.deepEqual(contract.errors.map(({ path }) => path).sort(), ["/bogus"]);
    assert.match(contract.errors.find(({ path }) => path === "/bogus").message, /is not a supported key/);
  });

  await t.test("an adw.yaml that is not valid YAML", () => {
    const root = managedProject("adw-doctor-unparseable-config-");
    writeFileSync(join(root, "adw.yaml"), "adw: 1\n  : broken\n:\n");

    const result = doctor(root, { env: { ADW_MANAGED_DEVCONTAINER: "1" } });
    assert.equal(result.status, EXIT_CHECK_FAILED);
    assert.deepEqual(result.ids, ["runtime:node", "plugin", "repository", "project-contract"]);
    assert.equal(result.statusOf("project-contract"), "fail");
  });

  await t.test("a directory that is not a Git top level", () => {
    const root = mkdtempSync(join(tmpdir(), "adw-doctor-nogit-"));
    const result = doctor(root);
    assert.equal(result.status, EXIT_CHECK_FAILED);
    assert.deepEqual(result.ids, ["runtime:node", "plugin", "repository"]);
    assert.equal(result.statusOf("repository"), "fail");
  });
});

test("doctor reports a documentation branch that is not checked out, and never attaches it itself", () => {
  const root = managedProject("adw-doctor-docs-");
  assert.equal(doctor(root).statusOf("docs:worktree"), "pass");

  git(root, "worktree", "remove", "worktrees/docs");
  const detached = doctor(root);
  assert.equal(detached.statusOf("docs:worktree"), "fail");
  assert.ok(detached.failures.includes("docs:worktree"), detached.failures.join(", "));
  // Reporting only: the branch is still there and still not checked out.
  assert.equal(git(root, "rev-parse", "--verify", "--quiet", "refs/heads/docs").length > 0, true);
  assert.equal(doctor(root).statusOf("docs:worktree"), "fail");

  // A project that predates the docs branch is diagnosed, not failed.
  git(root, "branch", "-D", "docs");
  const missing = doctor(root);
  assert.equal(missing.statusOf("docs:branch"), "info");
  assert.equal(missing.failures.includes("docs:branch"), false);
});

test("doctor never writes", () => {
  const root = managedProject("adw-doctor-readonly-");
  writeFileSync(join(root, ".devcontainer/Dockerfile"), "drifted\n");
  const before = snapshot(root);

  for (const options of [{}, { checks: "permissions" }, { env: { ADW_MANAGED_DEVCONTAINER: "1" } }]) {
    const result = doctor(root, options);
    assert.equal(result.report.read_only, true);
  }
  const detailed = adw("doctor", ["--project-root", root, "--details"], { env: { ADW_MANAGED_DEVCONTAINER: "1" } });
  assert.equal(body(detailed).read_only, true);

  assert.deepEqual(snapshot(root), before);
});

test("--checks permissions inspects only the permission policy", () => {
  const root = managedProject("adw-doctor-permissions-");

  const scoped = doctor(root, { checks: "permissions" });
  assert.equal(scoped.status, 0, JSON.stringify(scoped.report));
  assert.deepEqual(scoped.ids, ["permissions:configuration", "permissions:codex", "permissions:claude"]);
  assert.equal(scoped.report.ok, true);
  assert.equal(scoped.report.isolation, undefined);

  // Container drift and a missing runtime are outside this selection; a drifted
  // project policy is not.
  writeFileSync(join(root, ".devcontainer/Dockerfile"), "drifted\n");
  const stillScoped = doctor(root, { checks: "permissions" });
  assert.equal(stillScoped.status, 0);
  assert.deepEqual(stillScoped.failures, []);

  writeFileSync(join(root, ".codex/config.toml"), "sandbox_mode = \"danger-full-access\"\n");
  const drifted = doctor(root, { checks: "permissions" });
  assert.equal(drifted.status, EXIT_CHECK_FAILED);
  assert.deepEqual(drifted.failures, ["permissions:codex"]);

  const rejected = adw("doctor", ["--project-root", root, "--checks", "everything"]);
  assert.notEqual(rejected.status, 0);
  assert.match(body(rejected).error.message, /--checks must be all or permissions/);
  assert.notEqual(rejected.status, EXIT_CONTRACT_INVALID);
});
