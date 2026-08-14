import assert from "node:assert/strict";
import { mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createRunRecord,
  EXIT,
  InputError,
  dispatch,
  loadProjectConfig,
  parseYaml,
  updateRunRecord,
  validateProjectConfig,
  validateRunRecord,
} from "../../plugin/lib/adw-helper.mjs";

const MINIMAL = `adw: 1
git:
  base_branch: main
docs:
  branch: docs
  worktree: worktrees/docs
execution:
  mode: sequential
  max_parallel: 1
  isolation: provider-sandbox
components:
  app:
    path: "."
    validate:
      - npm test
`;

function config(overrides = "") {
  return validateProjectConfig(parseYaml(`${MINIMAL}${overrides}`, "adw.yaml"));
}

function errorPaths(result) {
  return result.errors.map(({ path }) => path);
}

test("the project contract accepts a small handwritten configuration and normalizes its defaults", () => {
  const result = config();
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  assert.equal(result.data.docs.sync_marker, "SYNC.yaml");
  assert.deepEqual(result.data.components.app.validate, [
    { command: "npm test", cwd: ".", timeout_ms: 120000, required: true },
  ]);
  assert.deepEqual(result.data.providers, {});
  assert.deepEqual(result.data.development.runtime_versions, {});
});

test("the project contract rejects only operationally important defects", () => {
  assert.deepEqual(errorPaths(validateProjectConfig(parseYaml("adw: 5\n", "adw.yaml"))).slice(0, 1), ["/adw"]);

  const versioned = validateProjectConfig(parseYaml("schema: 99\ngit:\n  default_branch: main\n", "adw.yaml"));
  assert.equal(versioned.valid, false);
  assert.ok(errorPaths(versioned).includes("/schema"), "a schema-versioned configuration is reported, never silently reinterpreted");

  for (const [line, replacement, expected] of [
    ["  isolation: provider-sandbox\n", "  isolation: nowhere\n", "/execution/isolation"],
    ["  mode: sequential\n", "  mode: parallel\n", "/execution/mode"],
    ["  max_parallel: 1\n", "  max_parallel: 0\n", "/execution/max_parallel"],
  ]) {
    const broken = validateProjectConfig(parseYaml(MINIMAL.replace(line, replacement), "adw.yaml"));
    assert.ok(errorPaths(broken).includes(expected), `${expected} must be rejected`);
  }

  const traversal = config(`  other:
    path: ../outside
`);
  assert.ok(errorPaths(traversal).includes("/components/other/path"));

  const duplicate = config(`  twin:
    path: "./"
`);
  assert.ok(errorPaths(duplicate).some((path) => path.startsWith("/components/twin/path")), "duplicate component paths are ambiguous ownership");

  const placeholder = validateProjectConfig(parseYaml(MINIMAL.replace("      - npm test\n", "      - \"<command>\"\n"), "adw.yaml"));
  assert.ok(errorPaths(placeholder).includes("/components/app/validate/0"));

  const empty = validateProjectConfig(parseYaml(MINIMAL.replace("components:\n  app:\n    path: \".\"\n    validate:\n      - npm test\n", "components: {}\n"), "adw.yaml"));
  assert.ok(errorPaths(empty).includes("/components"));

  const unknown = config("surprise: true\n");
  assert.ok(errorPaths(unknown).includes("/surprise"));
});

test("credential-like configuration is rejected everywhere, including inside opaque provider settings", () => {
  const secret = config(`providers:
  work_tracker:
    provider: example-tracker
    required: true
    settings:
      api_key: leaked
`);
  assert.equal(secret.valid, false);
  assert.ok(errorPaths(secret).some((path) => path.endsWith("/api_key")));

  const opaque = config(`providers:
  work_tracker:
    provider: example-tracker
    required: true
    settings:
      organization: example
      hierarchy: feature-story
`);
  assert.equal(opaque.valid, true, JSON.stringify(opaque.errors));
  assert.deepEqual(opaque.data.providers.work_tracker.settings, { organization: "example", hierarchy: "feature-story" });

  const unknownCapability = config(`providers:
  deployment:
    provider: example
`);
  assert.ok(errorPaths(unknownCapability).includes("/providers/deployment"));
});

