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

test("the generated helper remains dependency-free and runnable on Node 20", () => {
  assert.match(bundle, /^#!\/usr\/bin\/env node\n\/\/ Generated as a dependency-free Node\.js 20\+ runtime bundle/m);
  for (const match of bundle.matchAll(/(?:import[^;]*?from\s+|import\s*)["']([^"']+)["']/g)) {
    assert.match(match[1], /^node:/, `bundle has a non-built-in runtime dependency: ${match[1]}`);
  }
  assert.doesNotMatch(bundle, /(?:^|\n)\s*(?:import|require\s*\()[^\n]*(?:src\/helpers|\.ts["'])/, "bundle must not load TypeScript source at runtime");
});

test("the bundle covers every operational helper entry point maintained in source", () => {
  const operationalExports = new Map([
    ["src/helpers/approval.ts", ["computeApprovalDigest", "verifyApprovalDigest", "createApproval", "computeApprovalBundle", "createApprovalBundle", "verifyApprovalBundle"]],
    ["src/helpers/integrations.ts", ["computeRequirementsDigest", "recordExternalAction"]],
    ["src/helpers/migration.ts", ["resolveProjectPath", "applyAtomicMigration"]],
    ["src/helpers/project-version.ts", ["checkCompatibility"]],
    ["src/helpers/project-policy.ts", ["computePolicyDigest", "resolveProjectPolicy", "resolveValidationSet", "validateWorkItemPayload"]],
    ["src/helpers/schemas.ts", ["validateJsonSchema"]],
    ["src/helpers/validation.ts", ["recordValidation", "runValidationCommand"]],
  ]);

  for (const [sourcePath, exports] of operationalExports) {
    const source = read(sourcePath);
    for (const name of exports) {
      assert.match(source, new RegExp(`export (?:async )?function ${name}\\b`), `${sourcePath}: missing source export ${name}`);
      assert.match(bundle, new RegExp(`export (?:async )?function ${name}\\b`), `bundle: missing source operation ${name}`);
    }
  }
});

test("security- and evidence-critical source invariants are represented in the bundle", () => {
  const invariantMarkers = new Map([
    ["src/helpers/approval.ts", ["ADW-APPROVAL-DIGEST-V1\\0", "sha256", "timingSafeEqual"]],
    ["src/helpers/migration.ts", ["realpath", "isAbsolute", "expected_content", ".adw-migration-"]],
    ["src/helpers/project-version.ts", ["project_schema", "supported_project_schemas", "artifact_plugin_version", "migration_required"]],
    ["src/helpers/project-policy.ts", ["ADW-EFFECTIVE-POLICY-V1\\0", "affected_paths", "project_policy_digest", "required_validation"]],
    ["src/helpers/schemas.ts", ["additionalProperties", "date-time", "unresolvable schema reference"]],
    ["src/helpers/validation.ts", ["authorization", "[REDACTED]", "timed_out", "required"]],
    ["src/helpers/integrations.ts", ["ADW-INTEGRATION-REQUIREMENTS-V1\\0", "authorization", "[REDACTED]", "readback_digest"]],
  ]);

  for (const [sourcePath, markers] of invariantMarkers) {
    const source = read(sourcePath);
    for (const marker of markers) {
      assert.ok(source.includes(marker), `${sourcePath}: missing invariant marker ${JSON.stringify(marker)}`);
      assert.ok(bundle.includes(marker), `bundle: missing ${sourcePath} invariant marker ${JSON.stringify(marker)}`);
    }
  }
});
