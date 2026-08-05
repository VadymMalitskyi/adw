# ADW Private Plugin — Implementation Plan

**Status:** Implemented locally; provider installation acceptance pending
**Prepared:** 2026-08-05
**Target:** Personal/private first, organization-private later

## 1. Outcome

Build ADW as one private, versioned plugin repository that works with Codex and Claude Code.

The plugin supplies the workflow skills. A project that uses ADW stores only project-specific configuration, concise context, specifications, approvals, and validation evidence.

```text
private ADW repository
    ├── Codex plugin installation
    └── Claude Code plugin installation
                 |
                 | ADW skills read and write
                 v
       project code branch + docs branch
```

There will be no public `adw` executable, no vendored copy of the skills in each project, no workflow server, and no workflow database.

## 2. Decisions fixed by this plan

1. **Distribution unit:** one Git repository containing both plugin manifests and one shared skill tree.
2. **Visibility:** private personal marketplace first; private organization repository and workspace sharing later.
3. **User interface:** namespaced skills such as `adw:init`, `adw:plan`, `adw:approve`, and `adw:execute`.
4. **Project configuration:** committed root-level `adw.yaml`; machine-local values in ignored `.adw/local.yaml`.
5. **Documentation:** code-coupled documentation remains on the code branch; ADW context and change records live on a separate `docs` branch.
6. **Docs checkout:** the `docs` branch is checked out at root-level `worktrees/docs`; `/worktrees/` is Git-ignored.
7. **Updates:** provider plugin managers distribute skill changes; `adw:update` migrates project artifacts only when their schema changes.
8. **Execution environment:** use the agent's existing sandbox by default. Devcontainer support is optional and never installed automatically.
9. **Delivery:** one branch and one draft GitHub pull request; ADW never merges or deploys.
10. **Runtime:** Node.js 20+ for internal helpers in the MVP. Helpers are invoked by skills and are not a user-facing command API.
11. **Canonical source:** shared skills and contracts are maintained once. Provider-specific files contain packaging only.

## 3. Target repository structure

```text
adw/
├── plugin/
│   ├── .codex-plugin/
│   │   └── plugin.json
│   ├── .claude-plugin/
│   │   └── plugin.json
│   ├── skills/
│   │   ├── init/SKILL.md
│   │   ├── update/SKILL.md
│   │   ├── doctor/SKILL.md
│   │   ├── status/SKILL.md
│   │   ├── discover/SKILL.md
│   │   ├── brainstorm/SKILL.md
│   │   ├── plan/SKILL.md
│   │   ├── review-plan/SKILL.md
│   │   ├── approve/SKILL.md
│   │   ├── execute/SKILL.md
│   │   ├── quick/SKILL.md
│   │   ├── amend/SKILL.md
│   │   ├── address-review/SKILL.md
│   │   ├── sync-docs/SKILL.md
│   │   └── add-mcp/SKILL.md
│   ├── schemas/
│   ├── templates/
│   └── lib/
│       └── adw-helper.mjs
│
├── .claude-plugin/
│   └── marketplace.json
├── .agents/
│   └── plugins/
│       └── marketplace.json
│
├── src/
│   └── helpers/
│       ├── schemas.ts
│       ├── approval.ts
│       ├── validation.ts
│       ├── project-version.ts
│       └── migration.ts
│
├── tests/
│   ├── contracts/
│   ├── helpers/
│   ├── integration/
│   └── fixtures/
│       ├── empty-repo/
│       ├── existing-project/
│       └── monorepo/
│
├── docs/
│   ├── architecture.md
│   ├── workflow.md
│   ├── artifacts.md
│   ├── private-installation.md
│   ├── updating.md
│   └── security.md
│
├── package.json
├── CHANGELOG.md
├── VERSION
├── README.md
├── PRD.md
└── IMPLEMENTATION_PLAN.md
```

The former `targeting-batch/` and `adw/` reference fixtures were intentionally removed after their relevant lessons had been incorporated into this plan. They are not part of the product.

## 4. Target structure inside an initialized project

### Code branch checkout

