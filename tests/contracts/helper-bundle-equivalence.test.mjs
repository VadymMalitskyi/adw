import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

const bundle = read("plugin/lib/adw-helper.mjs");
const source = read("src/helpers/runtime-bundle.mjs");

test("the generated helper is self-contained and runnable on Node 20", () => {
  assert.match(bundle, /^#!\/usr\/bin\/env node\n/);
  for (const match of bundle.matchAll(/(?:import[^;]*?from\s+|import\s*)["']([^"']+)["']/g)) {
    assert.match(match[1], /^node:/, `bundle has a non-built-in runtime dependency: ${match[1]}`);
  }
  assert.doesNotMatch(bundle, /(?:^|\n)\s*(?:import|require\s*\()[^\n]*(?:src\/helpers|\.ts["'])/, "bundle must not load TypeScript source at runtime");
});

test("the canonical source and generated bundle expose every operational helper", () => {
  const operations = [
    "computeDigest", "parseYaml", "validateProjectConfig", "loadProjectConfig",
    "createPlanApproval", "validatePlanApproval", "verifyPlanApproval", "supersedePlanApproval",
    "createRunRecord", "validateRunRecord", "updateRunRecord",
    "recordValidation", "resolveValidationCommands", "runValidationCommand",
    "resolveProjectPath", "resolveProjectDirectory", "applyAtomicWrites",
  ];
  for (const name of operations) {
    assert.match(source, new RegExp(`export (?:async )?function ${name}\\b`), `canonical source: missing ${name}`);
    assert.match(bundle, new RegExp(`\\b${name}(?:,|\\n)`), `generated bundle: missing exported ${name}`);
  }
});

test("security- and evidence-critical canonical invariants are represented in the bundle", () => {
  const markers = [
    "ADW-PLAN-APPROVAL-V1\\0", "timingSafeEqual", "expected_content", ".adw-atomic-write-",
    "[REDACTED]", "timed_out", "cannot be passed while a required command failed",
    "cannot move backwards", "credential-like",
  ];
  for (const marker of markers) {
    assert.ok(source.includes(marker), `canonical source: missing invariant ${JSON.stringify(marker)}`);
    assert.ok(bundle.includes(marker), `generated bundle: missing invariant ${JSON.stringify(marker)}`);
  }
});

test("no schema, policy, or receipt framework reaches the released helper", () => {
  const forbidden = [
    "ARTIFACT_SCHEMAS", "validateJsonSchema", "validateArtifact", "loadArtifactFile",
    "computeApprovalBundle", "createApprovalBundle", "verifyApprovalBundle",
    "resolveProjectPolicy", "computePolicyDigest", "project_policy_digest",
    "computeRequirementsDigest", "computeAuthorizationDigest", "recordExternalAction",
    "validateWorkItemPayload", "readback_digest", "Ajv",
  ];
  for (const name of forbidden) {
    assert.ok(!source.includes(name), `canonical source contains unsupported machinery: ${name}`);
    assert.ok(!bundle.includes(name), `generated bundle contains unsupported machinery: ${name}`);
  }
  assert.ok(!/"ajv"/.test(read("package.json")), "AJV must not remain a dependency");
});

test("the helper bundle stays small enough to ship inside the plugin", () => {
  // The only bundled dependency left is the YAML 1.2 parser, which is required
  // for duplicate-key-safe project-configuration parsing.
  assert.ok(bundle.length < 600_000, `helper bundle grew to ${bundle.length} bytes`);
  assert.match(bundle, /yaml/i, "the YAML parser is the one intentional bundled dependency");
});
