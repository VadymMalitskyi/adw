import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  InputError,
  loadArtifactFile,
  parseYaml,
  validateJsonSchema,
} from "../../plugin/lib/adw-helper.mjs";

const projectYaml = `schema: 5
git:
  default_branch: main
documentation:
  mode: branch
  branch: docs
  worktree: worktrees/docs
  sync_marker: SYNC.yaml
  delivery: direct-push
execution:
  isolation: provider-sandbox
  enforcement: preferred
  permissions:
    profile: managed-development
components: {}
validation:
  default: []
`;

test("helper reads, parses, validates, and digests artifact files itself", async () => {
  const root = mkdtempSync(join(tmpdir(), "adw-artifact-file-"));
  writeFileSync(join(root, "adw.yaml"), projectYaml);
  const loaded = await loadArtifactFile({ project_root: root, path: "adw.yaml", artifact: "project" });
  assert.equal(loaded.validation.valid, true);
  assert.equal(loaded.data.documentation.worktree, "worktrees/docs");
  assert.match(loaded.digest, /^[0-9a-f]{64}$/);
});

test("YAML parsing uses 1.2 scalars and rejects duplicate keys", () => {
  assert.equal(parseYaml("value: no\n").value, "no");
  assert.equal(parseYaml("value: |\n  first\n  second\n").value, "first\nsecond\n");
  assert.throws(() => parseYaml("schema: 5\nschema: 4\n"), InputError);
  assert.throws(() => parseYaml(Buffer.from([0xff]), "invalid-utf8.yaml"), /not valid UTF-8/);
});

test("JSON Schema validation enforces full composed and array constraints", () => {
  const schema = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "array",
    maxItems: 1,
    uniqueItems: true,
    items: { oneOf: [{ const: "allowed" }, { type: "integer", maximum: 3 }] },
  };
  assert.equal(validateJsonSchema(schema, ["allowed"]).valid, true);
  const invalid = validateJsonSchema(schema, [4, 4]);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some(({ keyword }) => keyword === "maxItems"));
  assert.ok(invalid.errors.some(({ keyword }) => keyword === "uniqueItems"));
  assert.ok(invalid.errors.some(({ keyword }) => keyword === "maximum"));
  assert.throws(() => validateJsonSchema({ $schema: "https://json-schema.org/draft/2020-12/schema", imaginaryKeyword: true }, {}), /unknown keyword/);
});
