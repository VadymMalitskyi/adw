import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const pluginRoot = resolve(repositoryRoot, "plugin");

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, relativePath), "utf8"));
}

const codexManifest = readJson("plugin/.codex-plugin/plugin.json");
const claudeManifest = readJson("plugin/.claude-plugin/plugin.json");
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");

test("provider manifests identify one versioned ADW plugin and shared skill tree", () => {
  assert.equal(codexManifest.name, "adw");
  assert.equal(claudeManifest.name, "adw");
  assert.equal(codexManifest.version, claudeManifest.version);
  assert.match(codexManifest.version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
  assert.equal(codexManifest.skills, "./skills/");
  assert.equal(claudeManifest.skills, "./skills/");
});

test("repo-local marketplaces point to the approved plugin root", () => {
  const codexEntry = codexMarketplace.plugins.find(({ name }) => name === "adw");
  const claudeEntry = claudeMarketplace.plugins.find(({ name }) => name === "adw");

  assert.ok(codexEntry);
  assert.ok(claudeEntry);
  assert.equal(codexEntry.source.source, "local");
  assert.equal(codexEntry.source.path, "./plugin");
  assert.equal(claudeEntry.source, "./plugin");
  assert.equal(resolve(repositoryRoot, codexEntry.source.path), pluginRoot);
  assert.equal(resolve(repositoryRoot, claudeEntry.source), pluginRoot);
  assert.equal(claudeEntry.version, claudeManifest.version);
  assert.deepEqual(codexEntry.policy, {
    installation: "AVAILABLE",
    authentication: "ON_INSTALL",
  });
  assert.equal(codexEntry.category, "Developer Tools");
});

test("shared doctor skill is provider-namespaced as adw:doctor", () => {
  const skill = readFileSync(resolve(pluginRoot, "skills/doctor/SKILL.md"), "utf8");
  const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);

  assert.ok(frontmatter, "doctor skill must have YAML frontmatter");
  assert.match(frontmatter[1], /^name:\s*doctor\s*$/m);
  assert.match(frontmatter[1], /^description:\s*\S.+$/m);
  assert.doesNotMatch(frontmatter[1], /^name:\s*adw:doctor\s*$/m);
});

test("smoke skill documents portable bundled-resource resolution", () => {
  const skill = readFileSync(resolve(pluginRoot, "skills/doctor/SKILL.md"), "utf8");

  assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(skill, /absolute source location advertised for this skill/);
  assert.match(skill, /Never assume that the current working directory is the plugin root/);
});
