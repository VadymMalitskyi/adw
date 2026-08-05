import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");
const pluginRoot = resolve(repositoryRoot, "plugin");
const skillsRoot = resolve(pluginRoot, "skills");

const REQUIRED_SKILLS = [
  "address-review",
  "amend",
  "approve",
  "discover",
  "doctor",
  "execute",
  "init",
  "plan",
  "quick",
  "status",
  "sync-docs",
  "update",
];

const DEFERRED_SKILLS = ["add-mcp", "brainstorm", "review-plan"];
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
      !(rawValue.startsWith('"') ^ rawValue.endsWith('"')) &&
        !(rawValue.startsWith("'") ^ rawValue.endsWith("'")),
      `${name}: ${key} has an unmatched quote`,
    );
    metadata[key] = rawValue.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, (_, double, single) => double ?? single);
  }

  assert.deepEqual(
    Object.keys(metadata).sort(),
    ["description", "name"],
    `${name}: MVP skills use only the portable name and description frontmatter fields`,
  );
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
    const match = /^  ([a-z][a-z0-9_]*): "([^"\n]+)"$/.exec(line);
    assert.ok(match, `${name}: invalid agents/openai.yaml line ${index + 2}`);
    assert.ok(!Object.hasOwn(values, match[1]), `${name}: duplicate openai metadata key ${match[1]}`);
    values[match[1]] = match[2];
  }
  assert.deepEqual(
    Object.keys(values).sort(),
    ["default_prompt", "display_name", "short_description"],
    `${name}: openai interface metadata has missing or unknown keys`,
  );
  assert.ok(values.display_name.length <= 64, `${name}: display_name exceeds 64 characters`);
  assert.ok(values.short_description.length <= 80, `${name}: short_description exceeds 80 characters`);
  assert.match(values.default_prompt, new RegExp(`\\$${name}(?:\\b|\\s)`), `${name}: default_prompt must invoke its folder name`);
}

function assertContract(name, requirements) {
  const source = skillText(name);
  for (const [label, pattern] of requirements) {
    assert.match(source, pattern, `${name}: missing ${label}`);
  }
}

test("both provider manifests expose the complete MVP inventory from one physical skill tree", () => {
  const manifests = [
    readJson("plugin/.codex-plugin/plugin.json"),
    readJson("plugin/.claude-plugin/plugin.json"),
  ];
  const resolvedTrees = manifests.map((manifest) => {
    assert.equal(manifest.name, "adw");
    assert.equal(manifest.skills, "./skills/");
    return realpathSync(resolve(pluginRoot, manifest.skills));
  });

  assert.equal(resolvedTrees[0], resolvedTrees[1], "providers must not maintain copied skill trees");
  const inventory = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(inventory, REQUIRED_SKILLS);
  for (const name of inventory) {
    assert.ok(existsSync(resolve(skillsRoot, name, "SKILL.md")), `${name}: missing SKILL.md`);
  }
});

test("every skill has portable frontmatter, folder identity, and optional generated OpenAI metadata", () => {
  for (const name of REQUIRED_SKILLS) {
    const metadata = parseSkillFrontmatter(name, skillText(name));
    assert.equal(metadata.name, name, `${name}: frontmatter name must match its folder`);
    assert.equal(`adw:${metadata.name}`, `adw:${name}`, `${name}: provider namespace mismatch`);

    const openAiPath = resolve(skillsRoot, name, "agents/openai.yaml");
    if (existsSync(openAiPath)) parseOpenAiMetadata(name, readFileSync(openAiPath, "utf8"));
  }
});

test("deferred skills are absent from the executable MVP", () => {
  for (const name of DEFERRED_SKILLS) {
    assert.ok(!existsSync(resolve(skillsRoot, name)), `${name}: deferred skill must not ship yet`);
  }
});

