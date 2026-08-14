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
  "investigate",
  "onboard",
  "plan",
  "quick",
  "review-plan",
  "status",
  "sync-docs",
  "update",
];

const DEFERRED_SKILLS = ["add-mcp", "brainstorm"];
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
      ["provider sandbox default", /default[^\n]{0,80}`?provider-sandbox`?|`?provider-sandbox`?[^\n]{0,80}default/i],
      ["managed devcontainer opt-in", /managed-devcontainer[^\n]{0,120}(?:opt.in|explicit)|(?:opt.in|explicit)[^\n]{0,120}managed-devcontainer/i],
      ["project devcontainer preservation", /project-devcontainer[\s\S]*preserve|preserve every byte of an existing project devcontainer/i],
    ],
    onboard: [
      ["initialized-project boundary", /already initialized|adw\.yaml is absent/i],
      ["personal ignored state", /\.adw\/local\.yaml/],
      ["existing docs branch attachment", /attach[^\n]*existing|already existing configured docs branch/i],
      ["digest-bound preview", /preview digest|preview_digest/i],
      ["explicit confirmation", /explicit confirmation/i],
      ["doctor readiness check", /doctor\/SKILL\.md|adw:doctor/i],
      ["status orientation", /status\/SKILL\.md|adw:status/i],
      ["shared-policy preservation", /never rerun project initialization|never initialize or reconfigure/i],
    ],
    update: [
      ["installed-contract validation", /artifact validator|project validation/i],
      ["digest-bound managed repair", /preview digest|--preview-digest/i],
      ["plugin-manager ownership", /plugin manager/i],
      ["never repairs project configuration", /never (?:translates|rewrites)[^\n]{0,80}(?:project )?configuration|never rewrites `adw\.yaml`/i],
    ],
    doctor: [
      ["read-only operation", /read-only|without changing/i],
      ["project contract check", /`adw: 1`|project contract/i],
      ["unreadable contract reported without mutation", /cannot be read[\s\S]{0,300}Change nothing/i],
      ["routing checks", /routing/i],
      ["context freshness", /fresh/i],
      ["execution isolation checks", /execution|isolation/i],
      ["optional capability checks", /optional capabilit/i],
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
      ["the one canonical plan artifact", /plan\.md/],
      ["phases and groups", /phase[\s\S]*group/i],
      ["independent plan review", /adw:review-plan|review-plan/i],
      ["stop before implementation", /stop before[^\n]*implementation|never implement/i],
    ],
    "review-plan": [
      ["cold read without the planning conversation", /cold(?:ly)?[^\n]{0,40}read|(?:do not|never|without)[^\n]{0,80}(?:conversation|prior chat|chat history)/i],
      ["anchor verification against live code", /anchor[\s\S]{0,200}live code|live code[\s\S]{0,200}anchor/i],
      ["parallel overlap detection", /overlap/i],
      ["three verdicts", /ship-ready[\s\S]*revise-recommended[\s\S]*needs-rework/],
      ["blocking verdict", /needs-rework[^\n]{0,120}(?:block|prevent)/i],
      ["read-only when standalone", /never modif|read-only/i],
    ],
    approve: [
      ["explicit human confirmation", /explicit human (?:confirmation|approval|decision)|human[^\n]{0,80}(?:confirm|explicitly approve)/i],
      ["exact plan bytes", /exact[^\n]{0,60}(?:bytes|plan\.md)|plan bytes/i],
      ["docs commit binding", /plan_commit|docs commit/i],
      ["no human digest transcription", /(?:never|not)[^\n]{0,80}(?:copy|transcribe|read)[^\n]{0,40}digest|digest[^\n]{0,60}(?:never|not)[^\n]{0,40}(?:shown|copied)/i],
    ],
    execute: [
      ["approval verification", /verify[^\n]*(?:approv|plan bytes)|verify-approval/i],
      ["phase and group coordination", /phase[\s\S]*group/i],
      ["independent review of every group", /independent review/i],
      ["run-record evidence", /run record|runs\/</i],
      ["required-check failure gate", /required[^\n]{0,120}(?:fail|nonzero)[^\n]{0,120}(?:stop|prevent|failed)/i],
      ["draft pull requests only", /draft[^\n]*pull request/i],
      ["delivery needs separate fresh authorization", /(?:separate|fresh)[^\n]{0,120}authoriz/i],
      ["never merges", /never[^\n]{0,80}merge/i],
    ],
    investigate: [
      ["read-only operation", /read-only/i],
      ["bounded observability queries", /scope every query[\s\S]*service and environment/i],
      ["deployed revision verification", /never assume the local checkout is the deployed version/i],
      ["severity and confidence", /severity[\s\S]*confidence/i],
      ["concise report sections", /severity and confidence[\s\S]{0,400}unknowns/i],
      ["handwritten machine-output consistency rules", /unique[\s\S]{0,120}evidence id|evidence id[\s\S]{0,120}unique/i],
      ["no remediation mutation", /do not execute them/i],
      ["safe implementation routing", /adw:quick[\s\S]*adw:plan/i],
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
      ["validation evidence", /validation evidence|run record/i],
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

test("skills use only the current artifact vocabulary and no digest ceremony", () => {
  // Phases, parallel groups, and isolated group worktrees are core vocabulary.
  // What must never appear is schema-versioned configuration, split planning
  // artifacts, digest ceremony, or a provider name leaking into a workflow.
  const forbidden = [
    /\bspec\.md\b/,
    /\bplan\.yaml\b/,
    /\bintegrations\.yaml\b/,
    /\bvalidation\.json\b/,
    /\bexternal-events\b/,
    /\bwork-item-profile\b/,
    /\beffective_policy\b/,
    /\bproject_policy_digest\b/,
    /\bprofile_digest\b/,
    /\brequirements_digest\b/,
    /\bauthorization_digest\b/,
    /\bvalidateArtifact\b/,
    /\bload-artifact-file\b/,
    /\bresolve-project-policy\b/,
    /\bdigest-bundle\b/,
    /\bapproval bundle\b/i,
    /\bplugin\/schemas\b/,
    /\bschema:?\s*5\b/,
  ];
  for (const name of REQUIRED_SKILLS) {
    const source = skillText(name);
    assert.doesNotMatch(source, /Azure DevOps|\bADO\b|Notion|Datadog/i, `${name}: provider-neutral skills cannot embed one provider`);
    for (const pattern of forbidden) {
      assert.doesNotMatch(source, pattern, `${name}: unsupported artifact or digest machinery is referenced: ${pattern.source}`);
    }
  }
});

test("every skill preserves the invariants ADW never trades away", () => {
  for (const name of REQUIRED_SKILLS) {
    const source = skillText(name);
    // ADW may describe merging and force-pushing only to forbid them, or to
    // name a precondition a human satisfies outside ADW.
    for (const match of source.matchAll(/\b(?:merges?|merging|merged|force-pushe?s?|force push(?:es)?|force-pushing)\b/gi)) {
      const start = Math.max(source.lastIndexOf(".", match.index - 1), source.lastIndexOf("\n", match.index - 1));
      const ends = [source.indexOf(".", match.index), source.indexOf("\n", match.index)].filter((index) => index >= 0);
      const sentence = source.slice(start + 1, ends.length > 0 ? Math.min(...ends) + 1 : source.length);
      assert.match(
        sentence,
        /\b(?:never|not|no|without|refuse|reject|prohibit|do not|must not|stop|wait|waits|human|before|after|until|merged|escalate)\b/i,
        `${name}: a merge or force-push mention must be a prohibition or a human-owned precondition: ${sentence.trim()}`,
      );
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
  assert.ok(new Set(inventory.providers.map(({ transports }) => transports.join(","))).size > 1, "provider transport declarations must discriminate real adapter support");
  assert.deepEqual(inventory.providers.find(({ provider }) => provider === "azure-devops").capabilities, ["code_host", "work_tracker"]);
});

test("integration-aware workflow language depends on capabilities and shared contracts", () => {
  const contract = read("plugin/integrations/contracts.md");
  assert.match(contract, /capabilit/i);
  for (const capability of ["work_tracker", "code_host", "observability", "knowledge"]) {
    assert.match(contract, new RegExp(`\\b${capability}\\b`), `shared contract omits ${capability}`);
  }

  for (const operation of ["read", "create", "update", "link"]) {
    assert.match(contract, new RegExp(`\`${operation}\``), `shared contract omits the ${operation} operation`);
  }
  assert.match(contract, /idempotency/i, "shared contract omits idempotency");
  assert.match(contract, /fresh[^\n]{0,60}authoriz/i, "shared contract omits fresh authorization");
  assert.doesNotMatch(contract, /authorization_digest|external-events|requirements_digest/, "1.0 drops authorization digests and receipt artifacts");

  const workflows = ["plan", "review-plan", "approve", "execute", "amend", "doctor", "discover", "status", "quick", "address-review", "investigate", "onboard"];
  for (const name of workflows) {
    const source = skillText(name);
    assert.match(source, /integrations\/contracts\.md/, `${name}: missing shared integration contract`);
    assert.doesNotMatch(source, /Azure DevOps|\bADO\b|Datadog|Notion/i, `${name}: workflow must select providers from configuration, not embed one provider`);
  }

  // Tracker and delivery intent live in the plan; results live in run records.
  assert.match(skillText("plan"), /tracker intent|tracker[\s\S]{0,80}intent/i, "plan: missing tracker intent");
  assert.match(skillText("plan"), /delivery/i, "plan: missing delivery intent");
  assert.match(skillText("execute"), /run record|runs\//i, "execute: provider outcomes belong in run records");
  assert.match(skillText("plan"), /required:? (?:false|true)|required/i, "plan: missing provider availability handling");
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
