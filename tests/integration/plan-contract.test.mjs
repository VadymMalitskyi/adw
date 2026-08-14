import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { computeDigest, dispatch, EXIT } from "../../plugin/lib/adw-helper.mjs";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, "../..");

function readSkill(name) {
  return readFileSync(resolve(repositoryRoot, `plugin/skills/${name}/SKILL.md`), "utf8");
}

const templatePath = resolve(repositoryRoot, "plugin/templates/plan.md");
const template = readFileSync(templatePath, "utf8");

// The canonical plan is structured Markdown, so its contract is the heading
// sequence. Extract headings the way a coordinating agent must: ignoring HTML
// comment guidance and fenced examples.
function planHeadings(source) {
  const headings = [];
  let inComment = false;
  let fence = null;
  for (const line of source.split("\n")) {
    if (fence === null) {
      const opening = /^\s*(```+|~~~+)/.exec(line);
      if (opening) {
        fence = opening[1][0];
        continue;
      }
    } else {
      if (new RegExp(`^\\s*${fence === "`" ? "```" : "~~~"}+\\s*$`).test(line)) fence = null;
      continue;
    }
    if (inComment) {
      if (line.includes("-->")) inComment = false;
      continue;
    }
    if (line.includes("<!--")) {
      if (!line.includes("-->")) inComment = true;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
    if (heading) headings.push({ level: heading[1].length, text: heading[2] });
  }
  return headings;
}

// The mandatory sequence. `Phase` and `Group` headings repeat, so they are
// matched by shape rather than by literal text.
const MANDATORY = [
  { level: 1, match: /^PART 1 . Feature Overview$/ },
  { level: 2, match: /^Summary$/ },
  { level: 2, match: /^Design & Architecture$/ },
  { level: 2, match: /^Key Decisions & Trade-offs$/ },
  { level: 2, match: /^Risks and Open Questions$/ },
  { level: 2, match: /^Acceptance Criteria$/ },
  { level: 1, match: /^PART 2 . Implementation Plan$/ },
  { level: 2, match: /^Plan at a glance$/ },
  { level: 2, match: /^Affected Components$/ },
  { level: 2, match: /^Context and Anchors$/ },
  { level: 2, match: /^Phase 1 . \S/, repeatable: false },
  { level: 3, match: /^Group: [a-z0-9]+(?:-[a-z0-9]+)*$/, repeatable: true },
  { level: 2, match: /^Phase 2 . \S/ },
  { level: 3, match: /^Group: [a-z0-9]+(?:-[a-z0-9]+)*$/, repeatable: true },
  { level: 2, match: /^Whole-feature validation$/ },
  { level: 2, match: /^Notes$/ },
];

// Real structural verification: walk the required sequence against the actual
// headings and report the first requirement the document fails to satisfy.
function checkPlanStructure(source) {
  const headings = planHeadings(source);
  let cursor = 0;
  for (const requirement of MANDATORY) {
    let matched = false;
    while (cursor < headings.length) {
      const candidate = headings[cursor];
      if (candidate.level === requirement.level && requirement.match.test(candidate.text)) {
        matched = true;
        cursor += 1;
        if (requirement.repeatable) {
          while (
            cursor < headings.length &&
            headings[cursor].level === requirement.level &&
            requirement.match.test(headings[cursor].text)
          ) cursor += 1;
        }
        break;
      }
      if (candidate.level <= requirement.level) break;
      cursor += 1;
    }
    if (!matched) return { ok: false, missing: requirement.match.source };
  }
  return { ok: true, missing: null };
}

test("the bundled plan template carries every mandatory heading in order", () => {
  const result = checkPlanStructure(template);
  assert.equal(result.missing, null);
  assert.equal(result.ok, true);

  const headings = planHeadings(template);
  assert.equal(headings.filter(({ level }) => level === 1).length, 2, "exactly two parts");
  assert.ok(
    headings.filter(({ level, text }) => level === 3 && text.startsWith("Group: ")).length >= 3,
    "the template must demonstrate more than one group per plan",
  );
});

test("the structural check actually fails on a plan that drops or reorders a mandatory section", () => {
  const withoutCriteria = template.replace("## Acceptance Criteria\n", "");
  assert.equal(checkPlanStructure(withoutCriteria).ok, false);
  assert.match(checkPlanStructure(withoutCriteria).missing, /Acceptance Criteria/);

  const withoutNotes = template.replace(/\n## Notes\n/, "\n");
  assert.equal(checkPlanStructure(withoutNotes).ok, false);

  const partsSwapped = [
    template.slice(template.indexOf("# PART 2")),
    template.slice(0, template.indexOf("# PART 2")),
  ].join("\n");
  assert.equal(checkPlanStructure(partsSwapped).ok, false);

  const groupsBeforePhases = template.replace(/^## Context and Anchors$/m, "## Later");
  assert.equal(checkPlanStructure(groupsBeforePhases).ok, false);
});

test("the template demonstrates the glance table, anchor style, and directive task block", () => {
  const header = /\|\s*Phase\s*\|\s*Group\s*\|\s*Component\s*\|\s*Primary paths\s*\|\s*Depends on\s*\|\s*Tracker\s*\|\s*Delivery\s*\|/;
  assert.match(template, header, "glance table must expose the seven canonical columns");

  const glanceRows = template
    .split("\n")
    .filter((line) => /^\|\s*\d+\s*\|/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()));
  assert.ok(glanceRows.length >= 3, "the template must show a worked multi-phase glance table");
  for (const row of glanceRows) {
    assert.equal(row.length, 7, `glance row must have seven cells: ${row.join(" | ")}`);
    assert.match(row[0], /^\d+$/, "phase column is a phase number");
    assert.match(row[1], /^`[a-z0-9]+(?:-[a-z0-9]+)*`$/, "group ids are stable and lowercase");
    assert.match(row[6], /group PR|integration PR/, "delivery intent is explicit");
  }

  // Groups sharing a phase must be demonstrably path-disjoint in the template.
  const byPhase = new Map();
  for (const row of glanceRows) {
    if (!byPhase.has(row[0])) byPhase.set(row[0], []);
    byPhase.get(row[0]).push(row[3].replaceAll("`", ""));
  }
  for (const [phase, paths] of byPhase) {
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        assert.ok(
          !paths[i].startsWith(paths[j]) && !paths[j].startsWith(paths[i]),
          `phase ${phase}: concurrent groups must not share write paths`,
        );
      }
    }
  }

  const anchors = template.split("\n").filter((line) => /\S+\.[a-z]+ -> /.test(line));
  assert.ok(anchors.length >= 3, "the template must demonstrate file -> symbol anchors");
  for (const anchor of anchors) {
    assert.doesNotMatch(anchor, /\.[a-z]+:\d+/, `anchors must not use line numbers: ${anchor}`);
  }

  for (const keyword of ["IMPLEMENT", "CONTRACT", "PATTERN", "GOTCHA", "DONE WHEN", "VALIDATE"]) {
    assert.match(template, new RegExp(`\\*\\*${keyword}:\\*\\*`), `template omits the ${keyword} directive`);
  }

  assert.match(template, /## Whole-feature validation/);
  assert.match(template, /immutable after approval/i);
  assert.match(template, /adw:amend/);
});

