# ADW Private Plugin — 0.2 Implementation Plan

**Status:** 0.1 foundation implemented; 0.2 optional integration layer in implementation
**Prepared:** 2026-08-05
**Target:** Personal/private first, organization-private later

## 1. Outcome

Build ADW as one private, versioned plugin repository that works with Codex and Claude Code. Version 0.2 adds optional provider-neutral integrations without changing the lightweight core workflow.

The plugin supplies the workflow skills. A project that uses ADW stores only project-specific configuration, concise context, specifications, approvals, and validation evidence.

```text
private ADW repository
    ├── Codex plugin installation
    └── Claude Code plugin installation
                 |
                 | ADW skills read and write
                 v
       project code branch + docs branch
                 |
                 v
      optional capability/provider adapters
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
8. **Execution environment:** use a required managed Dev Container by default for new repositories, preserve project-owned containers, and retain the agent's own sandbox and permissions as an inner boundary.
9. **Delivery:** one branch and one draft pull request through `code_host`; GitHub is the initial provider, and ADW never merges or deploys.
10. **Runtime:** Node.js 20+ for bundled internal helpers. Helpers are invoked by skills and are not a user-facing command API.
11. **Canonical source:** shared skills and contracts are maintained once. Provider-specific files contain packaging only.
12. **Integration dependency:** workflows depend on `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities, never directly on MCP or CLI tool names.
13. **Provider/transport split:** Azure DevOps, GitHub, Datadog, and Notion are initial providers; native connectors, MCP, CLI, and API are replaceable transports.
14. **Lightweight behavior:** each capability is `disabled`, `optional`, or `required`; omitting integrations preserves the existing workflow without external probes or artifacts.
15. **External writes:** every mutation needs an exact preview and fresh authorization, an idempotency identity, provider readback, and a redacted durable receipt.

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
│   ├── integrations/
│   │   ├── contracts.md
│   │   ├── providers.json
│   │   └── providers/
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
│       ├── integrations.ts
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
│   ├── integrations.md
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
    integrations.yaml                  # optional bindings
    approval.json
    validation.json
    external-events/                   # redacted receipts
SYNC.yaml
```

The project does **not** receive:

- ADW skill implementations.
- Plugin manifests.
- ADW helper programs.
- Provider-wide tooling or credentials; a project-specific managed devcontainer is created when the project does not already own one.
- ADW provider implementations, MCP/CLI configuration, or credentials.

## 5. Artifact contracts

### `adw.yaml`

Contains shared project facts:

```yaml
schema: 3

git:
  default_branch: main

documentation:
  mode: branch
  branch: docs
  worktree: worktrees/docs
  sync_marker: SYNC.yaml
  delivery: direct-push

execution:
  isolation: managed-devcontainer
  enforcement: required

components:
  backend:
    path: services/backend

validation:
  default:
    - npm run lint
    - npm test
    - npm run build

# Optional; omit for a lightweight project.
integrations:
  work_tracker:
    provider: azure-devops
    requirement: optional
    transport: auto
    access: read-write
    settings:
      organization: contoso
      project: platform
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
- `integrations.yaml`: optional stable provider bindings, requirement fields/digests, IDs, and URLs; never credentials.
- `approval.json`: approver, timestamp, schema/plugin versions, and deterministic input digests for `spec.md`, `plan.yaml`, and optional `integrations.yaml`.
- `validation.json`: exact commands, exit codes, durations, summaries, and explicitly deferred checks.
- `external-events/*.json`: normalized receipts for external actions, including idempotency key, authorization digest, request/readback digests, provider revisions, verification, and a redacted summary.

### `SYNC.yaml` on the docs branch

Records the last code revision reviewed by documentation synchronization:

```yaml
code_branch: main
reviewed_through: 7d912ab
updated_at: 2026-08-05T14:30:00Z
```

## 6. Skill contracts

### Core path