test("YAML 1.2 duplicate-key rejection still guards the project contract", () => {
  assert.throws(() => parseYaml("adw: 1\nadw: 1\n", "adw.yaml"), InputError);
  assert.equal(parseYaml("value: no\n").value, "no");
});

test("the helper reads, validates, and digests the project file itself", async () => {
  const root = mkdtempSync(join(tmpdir(), "adw-project-"));
  writeFileSync(join(root, "adw.yaml"), MINIMAL);
  const loaded = await loadProjectConfig({ project_root: root, path: "adw.yaml" });
  assert.equal(loaded.validation.valid, true, JSON.stringify(loaded.validation.errors));
  assert.equal(loaded.data.docs.worktree, "worktrees/docs");
  assert.match(loaded.digest, /^[0-9a-f]{64}$/);

  symlinkSync(join(root, "adw.yaml"), join(root, "linked.yaml"));
  await assert.rejects(loadProjectConfig({ project_root: root, path: "linked.yaml" }), /non-symlink/);
  await assert.rejects(loadProjectConfig({ project_root: root, path: "../escape.yaml" }), /escapes the project root/);
});

const RUN = {
  change_id: "tenant-throttling",
  phase_id: "foundations",
  plan_digest: "a".repeat(64),
  base_branch: "main",
  base_commit: "b".repeat(40),
  started_at: "2026-08-13T12:00:00Z",
  groups: [
    { group_id: "contracts", tasks: ["IMPLEMENT the throttling contract"], affected_paths: ["src/contracts"] },
    { group_id: "storage", tasks: ["IMPLEMENT the counter store"], affected_paths: ["src/storage"] },
  ],
};

test("a phase run record starts prepared with deterministic branches and worktrees", () => {
  const record = createRunRecord(RUN);
  assert.equal(validateRunRecord(record).valid, true);
  assert.equal(record.status, "running");
  assert.equal(record.completed_at, null);
  assert.equal(record.groups.contracts.branch, "adw/tenant-throttling/contracts");
  assert.equal(record.groups.contracts.worktree, "worktrees/tenant-throttling/contracts");
  assert.equal(record.groups.contracts.status, "prepared");
  assert.deepEqual(record.groups.storage.review, { status: "pending", high_findings: [] });

  assert.throws(() => createRunRecord({ ...RUN, groups: [RUN.groups[0], RUN.groups[0]] }), /duplicate group id/);
  assert.throws(() => createRunRecord({ ...RUN, base_commit: "short" }), /base_commit/);
  assert.throws(() => createRunRecord({ ...RUN, groups: [] }), /at least one group/);
});

test("group state advances only forward and never leaves a terminal status", () => {
  let record = createRunRecord(RUN);
  for (const status of ["implementing", "reviewing"]) {
    record = updateRunRecord(record, { groups: { contracts: { status } } });
    assert.equal(record.groups.contracts.status, status);
  }
  assert.throws(() => updateRunRecord(record, { groups: { contracts: { status: "implementing" } } }), /cannot move backwards/);

  const failed = updateRunRecord(record, { groups: { contracts: { status: "failed" } } });
  assert.equal(failed.groups.contracts.status, "failed");
  assert.throws(() => updateRunRecord(failed, { groups: { contracts: { status: "validating" } } }), /terminal status failed/);

  // A failed sibling must not corrupt an independent group's own progress.
  assert.equal(failed.groups.storage.status, "prepared");
  const sibling = updateRunRecord(failed, { groups: { storage: { status: "implementing" } } });
  assert.equal(sibling.groups.storage.status, "implementing");
  assert.equal(sibling.groups.contracts.status, "failed");

  assert.throws(() => updateRunRecord(record, { groups: { contracts: { branch: "adw/other" } } }), /branch is immutable/);
  assert.throws(() => updateRunRecord(record, { groups: { missing: { status: "failed" } } }), /unknown group/);
  assert.throws(() => updateRunRecord(record, { groups: { contracts: { secret: "x" } } }), /unsupported field/);
});

