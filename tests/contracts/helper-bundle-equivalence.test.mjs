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

test("the generated helper is self-contained and runnable on Node 20", () => {
  assert.match(bundle, /^#!\/usr\/bin\/env node\n/);
  for (const match of bundle.matchAll(/(?:import[^;]*?from\s+|import\s*)["']([^"']+)["']/g)) {
    assert.match(match[1], /^node:/, `bundle has a non-built-in runtime dependency: ${match[1]}`);
  }
  assert.doesNotMatch(bundle, /(?:^|\n)\s*(?:import|require\s*\()[^\n]*(?:src\/helpers|\.ts["'])/, "bundle must not load TypeScript source at runtime");
});

test("the canonical source and generated bundle expose every operational helper", () => {
  const source = read("src/helpers/runtime-bundle.mjs");
  const operations = [
    "computeApprovalBundle", "createApprovalBundle", "verifyApprovalBundle", "computeAuthorizationDigest",
    "computeRequirementsDigest", "recordExternalAction", "resolveProjectPath", "applyAtomicWrites",
    "computePolicyDigest", "resolveProjectPolicy", "resolveValidationSet",
    "validateWorkItemPayload", "validateJsonSchema", "validateArtifact", "parseYaml", "loadArtifactFile",
    "recordValidation", "runValidationCommand",
  ];
  for (const name of operations) {
    assert.match(source, new RegExp(`export (?:async )?function ${name}\\b`), `canonical source: missing ${name}`);
    assert.match(bundle, new RegExp(`\\b${name}(?:,|\\n)`), `generated bundle: missing exported ${name}`);
  }
});

test("security- and evidence-critical canonical invariants are represented in the bundle", () => {
  const source = read("src/helpers/runtime-bundle.mjs");
  const markers = [
    "ADW-APPROVAL-BUNDLE-V2\\0", "ADW-EXTERNAL-AUTHORIZATION-V1\\0", "timingSafeEqual", "expected_content",
    ".adw-atomic-write-", "ADW-EFFECTIVE-POLICY-V1\\0", "project_policy_digest",
    "ADW-INTEGRATION-REQUIREMENTS-V1\\0", "[REDACTED]", "timed_out", "readback_digest",
  ];
  for (const marker of markers) {
    assert.ok(source.includes(marker), `canonical source: missing invariant ${JSON.stringify(marker)}`);
    assert.ok(bundle.includes(marker), `generated bundle: missing invariant ${JSON.stringify(marker)}`);
  }
});