| Skill | Contract |
|---|---|
| `adw:init` | Inspect the project, preview changes, create schema-3 `adw.yaml`, select and create the managed devcontainer when absent or preserve a project-owned one, ignore `/worktrees/` and `.adw/`, create or attach the docs worktree, and add bounded routing blocks. |
| `adw:doctor` | Read-only check of plugin compatibility, project schema, local setup, and each configured capability's requirement, provider, transport, operations, and access level. |
| `adw:status` | Read-only reconstruction of active changes, approval state, external bindings/receipts, branches, validation, and draft PRs. |
| `adw:discover` | Analyze repository structure and propose project/component context plus non-secret integration settings; write only after approval. |
| `adw:plan` | Pull the docs worktree, explore relevant code and configured external context, create `spec.md` and `plan.yaml`, and optionally create/link a work item after separate authorization. |
| `adw:approve` | Validate and summarize the current approval bundle and bound external requirements, request explicit human confirmation, then record input digests and the docs commit SHA. |
| `adw:execute` | Verify the approval bundle and requirement drift, implement sequentially, validate, prepare a draft PR, and perform only separately authorized external writes with readback and receipts. |
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

## 6.1 Integration contracts for 0.2

Workflow skills load the common contract in `plugin/integrations/contracts.md` and only the selected provider reference. Provider discovery comes from `providers.json`.

- Azure DevOps implements `work_tracker` first. Its transport can be native, local MCP, authenticated Azure CLI, or REST API; the current official remote MCP client limitation makes a local MCP or CLI/API fallback necessary for unsupported agents.
- GitHub implements `code_host` first and may implement `work_tracker` through Issues.
- Datadog implements read-only `observability`; a write-capable credential does not expand that contract.
- Notion implements `knowledge` reads and separately authorized publication.

Every mutation follows read → preview → authorize → idempotency check → write → readback → receipt. Approval never grants blanket authorization for later external effects.

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
- Remove skill vendoring, managed-file hashes, and source-bundle language; retain reviewed managed-container generation as project-specific infrastructure.
- Add private personal/org marketplace distribution.
- Restore the separate `docs` branch for ADW context and change records, using root-level ignored `worktrees/docs` locally.
- Define managed, project-owned, and provider-sandbox execution profiles with explicit enforcement.
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
- Preserve existing `AGENTS.md`, `CLAUDE.md`, `.gitignore`, documentation, and project-owned devcontainer files; create the managed template only when absent.
- Add or update only bounded ADW routing blocks.
- Ensure `.adw/` and root-level `/worktrees/` are ignored before creating local state.
- Create or attach the `docs` branch and its `worktrees/docs` checkout without disturbing the code checkout.
- Derive commands from observable repository sources and mark unresolved values.
- Derive supported managed-container runtimes, locked dependency setup, curated native packages, ports, and registry domains from repository evidence; retain provenance and unresolved requirements in a generated artifact.
- Activate the managed firewall before non-root project setup and bind generated requirements/setup digests into doctor verification.

Acceptance:

- Re-running `init` produces no duplicate blocks or unrelated changes.
- Existing instructions survive byte-for-byte outside managed blocks.
- `doctor` and `status` are read-only.
- Re-running init reuses the existing docs worktree and never duplicates `/worktrees/` ignore rules.
- Init creates the managed `.devcontainer/` for a new project and never edits an existing project-owned one.
- Managed init previews its exact development-environment evidence and emits only curated setup commands; doctor rejects generated-file drift.

### WP4 — Build plan, approval, and amendment skills

**Owner:** planning-skills agent
**Depends on:** WP2
**Exclusive paths:** `plugin/skills/plan/`, `plugin/skills/approve/`, `plugin/skills/amend/`, `tests/integration/plan-*`, `tests/integration/approval-*`

Work:

- Implement repository-grounded planning and the sequential plan format.
- Add documentation-impact declaration.
- Implement approval confirmation and digest recording.
- Implement amendment and approval invalidation.
- Remove mandatory Azure DevOps/Notion assumptions, execution phases, implementation worktrees, and multiple implementation agents. Retain only the dedicated `worktrees/docs` checkout; optional integrations arrive through the later provider-neutral layer.

Acceptance:

- Planning creates no feature code, branch, or PR. Version 0.2 may create or link a ticket only after a separately authorized exact proposal.
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
- Prepare one draft PR through the configured `code_host` capability when explicitly authorized; GitHub is the initial adapter.
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
- Publish private version `0.1.0` only after acceptance passes; release 0.2.0 only after WP8 acceptance passes.

Acceptance:

- Personal private installation works in both providers.
- Both providers operate on the same initialized project and artifact formats.
- The full plan → approve → execute → validation → draft PR loop succeeds.
- A new session reconstructs the workflow without earlier chat history.
- No target project contains ADW plugin implementation files.

### WP8 — Add provider-neutral optional integrations for 0.2