test("the template is stable, digestible bytes the approval contract can bind", async () => {
  const bytes = readFileSync(templatePath);
  const digested = await dispatch("digest", { content: bytes.toString("utf8") });
  assert.equal(digested.exitCode, EXIT.OK);
  assert.equal(digested.body.digest, computeDigest(bytes));
  assert.match(digested.body.digest, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(template, /\r/, "the canonical template must not carry CRLF bytes");
});

test("plan skill produces one canonical plan.md and stops before approval or implementation", () => {
  const skill = readSkill("plan");

  assert.match(skill, /changes\/<change-id>\/plan\.md/);
  assert.match(skill, /templates\/plan\.md/);
  assert.match(skill, /PART 1[\s\S]*PART 2/);
  assert.match(skill, /load-project/);
  assert.match(skill, /Never implement a task/);
  assert.match(skill, /Never create or switch a code branch/);
  assert.match(skill, /Do not create `approval\.json`/);
  assert.match(skill, /Stop and invite `adw:approve`/);
  assert.match(skill, /never modify application code/i);
});

test("plan skill restores phases, groups, anchors, directives, and validation sourcing", () => {
  const skill = readSkill("plan");

  assert.match(skill, /\^\[a-z0-9\]/);
  assert.match(skill, /Plan at a glance/);
  assert.match(skill, /`Phase`, `Group`, `Component`, `Primary paths`, `Depends on`, `Tracker`, `Delivery`/);
  assert.match(skill, /stable lowercase id/i);
  assert.match(skill, /file -> symbol/);
  assert.match(skill, /never line numbers/i);
  assert.match(skill, /IMPLEMENT[\s\S]{0,200}CONTRACT[\s\S]{0,200}PATTERN[\s\S]{0,200}GOTCHA[\s\S]{0,200}DONE WHEN[\s\S]{0,200}VALIDATE/);
  assert.match(skill, /max_parallel/);
  assert.match(skill, /exact, non-interactive, and derived from an observable manifest, task runner, CI workflow, or authoritative project documentation/);
  assert.match(skill, /Do not invent a command/);
  assert.match(skill, /group pull requests by default, or one integration pull request/);
  assert.match(skill, /`Notes`/);
  assert.match(skill, /runs\//);
});

test("plan skill makes independent review its default final step", () => {
  const skill = readSkill("plan");

  assert.match(skill, /adw:review-plan/);
  assert.match(skill, /default final step/i);
  assert.match(skill, /fresh subagent/i);
  assert.match(skill, /Do not pass the planning conversation/);
  assert.match(skill, /ship-ready/);
  assert.match(skill, /revise-recommended/);
  assert.match(skill, /needs-rework/);
  assert.match(skill, /open decision/i);
  assert.doesNotMatch(skill, /\b(?:GPT|Sonnet|Opus|Haiku|o[34]-mini)\b/i, "skills must not name model products");
});

test("plan skill keeps tracker writes separately authorized and reads bounded", () => {
  const skill = readSkill("plan");

  assert.match(skill, /integrations\/contracts\.md/);
  assert.match(skill, /Tracker reads may inform planning/);
  assert.match(skill, /fresh exact authorization/);
  assert.match(skill, /never implied by running this skill/);
  assert.match(skill, /do not probe external systems/i);
  assert.doesNotMatch(skill, /Azure DevOps|\bADO\b|Datadog|Notion/i);
});

test("planning-lifecycle skills resolve bundled resources portably and drop the 0.6 artifact vocabulary", () => {
  for (const name of ["plan", "review-plan", "approve", "amend"]) {
    const skill = readSkill(name);

    assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/, `${name}: missing Claude plugin-root resolution`);
    assert.match(skill, /absolute source location advertised for this loaded `SKILL\.md`/, `${name}: missing Codex resolution`);
    assert.match(skill, /<plugin-root>/, `${name}: missing shared plugin-root derivation`);
    assert.match(
      skill,
      /never resolve from the project directory or the current working directory/,
      `${name}: resources must not resolve from the project`,
    );
    assert.match(skill, /lib\/adw-helper\.mjs/, `${name}: missing bundled helper reference`);

    for (const forbidden of [
      /spec\.md/i,
      /plan\.yaml/i,
      /integrations\.yaml/i,
      /\bschemas?\b/i,
      /effective[ _-]polic/i,
      /payload profile/i,
      /work-item profile/i,
      /external-events/i,
      /digest-bundle/i,
      /validateArtifact/i,
      /load-artifact-file/i,
      /resolve-project-policy/i,
      /validation\.json/i,
    ]) {
      assert.doesNotMatch(skill, forbidden, `${name}: retired 0.6 concept ${forbidden}`);
    }
  }
});