```text
project/
├── AGENTS.md                         # Existing file plus a small ADW block
├── CLAUDE.md                         # Existing file plus a small ADW block
├── adw.yaml                          # Shared ADW project configuration
├── README.md                         # Existing project documentation
├── docs/                             # Existing code-coupled project docs
├── .adw/                             # Git-ignored local state
│   ├── local.yaml
│   └── cache/
├── worktrees/                        # Git-ignored root-level worktrees
│   └── docs/                         # Checkout of the docs branch
└── application code
```

### Contents of the `docs` branch

```text
README.md
architecture.md
components/
  <component>.md
changes/
  <change-id>/
    spec.md
    plan.yaml
    approval.json
    validation.json
SYNC.yaml
```

The project does **not** receive:

- ADW skill implementations.
- Plugin manifests.
- ADW helper programs.
- A devcontainer unless the project already owns one and the user requests changes.
- Corporate ticketing, Notion, Azure DevOps, or Datadog configuration.

## 5. Artifact contracts

### `adw.yaml`

Contains shared project facts:

```yaml
schema: 1

git:
  default_branch: main

documentation:
  mode: branch
  branch: docs
  worktree: worktrees/docs
  sync_marker: SYNC.yaml
  delivery: direct-push

components:
  backend:
    path: services/backend

validation:
  default:
    - npm run lint
    - npm test
    - npm run build
```

The exact schema will support multiple commands per stage and component-specific overrides. Detected commands must have an observable source such as a manifest, task runner, CI workflow, or existing documentation.

### `architecture.md` and `components/` on the docs branch

Contains a concise project map for agents:

- Purpose and component boundaries.
- Important entry points.
- Verified commands.
- Conventions and protected areas.
- Links to authoritative `README.md` or `docs/` pages.

It must not duplicate detailed project documentation.

### `changes/<change-id>/` on the docs branch

- `spec.md`: outcome, behavior, scope, exclusions, decisions, risks, acceptance criteria, and documentation impact.
- `plan.yaml`: sequential tasks, affected areas, anchors, restrictions, and exact validation commands.
- `approval.json`: approver, timestamp, schema version, plugin version, and digest of `spec.md` plus `plan.yaml`.
- `validation.json`: exact commands, exit codes, durations, summaries, and explicitly deferred checks.

### `SYNC.yaml` on the docs branch

Records the last code revision reviewed by documentation synchronization:

```yaml
code_branch: main
reviewed_through: 7d912ab
updated_at: 2026-08-05T14:30:00Z
```

## 6. Skill contracts for the MVP

### Core path

| Skill | Contract |
|---|---|
| `adw:init` | Inspect the project, preview changes, create `adw.yaml`, ignore `/worktrees/` and `.adw/`, create or attach the `docs` branch at `worktrees/docs`, and add small managed blocks to `AGENTS.md`/`CLAUDE.md`. Never install a devcontainer automatically. |
| `adw:doctor` | Read-only check of plugin compatibility, project schema, ignored local files, routing blocks, context freshness, and optional integrations. |
| `adw:status` | Read-only reconstruction of active changes, approval state, branches, validation, and draft PRs. |
| `adw:discover` | Analyze repository structure and propose project/component context; write only after approval. |
| `adw:plan` | Pull the docs worktree, explore relevant code, create `spec.md` and `plan.yaml` on the docs branch, and stop before implementation. |
| `adw:approve` | Validate and summarize the current spec/plan, request explicit human confirmation, then record their digest and docs commit SHA on the docs branch. |
| `adw:execute` | Verify the approved docs commit, implement sequentially, review the diff, update code-coupled docs, record validation on the docs branch, and prepare a draft PR when authorized. |
| `adw:quick` | Use a reduced contract for a small local change; escalate to `adw:plan` when risk or scope grows. |
| `adw:amend` | Update an approved spec/plan, explain the change, and invalidate approval. |
| `adw:address-review` | Apply in-scope review corrections; route behavior/design changes through `adw:amend`. |
| `adw:sync-docs` | Compare code changes since `SYNC.yaml`, report drift by default, and update the docs branch by direct push only after explicit authorization. |
| `adw:update` | Preview and apply project artifact migrations required by the installed plugin. Never update the plugin itself. |

### Deferred from the first executable slice

- `adw:brainstorm`
- `adw:review-plan`
- `adw:add-mcp`

