import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { dispatch, EXIT } from "../../plugin/lib/adw-helper.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function readSkill(name) {
  return readFileSync(resolve(repositoryRoot, `plugin/skills/${name}/SKILL.md`), "utf8");
}

test("plan skill creates a bounded docs-worktree planning bundle and stops before implementation", () => {
  const skill = readSkill("plan");

  assert.match(skill, /changes\/<change-id>\/spec\.md/);
  assert.match(skill, /changes\/<change-id>\/plan\.yaml/);
  assert.match(skill, /planning bundle/);
  assert.match(skill, /integrations\.yaml/);
  assert.match(skill, /external-events/);
  assert.match(skill, /never modify application code/i);
  assert.match(skill, /Never create or switch a code branch/);
  assert.match(skill, /Never implement a task/);
  assert.match(skill, /Do not create `approval\.json`/);
});

test("plan skill resolves bundled resources portably", () => {
  const skill = readSkill("plan");

  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(skill, /absolute source location advertised for this loaded `SKILL\.md`/);
  assert.match(skill, /without using the project directory/);
  assert.match(skill, /lib\/adw-helper\.mjs/);
  assert.match(skill, /Never write into the installed plugin directory/);
});

test("plan skill requires strict IDs, sequential tasks, documentation impact, and structured commands", () => {
  const skill = readSkill("plan");

  assert.match(skill, /\^\[a-z0-9\]/);
  assert.match(skill, /Number `id` contiguously from 1/);
  assert.match(skill, /`affected_paths`/);
  assert.match(skill, /`anchors`/);
  assert.match(skill, /`restrictions`/);
  assert.match(skill, /`command`, project-relative `cwd`, positive `timeout_ms`, and boolean `required`/);
  assert.match(skill, /documentation.*`none`, `update`, or `new`/is);
  assert.match(skill, /observable manifest, task runner, CI workflow, or existing project documentation/);
});

test("frozen plan schema enforces ordering, IDs, documentation, and command descriptors", async () => {
  const plan = {
    schema: 2,
    change_id: "api.retry_2",
    summary: "Add bounded retries",
    effective_policy: { components: ["app"], unowned_paths: [], project_policy_digest: "a".repeat(64), required_validation: [] },
    tasks: [{
      id: 1,
      title: "Implement retries",
      description: "Add the bounded retry policy.",
      affected_paths: ["src/client.mjs"],
      anchors: ["request"],
      restrictions: ["Do not retry unsafe writes"],
      validation: [{ command: "npm test", cwd: ".", timeout_ms: 120000, required: true, source: "package.json#scripts.test" }],
    }],
    documentation: { impact: "update", files: ["docs/client.md"] },
  };

  const valid = await dispatch("validate", { artifact: "plan", data: plan });
  assert.equal(valid.exitCode, EXIT.OK);

  const invalidId = await dispatch("validate", { artifact: "plan", data: { ...plan, change_id: "API/retry" } });
  assert.equal(invalidId.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(invalidId.body.errors.some(({ path }) => path === "/change_id"));

  const outOfSequence = structuredClone(plan);
  outOfSequence.tasks[0].id = 2;
  const invalidSequence = await dispatch("validate", { artifact: "plan", data: outOfSequence });
  assert.equal(invalidSequence.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(invalidSequence.body.errors.some(({ keyword }) => keyword === "sequence"));

  const missingDocs = structuredClone(plan);
  missingDocs.documentation.files = [];
  const invalidDocs = await dispatch("validate", { artifact: "plan", data: missingDocs });
  assert.equal(invalidDocs.exitCode, EXIT.SCHEMA_INVALID);
  assert.ok(invalidDocs.body.errors.some(({ keyword }) => keyword === "documentation"));

  const flatCommand = structuredClone(plan);
  flatCommand.tasks[0].validation = ["npm test"];
  const invalidCommand = await dispatch("validate", { artifact: "plan", data: flatCommand });
  assert.equal(invalidCommand.exitCode, EXIT.SCHEMA_INVALID);
});