test("skills preserve the required behavior and safety boundaries", () => {
  const contracts = {
    init: [
      ["a preview before writes", /\bpreview\b/i],
      ["explicit write confirmation", /explicit (?:approval|confirmation)|--confirmed/i],
      ["project configuration", /adw\.yaml/],
      ["ignored local state", /\.adw\//],
      ["the root docs worktree", /\/worktrees\//],
      ["both provider routing files", /AGENTS\.md[\s\S]*CLAUDE\.md|CLAUDE\.md[\s\S]*AGENTS\.md/],
      ["managed devcontainer default", /default to `managed-devcontainer`|managed `\.devcontainer\/` only when absent/i],
      ["project devcontainer preservation", /project-devcontainer[\s\S]*preserve|preserve every byte of an existing project devcontainer/i],
    ],
    update: [
      ["project artifact migration", /project artifact|workflow-schema|schema migration/i],
      ["migration preview", /\bpreview\b/i],
      ["explicit confirmation", /explicit (?:approval|authorization|confirmation)|--confirmed/i],
      ["plugin-manager ownership", /plugin manager/i],
      ["historical evidence preservation", /historical|history/i],
    ],
    doctor: [
      ["read-only operation", /read-only|without changing/i],
      ["schema compatibility", /schema/i],
      ["routing checks", /routing/i],
      ["context freshness", /fresh/i],
      ["execution isolation checks", /execution|isolation/i],
      ["optional integration checks", /optional integration/i],
    ],
    status: [
      ["read-only operation", /read-only|without modifying/i],
      ["approval reconstruction", /approval/i],
      ["validation reconstruction", /validation/i],
      ["branch state", /branch/i],
      ["draft pull requests", /draft pull request/i],
    ],
    discover: [
      ["repository analysis", /analy[sz]e|inspect/i],
      ["component context", /component/i],
      ["observable sources", /observable|verified source/i],
      ["approval before writes", /(?:write|apply)[^\n]{0,100}(?:after|only after)[^\n]{0,60}(?:approval|approved)|after approval/i],
    ],
    plan: [
      ["docs worktree", /docs worktree/i],
      ["specification artifact", /spec\.md/],
      ["plan artifact", /plan\.yaml/],
      ["sequential tasks", /sequential|ordered task/i],
      ["stop before implementation", /stop before[^\n]*implementation|never implement/i],
    ],
    approve: [
      ["explicit human confirmation", /explicit human (?:confirmation|approval|decision)|human[^\n]{0,80}(?:confirm|explicitly approve)/i],
      ["digest binding", /digest/i],
      ["docs commit binding", /docs.commit|docs commit/i],
      ["artifact validation", /validat[^\n]*(?:spec|plan|artifact)/i],
    ],
    execute: [
      ["approved commit verification", /verify[^\n]*(?:approv|docs commit)|approval digest/i],
      ["sequential execution", /sequential/i],
      ["whole-change review", /whole change|complete feature-branch diff|whole-diff/i],
      ["validation evidence", /validation\.json|validation evidence/i],
      ["required-check failure gate", /required[^\n]{0,100}(?:fail|nonzero)[^\n]{0,100}(?:stop|prevent|keeps status `failed`)/i],
      ["authorized draft PR only", /draft[^\n]*pull request[^\n]*(?:explicit|authoriz)|explicit[^\n]*(?:authoriz)[^\n]*draft/i],
    ],
    quick: [
      ["risk escalation", /escalate to `?adw:plan`?/i],
      ["one feature branch", /one feature branch|exactly one[^\n]*branch/i],
      ["whole-diff review", /whole.diff|whole diff/i],
      ["required-check failure gate", /required[^\n]{0,100}(?:failure|nonzero|failed)/i],
    ],
    amend: [
      ["approval invalidation", /invalidate[^\n]*approval|approval invalidation/i],
      ["recorded amendment reason", /amendment reason|invalidation_reason/i],
      ["preserved approval evidence", /preserv[^\n]*approval/i],
      ["mandatory reapproval", /reapproval|fresh `?adw:approve/i],
    ],
    "address-review": [
      ["feedback classification", /classify|classification/i],
      ["in-scope corrections", /in-scope correction/i],
      ["amendment routing", /adw:amend/i],
      ["retesting", /retest|regression test/i],
      ["validation evidence", /validation evidence|validation\.json/i],
    ],
    "sync-docs": [
      ["SYNC marker comparison", /SYNC\.yaml/],
      ["read-only default", /read-only|report[^\n]*default|default[^\n]*report/i],
      ["explicitly authorized fixes", /explicit (?:approval|authorization)|only after[^\n]*authoriz/i],
      ["docs-branch delivery", /docs branch|docs-branch/i],
      ["force-push prohibition", /never[^\n]{0,50}(?:force-push|force option)|no force-push|without force/i],
    ],
  };

  for (const [name, requirements] of Object.entries(contracts)) assertContract(name, requirements);
});

test("generic skills do not depend on legacy enterprise or orchestration workflows", () => {
  for (const name of REQUIRED_SKILLS) {
    const source = skillText(name);
    assert.doesNotMatch(source, /Azure DevOps|\bADO\b|Notion/i, `${name}: provider-neutral skills cannot depend on legacy enterprise systems`);

    for (const pattern of [
      /\btickets?\b/gi,
      /implementation[ -]worktrees?/gi,
      /\bphases?\b/gi,
      /parallel (?:implementation )?(?:agents?|assignments?|branches?)/gi,
      /multiple (?:implementation )?agents?/gi,
      /integration branches?/gi,
    ]) {
      for (const match of source.matchAll(pattern)) {
        const sentenceStart = Math.max(source.lastIndexOf(".", match.index - 1), source.lastIndexOf("\n", match.index - 1));
        const sentenceEndCandidates = [source.indexOf(".", match.index), source.indexOf("\n", match.index)].filter((index) => index >= 0);
        const sentenceEnd = sentenceEndCandidates.length > 0 ? Math.min(...sentenceEndCandidates) : source.length;
        const sentence = source.slice(sentenceStart + 1, sentenceEnd + 1);
        assert.match(
          sentence,
          /\b(?:never|not|no|without|remove|refuse|reject|unnecessary|do not|must not)\b/i,
          `${name}: legacy concept is an assumption rather than an explicit prohibition: ${sentence.trim()}`,
        );
      }
    }
  }
});

test("provider inventory is explicit, bounded, and backed by provider references", () => {
  const inventory = readJson("plugin/integrations/providers.json");
  assert.equal(inventory.schema, 1);
  assert.ok(Array.isArray(inventory.providers));
  assert.deepEqual(inventory.providers.map(({ provider }) => provider).sort(), ["azure-devops", "datadog", "github", "notion"]);

  const allowedCapabilities = new Set(["work_tracker", "code_host", "observability", "knowledge"]);
  const allowedTransports = new Set(["native", "mcp", "cli", "api"]);
  for (const entry of inventory.providers) {
    assert.match(entry.provider, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.ok(Array.isArray(entry.capabilities) && entry.capabilities.length > 0, `${entry.provider}: missing capabilities`);
    assert.ok(Array.isArray(entry.transports) && entry.transports.length > 0, `${entry.provider}: missing transports`);
    assert.ok(entry.capabilities.every((item) => allowedCapabilities.has(item)), `${entry.provider}: unknown capability`);
    assert.ok(entry.transports.every((item) => allowedTransports.has(item)), `${entry.provider}: unknown transport`);
    assert.match(entry.reference, /^providers\/[a-z0-9-]+\.md$/);
    const referencePath = resolve(pluginRoot, "integrations", entry.reference);
    assert.ok(existsSync(referencePath), `${entry.provider}: missing provider reference ${entry.reference}`);
    const reference = readFileSync(referencePath, "utf8");
    assert.match(reference, new RegExp(entry.provider.replace("azure-devops", "Azure DevOps"), "i"));
    for (const capability of entry.capabilities) assert.match(reference, new RegExp(`\\b${capability}\\b`), `${entry.provider}: reference omits ${capability}`);
  }
});

test("integration-aware workflow language depends on capabilities and shared contracts", () => {
  const contract = read("plugin/integrations/contracts.md");
  assert.match(contract, /capabilit/i);
  for (const capability of ["work_tracker", "code_host", "observability", "knowledge"]) {
    assert.match(contract, new RegExp(`\\b${capability}\\b`), `shared contract omits ${capability}`);
  }

  const workflows = ["plan", "approve", "execute", "amend", "doctor", "discover", "status", "quick", "address-review"];
  for (const name of workflows) {
    const source = skillText(name);
    assert.match(source, /integrations\/contracts\.md/, `${name}: missing shared integration contract`);
    assert.doesNotMatch(source, /Azure DevOps|\bADO\b|Datadog|Notion/i, `${name}: workflow must select providers from configuration, not embed one provider`);
  }

  for (const name of ["plan", "approve", "execute"]) {
    const source = skillText(name);
    assert.match(source, /integrations\.yaml/, `${name}: missing durable integration binding artifact`);
  }
  assert.match(skillText("plan"), /disabled[\s\S]*optional[\s\S]*required/, "plan: missing integration requirement handling");
});

test("every skill resolves bundled resources portably for Claude Code and Codex", () => {
  for (const name of REQUIRED_SKILLS) {
    const source = skillText(name);
    assert.match(source, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${name}: missing Claude plugin-root resolution`);
    assert.match(source, /Codex[^\n]*(?:absolute|loaded|source)|(?:absolute|loaded|source)[^\n]*Codex/i, `${name}: missing Codex loaded-source resolution`);
    assert.match(source, /plugin.root|<plugin-root>/i, `${name}: missing shared plugin-root derivation`);
    assert.match(
      source,
      /(?:rather than|never|not|without|independent(?:ly)? of)[^\n]{0,100}(?:current working directory|project working directory|project directory|the project)/i,
      `${name}: resources must not resolve relative to the target project`,
    );
    assert.doesNotMatch(source, /(?:~\/|\/Users\/|\/home\/)[^\s`]*(?:\.claude|\.codex)|\.claude\/plugins|\.codex\/plugins/i, `${name}: hard-coded provider install path`);
  }
});

test("VERSION, package, provider manifests, and marketplace catalogs stay in parity", () => {
  const version = read("VERSION").trim();
  assert.match(version, SEMVER);

  const codexCatalogEntry = readJson(".agents/plugins/marketplace.json").plugins.find(({ name }) => name === "adw");
  const claudeCatalogEntry = readJson(".claude-plugin/marketplace.json").plugins.find(({ name }) => name === "adw");
  assert.ok(codexCatalogEntry && claudeCatalogEntry, "both catalogs must contain the adw plugin");

  // Codex's generated marketplace entry intentionally delegates the release
  // version to the plugin manifest at its source path. Claude duplicates it.
  const codexCatalogManifest = JSON.parse(
    readFileSync(resolve(repositoryRoot, codexCatalogEntry.source.path, ".codex-plugin/plugin.json"), "utf8"),
  );

  const values = new Map([
    ["VERSION", version],
    ["package.json", readJson("package.json").version],
    ["Codex manifest", readJson("plugin/.codex-plugin/plugin.json").version],
    ["Claude manifest", readJson("plugin/.claude-plugin/plugin.json").version],
    ["Codex catalog-resolved manifest", codexCatalogManifest.version],
    ["Claude catalog", claudeCatalogEntry.version],
    ["managed devcontainer marker", readJson("plugin/templates/devcontainer/adw-managed.json").plugin_version],
  ]);

  for (const [location, candidate] of values) {
    assert.equal(candidate, version, `${location} version must equal ${version}`);
  }
});

test("marketplaces resolve both providers to the same plugin root", () => {
  const codexEntry = readJson(".agents/plugins/marketplace.json").plugins.find(({ name }) => name === "adw");
  const claudeEntry = readJson(".claude-plugin/marketplace.json").plugins.find(({ name }) => name === "adw");
  assert.ok(codexEntry && claudeEntry, "both marketplaces must list adw");

  const codexRoot = realpathSync(resolve(repositoryRoot, codexEntry.source.path));
  const claudeRoot = realpathSync(resolve(repositoryRoot, claudeEntry.source));
  assert.equal(codexRoot, realpathSync(pluginRoot));
  assert.equal(claudeRoot, codexRoot);
  assert.equal(relative(repositoryRoot, codexRoot), "plugin");
});