Their directories may be added only after the core plan/approve/execute loop passes end-to-end acceptance.

## 7. Documentation lifecycle

ADW recognizes three documentation layers:

1. **Authoritative project docs:** `README.md`, `docs/`, ADRs, API docs, runbooks. These remain project-owned.
2. **Agent context on the docs branch:** `architecture.md` and `components/`. This is a short map that links to authoritative docs.
3. **Change records on the docs branch:** `changes/<change-id>/`. These preserve intent, approval, and validation.

Every specification includes:

```yaml
documentation:
  impact: none | update | new
  files: []
```

`adw:execute` must update code-coupled documentation in the same branch and pull request as the code. Architecture and component context are reconciled on the docs branch. If implementation reveals an undeclared public or architectural documentation impact, execution stops for amendment.

`adw:sync-docs` is a maintenance audit, not an automatic generator. It compares code changes since `SYNC.yaml` with manifests, CI, change records, and existing context; reports drift; and proposes a docs-branch diff. In direct-push mode it commits and pushes only after explicit authorization, never force-pushes, and stops on non-fast-forward updates or ambiguous changes.

Completed change records remain under `changes/` on the docs branch. Git history is not the only way to discover accepted intent.

## 8. Private installation and update model

### Personal development

1. Keep the ADW repository private.
2. Register its Codex marketplace as a personal source.
3. Register its Claude marketplace at user scope.
4. Install the `adw` plugin in both providers.
5. Invoke `adw:init` inside each target project.

### Organization distribution

1. Transfer or mirror the repository into a private organization repository.
2. Give the intended group read access.
3. Share the Codex plugin with selected workspace users/groups or expose the private repository marketplace.
4. Configure Claude's private marketplace through project or managed settings.
5. Optionally restrict Claude to approved marketplaces.

### Release and update behavior

1. Tag ADW releases using semantic versioning.
2. Publish the same version in both marketplace manifests.
3. Update plugin code through Codex/Claude plugin management.
4. Record the workflow schema in root-level `adw.yaml`.
5. Record the actual plugin version in each `approval.json` and `validation.json`.
6. For a compatible plugin update, modify no project files.
7. For a workflow-schema update, `adw:update` previews a project migration and applies it only after confirmation.
8. Never rewrite historical specifications, approvals, or validation evidence during migration.

## 9. Implementation work packages

### WP0 — Align the product contract

**Owner:** primary agent
**Depends on:** plan approval
**Files:** `PRD.md`, `IMPLEMENTATION_PLAN.md`

Work:

- Change the PRD from “repository-installed skill pack” to “privately installed provider plugin plus repository artifacts.”
- Remove skill vendoring, managed-file hashes inside projects, mandatory devcontainer generation, and source-bundle language.
- Add private personal/org marketplace distribution.
- Restore the separate `docs` branch for ADW context and change records, using root-level ignored `worktrees/docs` locally.
- Make devcontainers optional and describe the agent sandbox as the default boundary.
- Align skill names to the `adw:<skill>` namespace.

Acceptance:

- PRD and implementation plan describe the same installation, project structure, update flow, and documentation lifecycle.
- No section implies that a project contains ADW skill code or a user-facing CLI.

### WP1 — Prove dual-provider packaging

**Owner:** packaging agent
**Depends on:** WP0
**Exclusive paths:** `plugin/.codex-plugin/`, `plugin/.claude-plugin/`, `.claude-plugin/`, `.agents/`, `tests/contracts/plugin-*`

Work:

- Create minimal Codex and Claude plugin manifests.
- Create private/local marketplace manifests pointing at the same plugin root.
- Add one temporary `adw:doctor` smoke skill.
- Verify discovery, namespace, resource paths, reload behavior, and version display in both providers.
- Determine and document the portable way each skill references bundled helper files.

Acceptance:

- Both providers load the same smoke skill as `adw:doctor`.
- Neither provider requires skill files to be copied into a target project.
- Both private marketplace paths can update to a newer local/tagged version.
- Any provider incompatibility is documented before broader skill implementation.

### WP2 — Define schemas, templates, and internal helpers

