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
  "brainstorm",
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

  assert.deepEqual(Object.keys(metadata).sort(), ["description", "disable-model-invocation", "name"], `${name}: skills must declare the shared metadata plus Claude's explicit-only policy`);
  assert.match(metadata.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${name}: invalid skill name`);
  assert.ok(metadata.name.length <= 64, `${name}: skill name exceeds 64 characters`);
  assert.ok(metadata.description.length > 0 && metadata.description.length <= 1024, `${name}: invalid description length`);
  assert.doesNotMatch(metadata.description, /[<>]/, `${name}: description must not contain angle brackets`);
  assert.equal(metadata["disable-model-invocation"], "true", `${name}: Claude must never invoke ADW implicitly`);
  return metadata;
}

function parseOpenAiMetadata(name, source) {
  assert.doesNotMatch(source, /\t/, `${name}: agents/openai.yaml must not contain tabs`);
  const lines = source.trimEnd().split("\n");
  assert.equal(lines.shift(), "interface:", `${name}: openai metadata must contain an interface mapping`);
  assert.equal(lines.at(-2), "policy:", `${name}: openai metadata must contain an invocation policy`);
  assert.equal(lines.at(-1), "  allow_implicit_invocation: false", `${name}: Codex must never invoke ADW implicitly`);
  lines.splice(-2);
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

test("no skill references a concept the stateless workflow removed", () => {
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
    // The removed concept is the routing block ADW used to inject into an
    // instruction file, not the files themselves: init now seeds them.
    ["a routing block", /\brouting block\b/i],
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

test("execute uses the deterministic shared gates and both provider routes", () => {
  const source = skillText("execute");
  const unwrapped = source.replace(/\s+/g, " ");

  assert.match(unwrapped, /execution-preflight/, "execute must invoke shared preflight before workers");
  assert.match(unwrapped, /execution-finalize/, "execute must invoke shared finalization after workers");
  assert.match(unwrapped, /preflight[\s\S]*execution-assert-target[\s\S]*finaliz/i, "execute must preserve preflight → per-stage gate → finalizer ordering");
  assert.match(unwrapped, /adw-execute-phase-codex\.mjs/, "execute must document the Codex native runner");
  assert.match(unwrapped, /in-session subagents/i, "execute must drive Claude stages with in-session subagents");
  assert.match(unwrapped, /\{component, cwd, command\}/, "execute must require exact configured validation tuples");
  assert.match(unwrapped, /never shell out to `claude -p`/i, "execute must prohibit a headless Claude fallback");
  assert.match(unwrapped, /even when the provider result failed/i, "execute must finalize provider failures for Git evidence");
  assert.match(unwrapped, /never means[\s\S]{0,120}integrated/i, "execute must not claim cross-branch integration success");
  assert.match(unwrapped, /pass that value back as `since`/i, "execute must gate review stages against silent edits");
  assert.match(unwrapped, /fresh confirmation/i, "execute must require fresh confirmation for cross-session recovery");
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

test("project conventions have one home and agent instructions only route to it", () => {
  const agents = read("plugin/templates/agents.md");
  const catalog = read("plugin/templates/code-style.md");
  const init = skillText("init");
  const generateDocs = skillText("generate-docs");

  assert.match(agents, /docs\/architecture\.md/, "AGENTS.md must route to the architecture entry point");
  assert.match(agents, /docs\/conventions\.md/, "AGENTS.md must route to shared project conventions");
  assert.match(agents, /docs\/components\/<component>\.md/, "AGENTS.md must route to component documentation");
  assert.match(agents, /Do not copy project conventions into this file/i, "AGENTS.md must state its routing-only boundary");

  const catalogRules = catalog.split("\n").filter((line) => line.startsWith("- "));
  assert.ok(catalogRules.length > 0, "the convention catalog must contain selectable rules");
  for (const rule of catalogRules) {
    assert.ok(!agents.includes(rule), `AGENTS.md duplicates convention catalog rule: ${rule}`);
  }

  assert.match(init, /<docs\.worktree>\/docs\/conventions\.md/, "init must offer conventions on the docs branch");
  assert.match(init, /Never append those conventions to `AGENTS\.md` or `CLAUDE\.md`/i, "init must not put conventions in agent instructions");
  assert.match(generateDocs, /baseline set[\s\S]*docs\/architecture\.md[\s\S]*docs\/conventions\.md[\s\S]*docs\/components\/<component>\.md/i, "generate-docs must create the shared baseline");
  assert.match(generateDocs, /single shared home/i, "generate-docs must define conventions ownership");
});

test("the authorization contract resolves conflicts by domain", () => {
  const agents = read("plugin/templates/agents.md");
  const localProfile = read("plugin/templates/user-profile.md");

  assert.match(authorization, /## Resolve conflicts by domain/, "authorization.md must own precedence rules");
  assert.match(authorization, /stricter result wins:\s+`deny` over `ask` over\s+`allow`/i, "effect conflicts must fail toward the stricter verdict");
  assert.match(authorization, /latest explicit direction[\s\S]{0,180}current conversation/i, "current conversation must own task intent");
  assert.match(authorization, /current conversation wins, then the checkout-local[\s\S]{0,120}\.adw\/user\.md[\s\S]{0,120}global `~\/\.config\/adw\/profile\.md`/i, "personal preference precedence must be explicit");
  assert.match(authorization, /Personal profiles cannot override them/i, "profiles must not override shared project decisions");
  assert.match(authorization, /Executable formatter,[\s\S]{0,320}authoritative[\s\S]{0,40}over prose/i, "executable convention configuration must beat prose");
  assert.match(authorization, /live source and executable configuration win over[\s\S]{0,120}documentation/i, "live repository facts must beat generated docs");

  assert.ok(agents.indexOf("~/.config/adw/profile.md") < agents.indexOf("then `.adw/user.md`"), "AGENTS.md must read the global profile before the checkout-local one");
  assert.match(agents, /current conversation wins, then `.adw\/user\.md`, then the global profile/i, "AGENTS.md must state personal preference priority");
  assert.match(localProfile, /cannot override shared project policy, project conventions, or an ADW\s+safety boundary/i, "the local profile template must state its limits");
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