test("a group cannot be recorded as passed without truthful review and validation evidence", () => {
  const record = createRunRecord(RUN);
  const staged = updateRunRecord(updateRunRecord(record, { groups: { contracts: { status: "implementing" } } }), {
    groups: { contracts: { status: "validating" } },
  });

  assert.throws(() => updateRunRecord(staged, { groups: { contracts: { status: "passed" } } }), /independent review/);

  const reviewed = updateRunRecord(staged, { groups: { contracts: { review: { status: "passed", high_findings: [] } } } });
  assert.throws(() => updateRunRecord(reviewed, { groups: { contracts: { status: "passed" } } }), /validation passes/);

  for (const failure of [
    { command: "npm test", cwd: ".", exit_code: 1, signal: null, timed_out: false, duration_ms: 5, summary: "", required: true },
    { command: "npm test", cwd: ".", exit_code: null, signal: "SIGTERM", timed_out: false, duration_ms: 5, summary: "", required: true },
    { command: "npm test", cwd: ".", exit_code: null, signal: null, timed_out: true, duration_ms: 5, summary: "", required: true },
  ]) {
    assert.throws(
      () => updateRunRecord(reviewed, { groups: { contracts: { validation: { status: "passed", commands: [failure] } } } }),
      /cannot be passed/,
      `a required ${JSON.stringify(failure)} must not be recorded as passed`,
    );
  }

  assert.throws(
    () => updateRunRecord(reviewed, { groups: { contracts: { validation: { status: "passed", commands: [], deferred: [{ command: "audit", reason: "offline", required: true }] } } } }),
    /required check is deferred/,
  );

  const passed = updateRunRecord(
    updateRunRecord(reviewed, {
      groups: {
        contracts: {
          validation: { status: "passed", commands: [{ command: "npm test", cwd: ".", exit_code: 0, signal: null, timed_out: false, duration_ms: 5, summary: "", required: true }] },
          implementation_commit: "c".repeat(40),
        },
      },
    }),
    { groups: { contracts: { status: "passed" } } },
  );
  assert.equal(passed.groups.contracts.status, "passed");
  assert.throws(() => updateRunRecord(passed, { status: "passed", completed_at: "2026-08-13T13:00:00Z" }), /cannot be passed while a group/);
});

test("run records reject unsafe identifiers, duplicate isolation targets, and secret leakage", () => {
  const record = createRunRecord(RUN);
  const collide = structuredClone(record);
  collide.groups.storage.branch = collide.groups.contracts.branch;
  assert.ok(validateRunRecord(collide).errors.some(({ message }) => /duplicates another group's branch/.test(message)));

  const shared = structuredClone(record);
  shared.groups.storage.worktree = shared.groups.contracts.worktree;
  assert.ok(validateRunRecord(shared).errors.some(({ message }) => /duplicates another group's worktree/.test(message)));

  const escaping = structuredClone(record);
  escaping.groups.contracts.affected_paths = ["../outside"];
  assert.ok(validateRunRecord(escaping).errors.some(({ path }) => path.endsWith("/affected_paths/0")));

  const leaking = structuredClone(record);
  leaking.groups.contracts.tracker = { provider: "example", token: "secret-value" };
  assert.equal(validateRunRecord(leaking).valid, false);
});

test("the reduced dispatch surface exposes the 1.0 contract and no schema machinery", async () => {
  const digest = await dispatch("digest", { content: "plan bytes\n" });
  assert.equal(digest.exitCode, EXIT.OK);
  assert.match(digest.body.digest, /^[0-9a-f]{64}$/);

  const invalid = await dispatch("validate-project", { data: { adw: 2 } });
  assert.equal(invalid.exitCode, EXIT.CONTRACT_INVALID);
  assert.equal(invalid.body.ok, false);

  const record = await dispatch("create-run-record", RUN);
  assert.equal(record.exitCode, EXIT.OK);
  const validated = await dispatch("validate-run-record", { record: record.body.record });
  assert.equal(validated.exitCode, EXIT.OK);

  await assert.rejects(dispatch("validate", { artifact: "plan", data: {} }), /unknown command/);
  for (const removed of ["load-artifact-file", "digest-bundle", "create-approval-bundle", "resolve-project-policy", "digest-requirements", "digest-authorization", "record-external-action", "validate-work-item-payload"]) {
    await assert.rejects(dispatch(removed, {}), /unknown command/, `${removed} must be absent from the 1.0 helper`);
  }
});