**Owner:** artifacts agent
**Depends on:** WP0; may run parallel with WP1
**Exclusive paths:** `src/helpers/`, `plugin/schemas/`, `plugin/templates/`, `plugin/lib/`, `tests/helpers/`

Work:

- Define versioned schemas for project, plan, approval, and validation artifacts.
- Add templates for config, context, spec, and plan.
- Implement deterministic digest, schema validation, validation-result recording, compatibility checks, and migration primitives.
- Bundle runtime dependencies into one checked-in `plugin/lib/adw-helper.mjs`.
- Give helpers structured JSON input/output and stable exit codes for skill use, without advertising them as a public CLI.

Acceptance:

- Valid fixtures pass and invalid fixtures fail with actionable messages.
- Any spec or plan content change invalidates the recorded approval digest.
- Failed process exit codes are preserved as failures in validation evidence.
- Helpers do not read or write outside explicitly supplied project paths.

### WP3 — Build initialization and read-only skills

**Owner:** foundation-skills agent
**Depends on:** WP1 resource-path result and WP2 artifact contracts
**Exclusive paths:** `plugin/skills/init/`, `plugin/skills/doctor/`, `plugin/skills/status/`, `plugin/skills/discover/`, `tests/integration/init-*`, `tests/integration/status-*`

Work:

- Implement `init`, `doctor`, `status`, and `discover` skills.
- Preserve existing `AGENTS.md`, `CLAUDE.md`, `.gitignore`, documentation, and devcontainer files.
- Add or update only bounded ADW routing blocks.
- Ensure `.adw/` and root-level `/worktrees/` are ignored before creating local state.
- Create or attach the `docs` branch and its `worktrees/docs` checkout without disturbing the code checkout.
- Derive commands from observable repository sources and mark unresolved values.

Acceptance:

- Re-running `init` produces no duplicate blocks or unrelated changes.
- Existing instructions survive byte-for-byte outside managed blocks.
- `doctor` and `status` are read-only.
- Re-running init reuses the existing docs worktree and never duplicates `/worktrees/` ignore rules.
- Init never creates or edits `.devcontainer/` without a separate explicit request.

### WP4 — Build plan, approval, and amendment skills

**Owner:** planning-skills agent
**Depends on:** WP2
**Exclusive paths:** `plugin/skills/plan/`, `plugin/skills/approve/`, `plugin/skills/amend/`, `tests/integration/plan-*`, `tests/integration/approval-*`

Work:

- Implement repository-grounded planning and the sequential plan format.
- Add documentation-impact declaration.
- Implement approval confirmation and digest recording.
- Implement amendment and approval invalidation.
- Remove all assumptions about Azure DevOps, Notion, execution phases, implementation worktrees, and multiple implementation agents. Retain only the dedicated `worktrees/docs` checkout.

Acceptance:

- Planning creates no feature code, branch, ticket, or PR.
- Approval cannot be created without valid artifacts and explicit user confirmation.
- Editing either approved file blocks execution until reapproval.
- Amendment preserves the reason for the change.

### WP5 — Build execution and delivery skills

**Owner:** execution-skills agent
**Depends on:** WP2 and WP4
**Exclusive paths:** `plugin/skills/execute/`, `plugin/skills/quick/`, `plugin/skills/address-review/`, `tests/integration/execute-*`, `tests/integration/quick-*`

Work:

- Implement one-branch, one-agent, sequential execution.
- Add preflight for approval, working tree, base branch, paths, and commands.
- Require task-level tests and whole-change review.
- Run configured project commands and record evidence through the helper.
- Update code-coupled documentation in the feature branch and record validation evidence on the docs branch.
- Prepare one draft GitHub PR when explicitly authorized.
- Add quick-mode escalation rules and review-feedback classification.

Acceptance:

- Execution refuses a stale or missing approval.
- A failing required check prevents completion and successful PR status.
- Scope-changing discoveries stop for amendment.
- No path can merge, release, deploy, or silently defer a required check.

### WP6 — Build documentation maintenance and project migration

**Owner:** maintenance-skills agent
**Depends on:** WP2 and WP3
**Exclusive paths:** `plugin/skills/sync-docs/`, `plugin/skills/update/`, `tests/integration/docs-*`, `tests/integration/update-*`

Work:

