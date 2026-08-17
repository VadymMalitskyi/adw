import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const pluginRoot = resolve(repositoryRoot, "plugin");
const skillsRoot = resolve(pluginRoot, "skills");

// The complete executable inventory. A skill added or removed without updating
// this list is a deliberate product decision, not an accident.
const SKILLS = [
  "address-review",
  "generate-docs",
  "doctor",
  "execute",
  "init",
  "investigate",
  "onboard",
  "plan",
  "quick",
  "review-plan",
  "status",
  "sync-docs",
];

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function skillText(name) {
  return read(`plugin/skills/${name}/SKILL.md`);
}

const authorization = read("plugin/authorization.md");

// A paragraph is the unit of context: a removed concept may be named only
// inside a paragraph that denies it exists.
function paragraphs(source) {
  return source.split(/\n\s*\n/);
}

// Prose is hard-wrapped, so unwrap each paragraph before splitting sentences.
function sentences(source) {
  return paragraphs(source).flatMap((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").split(/(?<=[.;])\s+/));
}

function parseSkillFrontmatter(name, source) {
  assert.ok(source.startsWith("---\n"), `${name}: frontmatter must begin on the first line`);
  const closing = source.indexOf("\n---\n", 4);
  assert.notEqual(closing, -1, `${name}: frontmatter must have a closing delimiter`);

  const block = source.slice(4, closing);
  assert.doesNotMatch(block, /\t/, `${name}: frontmatter must not contain tabs`);
  const metadata = {};
  for (const [index, line] of block.split("\n").entries()) {
    assert.notEqual(line.trim(), "", `${name}: frontmatter line ${index + 2} must not be blank`);
    const match = /^([a-z][a-z0-9_-]*):\s+(.+)$/.exec(line);
    assert.ok(match, `${name}: frontmatter line ${index + 2} must be a scalar key/value`);
    const [, key, rawValue] = match;
    assert.ok(!Object.hasOwn(metadata, key), `${name}: duplicate frontmatter key ${key}`);
    assert.ok(
      !(rawValue.startsWith('"') ^ rawValue.endsWith('"')) && !(rawValue.startsWith("'") ^ rawValue.endsWith("'")),
      `${name}: ${key} has an unmatched quote`,
    );
    metadata[key] = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, double, single) => double ?? single);
  }

  assert.deepEqual(Object.keys(metadata).sort(), ["description", "name"], `${name}: skills use only the portable name and description frontmatter fields`);
  assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${name}: invalid skill name`);
  assert.ok(metadata.name.length <= 64, `${name}: skill name exceeds 64 characters`);
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 1024, `${name}: invalid description length`);
  assert.doesNotMatch(metadata.description, /[<>]/, `${name}: description must not contain angle brackets`);
  return metadata;
}

function parseOpenAiMetadata(name, source) {
  assert.doesNotMatch(source, /\t/, `${name}: agents/openai.yaml must not contain tabs`);
  const lines = source.trimEnd().split("\n");
  assert.equal(lines.shift(), "interface:", `${name}: openai metadata must contain an interface mapping`);
  const values = {};
  for (const [index, line] of lines.entries()) {
    const match = /^ {2}([a-z][a-z0-9_]*): "([^"\n]+)"$/.exec(line);
    assert.ok(match, `${name}: invalid agents/openai.yaml line ${index + 2}`);
    assert.ok(!Object.hasOwn(values, match[1]), `${name}: duplicate openai metadata key ${match[1]}`);
    values[match[1]] = match[2];
  }
  assert.deepEqual(Object.keys(values).sort(), ["default_prompt", "display_name", "short_description"], `${name}: openai interface metadata has missing or unknown keys`);
  assert.ok(values.display_name.length <= 64, `${name}: display_name exceeds 64 characters`);
  assert.ok(values.short_description.length <= 80, `${name}: short_description exceeds 80 characters`);
  assert.match(values.default_prompt, new RegExp(`\\$${name}(?:\\b|\\s)`), `${name}: default_prompt must invoke its folder name`);
}

test("both provider manifests expose one physical skill tree", () => {
  const codex = readJson("plugin/.codex-plugin/plugin.json");
  const claude = readJson("plugin/.claude-plugin/plugin.json");
  for (const manifest of [codex, claude]) {
    assert.equal(manifest.name, "adw");
    assert.equal(manifest.skills, "./skills/");
  }
  assert.equal(codex.version, claude.version, "provider manifests must ship the same release");
  assert.equal(
    realpathSync(resolve(pluginRoot, codex.skills)),
    realpathSync(resolve(pluginRoot, claude.skills)),
    "providers must not maintain copied skill trees",
  );
  assert.equal(realpathSync(resolve(pluginRoot, codex.skills)), realpathSync(skillsRoot));
});

test("the skill inventory is exactly the executable set, each with valid metadata", () => {
  const inventory = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(inventory, [...SKILLS].sort(), "the shipped skills must match the executable inventory exactly");

  for (const name of SKILLS) {
    const skillDirectory = resolve(skillsRoot, name);
    assert.ok(existsSync(resolve(skillDirectory, "SKILL.md")), `${name}: missing SKILL.md`);
    assert.equal(parseSkillFrontmatter(name, skillText(name)).name, name, `${name}: frontmatter name must match its folder`);

    const openAiPath = resolve(skillDirectory, "agents/openai.yaml");
    assert.ok(existsSync(openAiPath), `${name}: missing agents/openai.yaml`);
    parseOpenAiMetadata(name, readFileSync(openAiPath, "utf8"));

    // Skills reason; the runtime executes. There is no per-skill script tree.
    assert.ok(!existsSync(resolve(skillDirectory, "scripts")), `${name}: skills must not bundle their own scripts`);
    assert.deepEqual(
      readdirSync(skillDirectory).sort(),
      ["SKILL.md", "agents"],
      `${name}: a skill is SKILL.md plus its provider metadata and nothing else`,
    );
  }
});

test("every skill resolves bundled resources from the loaded plugin, never from the project", () => {
  // The shared contract carries the portable resolution for both providers.
  assert.match(authorization, /\$\{CLAUDE_PLUGIN_ROOT\}/, "authorization.md must give the Claude Code plugin-root expansion");
  assert.match(authorization, /In Codex[\s\S]{0,200}absolute source location/i, "authorization.md must give the Codex loaded-source resolution");
  assert.match(
    authorization,
    /never from the project\s+or the current working directory/i,
    "authorization.md must forbid resolving plugin resources from the project or the working directory",
  );

  for (const name of SKILLS) {
    const source = skillText(name);
    const unwrapped = source.replace(/\s+/g, " ");
    const resolvesInline = /\$\{CLAUDE_PLUGIN_ROOT\}/.test(unwrapped) && /Codex/i.test(unwrapped);
    const defersToContract = /authorization\.md/.test(unwrapped) && /resolv(?:e|ing) the plugin root/i.test(unwrapped);
    assert.ok(
      resolvesInline || defersToContract,
      `${name}: must resolve the plugin root for both providers, or defer to authorization.md which does`,
    );

    // Every runtime call is anchored at the resolved plugin root.
    for (const [, prefix] of source.matchAll(/(\S*)adw\.mjs/g)) {
      assert.equal(prefix, "<plugin-root>/bin/", `${name}: adw.mjs must be invoked as <plugin-root>/bin/adw.mjs, found ${prefix}adw.mjs`);
    }

    assert.doesNotMatch(source, /(?:~\/|\/Users\/|\/home\/)[^\s`]*(?:\.claude|\.codex)|\.claude\/plugins|\.codex\/plugins/i, `${name}: hard-coded provider install path`);
    assert.doesNotMatch(source, /\.{1,2}\/(?:skills|bin|integrations|templates)\//, `${name}: bundled resources must not resolve relative to the working directory`);
    assert.doesNotMatch(source, /\$\(pwd\)|\$PWD|current working directory/i, `${name}: resources must not resolve from the current working directory`);
  }
});