**Owner:** integration workstream
**Depends on:** stable 0.1 artifact and skill contracts
**Files:** `plugin/integrations/`, project/approval/integration/external-action schemas and templates, affected workflow skills, helper support, tests, and documentation

Work:

- Add schema v2 project configuration with `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities and `disabled`/`optional`/`required` behavior.
- Define provider metadata and focused references for Azure DevOps, GitHub, Datadog, and Notion while keeping transports independent.
- Add change-level integration bindings, approval-bundle inputs, requirement drift checks, idempotency keys, and external-action receipts.
- Update plan, approve, amend, and execute contracts for scoped reads and separately authorized mutations.
- Keep Datadog read-only and retain the no-integration path without external probes or generated integration artifacts.
- Document that unsupported official Azure DevOps remote MCP clients require local MCP or an authenticated CLI/API fallback; ADW does not install or authenticate it.

Acceptance:

- A schema v1/lightweight project behaves as before, and migration to schema v2 makes no provider calls.
- Optional unavailable capabilities do not block; required unavailable operations stop only the relevant workflow step.
- Approval binds `spec.md`, `plan.yaml`, and optional `integrations.yaml`; changed requirement-bearing external content requires amendment and reapproval.
- Repeated create/update attempts reuse a matching idempotency marker or stop safely instead of duplicating an object.
- Every external mutation has fresh authorization, provider readback, and a schema-valid redacted receipt, including truthful failure evidence.
- Provider and transport choices can change without changing workflow semantics or committing credentials.

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
- Validate a project with no integrations, each requirement mode, and a required unavailable capability.
- Validate approval invalidation for requirement drift but not ordinary operational-field drift.
- Validate idempotent retry, provider readback mismatch, failed receipt recording, redaction, and hostile external content.
- Validate each initial provider advertises only supported capabilities/transports and Datadog remains read-only.

### Manual provider tests

- Install from a personal Codex marketplace.
- Install from a private Claude marketplace at user scope.
- Confirm skills use the `adw:<skill>` namespace.
- Confirm both providers can find bundled schemas/templates/helpers.
- Confirm a target project needs no checked-in plugin copy.
- Confirm private update and rollback procedures.
- Confirm Azure DevOps work tracking resolves an available transport or reports the configured fallback without installing/authenticating tools.

## 12. Legacy material disposition

The reference material is a source of lessons, not code to rename mechanically.

| Existing material | Treatment |
|---|---|
| Former `targeting-batch/skills/adw-brainstorm` | Adapt later with docs-branch context and no sub-agent requirement. |
| `adw-plan-feature` | Rewrite as `plugin/skills/plan`; keep repository exploration and docs-branch storage, remove mandatory ADO coupling and multi-phase format. |
| `adw-redteam-plan` | Defer as `plugin/skills/review-plan`. |
| `adw-execute` | Rewrite; remove mandatory tickets, implementation worktrees, phases, parallel agents, integration branches, and universal doc-free PR policy. Keep only `worktrees/docs`; add optional capability use in 0.2. |
| `adw-quick` | Reuse scope-gate ideas; remove mandatory ticketing and keep integrations opt-in. |
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
7. **The workflow becomes more work than ordinary agent use.** Keep integrations omitted by default and reduce required artifacts before adding further providers or features.
8. **Provider tools expose inconsistent operations or permissions.** Resolve and report operation-level capability before a workflow; do not infer write access from authentication.
9. **External retry creates duplicates.** Require a stable idempotency marker, pre-write lookup, readback, and truthful failed/uncertain handling before any retry.

## 14. Definition of version 0.2 complete

The private 0.2 release is complete only when:

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
11. Devcontainers, external systems, hosted services, and multi-agent orchestration remain unnecessary for the core loop.
12. Optional integrations resolve capabilities independently of provider and transport, with no committed credentials.
13. Required external state is bound into approval; operational drift alone does not invalidate it.
14. Authorized external mutations are idempotent, read back, and recorded as redacted receipts.

## 15. Authorization boundary

The user's implementation request authorizes local implementation of WP0 through WP8, including the described sub-agent delegation and edits inside this workspace.

The packaging spike is a stop gate: if it disproves a fixed architectural decision, implementation pauses and an amended plan is presented instead of silently changing direction.

Approval does not authorize publishing a plugin, changing any external repository or provider object, sharing with a workspace or organization, or creating external pull requests. Those actions require separate explicit authorization for the exact target and payload.