- Implement read-only documentation drift reporting with explicit fix mode.
- Compare the code branch with `SYNC.yaml`, update `architecture.md` and `components/`, and support explicit direct push to the docs branch.
- Implement project workflow-schema compatibility checks and migrations.
- Protect repository-owned docs and historical change records.
- Document recovery when a migration or docs update is interrupted.

Acceptance:

- Default docs sync changes nothing.
- Fix mode produces a reviewable docs-branch diff and direct-pushes only after authorization.
- Sync never force-pushes and stops on a dirty worktree or non-fast-forward branch.
- Compatible plugin updates require no project changes.
- Failed migration leaves the previous project schema usable.

### WP7 — Integrate, document, and release the private MVP

**Owner:** primary agent
**Depends on:** WP1–WP6
**Files:** `README.md`, `docs/`, `package.json`, `CHANGELOG.md`, `VERSION`, cross-cutting tests

Work:

- Integrate all skill contracts and resolve duplication.
- Add contract tests that compare skill inventory and required behavior across providers.
- Test on empty, existing, and monorepo fixtures.
- Run one real end-to-end change with Codex and one with Claude Code.
- Write personal installation, organization installation, update, security, and recovery docs.
- Publish private version `0.1.0` only after acceptance passes.

Acceptance:

- Personal private installation works in both providers.
- Both providers operate on the same initialized project and artifact formats.
- The full plan → approve → execute → validation → draft PR loop succeeds.
- A new session reconstructs the workflow without earlier chat history.
- No target project contains ADW plugin implementation files.

## 10. Execution waves and sub-agent allocation

Only three sub-agents can run alongside the primary agent. Work should proceed in waves to avoid shared-file conflicts.

### Wave 0 — Contract gate

Primary agent completes WP0 and checks the PRD diff. No other work begins until the revised product contract is internally consistent. A second user approval is required only if this work reveals a material architecture change.

### Wave 1 — Independent foundations

Run in parallel:

- Agent A: WP1 dual-provider packaging.
- Agent B: WP2 schemas/templates/helpers.
- Agent C: prepare a mapping report from every legacy skill to the new contracts; report only, no shared-file edits.

Primary agent reviews the packaging spike and helper contracts, then freezes paths and schemas.

### Wave 2 — Core skills

Run in parallel on non-overlapping directories:

- Agent A: WP3 initialization/read-only skills.
- Agent B: WP4 planning/approval skills.
- Agent C: WP5 execution/delivery skills after WP4's contract is frozen; until then it may work only on tests and gap analysis.

Primary agent handles integration review and shared contract changes.

### Wave 3 — Maintenance and end-to-end integration

- Agent A: WP6 documentation and migration skills.
- Agent B: cross-provider contract tests.
- Agent C: fixture and security/adversarial tests.
- Primary agent: WP7 integration, documentation, real-provider verification, and release preparation.

Sub-agents must not modify `PRD.md`, `IMPLEMENTATION_PLAN.md`, shared schemas, or plugin manifests unless their assigned package explicitly owns those paths.

## 11. Validation strategy

### Static and contract tests

- Validate both plugin manifests and marketplace files.
- Validate every `SKILL.md` frontmatter block.
- Assert identical required skill inventories for Codex and Claude.
- Scan for forbidden legacy terms and paths in generic skills.
- Validate all example artifacts against schemas.
- Verify generated helper bundle is reproducible from source.

### Integration tests

- Initialize an empty repository.
- Initialize a repository with existing `AGENTS.md`, `CLAUDE.md`, docs, and devcontainer.
- Initialize a polyglot monorepo and keep component commands separate.
- Create and attach the docs branch at root-level `worktrees/docs`, then verify repeat initialization is idempotent.
- Approve a change, edit its spec, and confirm execution stops.
- Run one passing and one failing validation sequence.
- Interrupt and rerun initialization, execution evidence recording, and migration.
- Synchronize documentation since a `SYNC.yaml` marker and test dirty-worktree and non-fast-forward stops.
- Update plugin patch/minor version without touching project artifacts.
- Migrate one fixture across a workflow-schema major version.

### Manual provider tests