test("no skill references a concept the lean workflow removed", () => {
  const removed = [
    ["the SYNC.yaml marker", /SYNC\.yaml/i],
    ["a canonical plan location", /changes\/[^\s`]*plan\.md/i],
    ["an approval artifact", /approval\.json|\bapproval (?:record|file|histor|bundle)/i],
    ["a plan digest", /\bplan digest\b|\bplan_digest\b/i],
    ["a run record", /\brun record|\bruns\/</i],
    ["a plan template registry", /\bplan template/i],
    ["personal local state", /\.adw\/local\.yaml|\.adw\/preferences\.md/i],
    ["the adw-helper wrapper", /\badw-helper\b/i],
    ["an execution mode", /\bexecution[ .]mode\b/i],
    ["a routing block", /\brouting block\b|\bAGENTS\.md\b|\bCLAUDE\.md\b/i],
  ];

  for (const name of SKILLS) {
    for (const paragraph of paragraphs(skillText(name))) {
      // Naming a removed concept is allowed only to say it does not exist.
      const denies = /\b(?:never|no|not|none|nothing|neither|without|refuse|stop)\b/i.test(paragraph);
      if (denies) continue;
      for (const [label, pattern] of removed) {
        assert.doesNotMatch(paragraph, pattern, `${name}: references ${label}, which no longer exists`);
      }
    }
  }
});

// The docs branch and its worktree are configurable, so a skill that hard-codes
// `docs` or `worktrees/docs` would quietly write to the wrong place in any
// project that renamed them.
test("every skill that touches documentation or plans takes the branch and worktree from configuration", () => {
  for (const name of ["generate-docs", "sync-docs", "plan"]) {
    const source = skillText(name);
    const unwrapped = source.replace(/\s+/g, " ");
    assert.match(unwrapped, /docs\.branch/, `${name}: must read docs.branch from adw config`);
    assert.match(unwrapped, /docs\.worktree/, `${name}: must read docs.worktree from adw config`);
    for (const paragraph of paragraphs(source)) {
      // Naming the default is allowed only where the paragraph also names the
      // setting it comes from.
      if (/docs\.(?:branch|worktree)/.test(paragraph)) continue;
      assert.doesNotMatch(paragraph, /`worktrees\/docs`/, `${name}: hard-codes the default docs worktree path`);
    }
  }
});

test("the skills state the safety invariants ADW never trades away", () => {
  const prohibitions = SKILLS.flatMap((name) => sentences(skillText(name)))
    .filter((sentence) => /\b(?:never|not|no|refuse|stop|prohibit)\b/i.test(sentence));

  for (const [label, pattern] of [
    ["merging", /\bmerge[sd]?\b/i],
    ["marking a pull request ready", /\bmarks? (?:a )?(?:pull request )?ready\b|\bmark ready\b/i],
    ["releasing", /\breleases?\b/i],
    ["deploying", /\bdeploys?\b/i],
    ["force-pushing", /\bforce-push(?:es|ing)?\b/i],
  ]) {
    assert.ok(
      prohibitions.some((sentence) => pattern.test(sentence)),
      `no skill states that ADW never performs ${label}`,
    );
  }

  // External content is data, not permission. The shared contract says it for
  // repository text; the skills that read external content say it again.
  const authorizationClaims = [...SKILLS.map(skillText), authorization]
    .flatMap(sentences)
    .filter((sentence) => /authoriz/i.test(sentence) && /\b(?:never|not|nothing|no)\b/i.test(sentence));
  assert.ok(
    authorizationClaims.some((sentence) => /\b(?:repository text|comments?|plans?|issue bodies|documents?|content)\b/i.test(sentence)),
    "nothing states that repository text and external content are never authorization",
  );
});

test("doctor owns managed-file repair without weakening preview authorization", () => {
  const source = skillText("doctor");
  assert.match(source, /refresh-preview/);
  assert.match(source, /refresh-apply/);
  assert.match(source, /ask once for approval/i);
  assert.match(source, /fingerprint binds apply/i);
  assert.match(source, /Run the deterministic doctor checks again after repair/i);
  assert.match(source, /Reclassify that finding as a maintainer decision/i);
  assert.match(source, /Repair authorization never permits hand-editing/i);
  assert.match(source, /project-owned container is never rewritten/i);
  assert.match(source, /credentials\s+are never changed/i);
});

test("VERSION, package, provider manifests, and marketplace catalogs stay in parity", () => {
  const version = read("VERSION").trim();
  assert.match(version, SEMVER);

  const codexCatalogEntry = readJson(".agents/plugins/marketplace.json").plugins.find(({ name }) => name === "adw");
  const claudeCatalogEntry = readJson(".claude-plugin/marketplace.json").plugins.find(({ name }) => name === "adw");
  assert.ok(codexCatalogEntry && claudeCatalogEntry, "both catalogs must contain the adw plugin");

  // Codex's catalog entry delegates the release version to the plugin manifest
  // at its source path. Claude's catalog duplicates it.
  const codexCatalogManifest = JSON.parse(readFileSync(resolve(repositoryRoot, codexCatalogEntry.source.path, ".codex-plugin/plugin.json"), "utf8"));

  const values = new Map([
    ["VERSION", version],
    ["package.json", readJson("package.json").version],
    ["Codex manifest", readJson("plugin/.codex-plugin/plugin.json").version],
    ["Claude manifest", readJson("plugin/.claude-plugin/plugin.json").version],
    ["Codex catalog-resolved manifest", codexCatalogManifest.version],
    ["Claude catalog", claudeCatalogEntry.version],
  ]);
  for (const [location, candidate] of values) assert.equal(candidate, version, `${location} version must equal ${version}`);

  const codexRoot = realpathSync(resolve(repositoryRoot, codexCatalogEntry.source.path));
  const claudeRoot = realpathSync(resolve(repositoryRoot, claudeCatalogEntry.source));
  assert.equal(codexRoot, realpathSync(pluginRoot));
  assert.equal(claudeRoot, codexRoot, "both marketplaces must resolve to the same plugin root");
  assert.equal(relative(repositoryRoot, codexRoot), "plugin");
});