- Install from a personal Codex marketplace.
- Install from a private Claude marketplace at user scope.
- Confirm skills use the `adw:<skill>` namespace.
- Confirm both providers can find bundled schemas/templates/helpers.
- Confirm a target project needs no checked-in plugin copy.
- Confirm private update and rollback procedures.

## 12. Legacy material disposition

The reference material is a source of lessons, not code to rename mechanically.

| Existing material | Treatment |
|---|---|
| Former `targeting-batch/skills/adw-brainstorm` | Adapt later with docs-branch context and no sub-agent requirement. |
| `adw-plan-feature` | Rewrite as `plugin/skills/plan`; keep repository exploration and docs-branch storage, remove ADO and multi-phase format. |
| `adw-redteam-plan` | Defer as `plugin/skills/review-plan`. |
| `adw-execute` | Rewrite; remove tickets, implementation worktrees, phases, parallel agents, integration branches, and universal doc-free PR policy. Keep only `worktrees/docs`. |
| `adw-quick` | Reuse scope-gate ideas; remove mandatory ticketing. |
| `adw-amend-plan` | Rewrite around digest invalidation and one sequential plan. |
| `adw-status`, `adw-doctor` | Reuse read-only intent; replace vendored-core/devcontainer/docs-branch checks. |
| `adw-sync-docs` | Retain the docs-branch and `SYNC` marker model; remove ADO coupling and require explicit authorization before direct push. |
| `adw-add-mcp` | Defer until the core loop works. |
| `adw-install.sh` | Retire; plugin managers replace it. Keep as reference until MVP acceptance. |
| `adw-execute-phase.mjs` | Retire; the active agent executes the sequential plan. Extract only evidence-format lessons. |
| Devcontainer/firewall/hooks | Do not ship in the core MVP. Reconsider later as an optional hardening package. |

## 13. Risks and stopping conditions

1. **Provider plugin formats cannot share one physical skill tree.** Stop after WP1 and introduce a release-time generation step from canonical skill sources; do not hand-maintain divergent copies.
2. **Bundled helper paths are not portable between providers.** Stop and choose skill-local generated helpers or provider-specific path adapters before building more skills.
3. **Node.js is unavailable in a supported agent environment.** Stop and select a genuinely portable helper runtime; do not move deterministic checks back into prose.
4. **Provider plugin updates cannot be pinned or rolled back privately.** Require tagged repository marketplace sources and document a last-known-good installation procedure before release.
5. **Initialization cannot preserve provider instruction files safely.** Limit init to creating `adw.yaml`, local state, and `worktrees/docs`, then print a manual routing snippet rather than rewriting instruction files.
6. **Direct docs pushes create unsafe team behavior.** Keep `documentation.delivery` configurable and support pull-request delivery for repositories that protect or review the docs branch.
6. **The workflow becomes more work than ordinary agent use.** Reduce required artifacts or skills before adding integrations or optional features.

## 14. Definition of MVP complete

The private MVP is complete only when:

1. ADW is installed privately into both Codex and Claude Code without an ADW CLI.
2. The same skill source produces equivalent behavior in both providers.
3. `adw:init` adds only project-specific files, creates or attaches `worktrees/docs`, and preserves existing setup.
4. A meaningful change can move through plan, explicit digest-bound approval, implementation, documentation, validation, and draft PR.
5. Editing approved intent invalidates approval.
6. Failed validation cannot be reported as successful completion.
7. A new provider session can reconstruct the state from Git-native artifacts.
8. `adw:sync-docs` can reconcile code changes into the docs branch using `SYNC.yaml` without a code PR or force push.
9. Compatible ADW updates change only the installed plugin.
10. Breaking artifact updates require an explicit, reviewable project migration.
11. Devcontainers, external ticket systems, hosted services, and multi-agent orchestration are unnecessary for the core loop.

## 15. Authorization boundary

The user's implementation request authorizes local implementation of WP0 through WP7, including the described sub-agent delegation and edits inside this workspace.

The packaging spike is a stop gate: if it disproves a fixed architectural decision, implementation pauses and an amended plan is presented instead of silently changing direction.

Approval does not authorize publishing a plugin, changing any external repository, sharing with a workspace or organization, or creating external pull requests. Those actions require separate explicit authorization.
