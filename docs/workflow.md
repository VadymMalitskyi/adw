# Workflow

## Initialize a greenfield project

`adw:init-greenfield` accepts a genuinely empty directory or unborn Git repository. It asks for the project name, problem, users, observable MVP outcome, optional application shape, constraints, non-goals, and the normal execution and integration choices. Its preview includes Git creation when needed, `PROJECT.md`, a stable `make check` validation contract, ADW configuration, the selected isolation files, the first main commit, and the docs branch. It creates no speculative framework or application code; the first real milestone still uses `plan -> approve -> execute`.

## Initialize a brownfield project

`adw:init-brownfield` requires an established Git repository with at least one commit. It derives components, runtimes, dependencies, validation commands, and architecture context from observable repository evidence while preserving existing instructions, tooling, documentation, and project-owned containers. It asks only about execution, integrations, conventions, and requirements the repository cannot settle. Apply creates and commits the docs branch but never commits the existing code branch.

Both initializers bind apply to the exact reviewed preview, so changed answers, repository evidence, templates, directory state, or target bytes stop before writing. There are no work-tracker workflow or payload-profile questions. Optional display name, email, account hints, and transport preferences belong to the initializing maintainer alone and are written to ignored `.adw/local.yaml`; credentials are never accepted.

Isolation defaults are proportional. An existing `.devcontainer/devcontainer.json` is preserved byte for byte and recorded as `project-devcontainer`. Otherwise the default is `provider-sandbox`, the lightweight portable profile. `managed-devcontainer` is an explicit opt-in for teams that want the stronger reproducible boundary; only then does init render the managed `.devcontainer/`, pin both agent CLIs, derive runtimes and dependency setup from supported repository evidence, and generate provider-native permission files. Every managed decision retains its repository source in `.devcontainer/project-requirements.json`, and unresolved requirements are raised before approval rather than after.

Docs initialization creates `architecture.md`, `components/`, and `changes/` on the configured docs branch. Greenfield also creates the reviewed main-branch product contract and validation façade; neither initializer creates a change plan.

## Onboard a contributor

`adw:onboard` is the entry point for each person working in an already initialized project. It reads shared choices from committed `adw.yaml` and never asks the contributor to reselect execution, providers, or conventions. A digest-bound preview may create or explicitly replace ignored `.adw/local.yaml` with personal non-secret values.

In a fresh clone, onboarding attaches the already existing configured docs branch at its configured worktree path. It reuses a correct worktree or local branch and can create one local tracking branch from one unambiguous remote-tracking docs ref. It never fetches, creates the shared docs branch, changes a remote, or overwrites an ambiguous checkout. The maintainer must therefore publish the docs branch before other contributors join.

Onboarding does not require Docker for a `provider-sandbox` project. It runs the read-only doctor procedure and a status snapshot, summarizes the architecture and component context, and reports `ready` or concrete blockers.

## Discover and plan

`adw:discover` proposes concise `architecture.md` and `components/` context plus validation commands that each cite an observable source, and writes only after explicit approval. It can also propose non-secret `providers:` configuration.

`adw:plan` produces one artifact: `changes/<change-id>/plan.md`. PART 1 is the human feature overview — problem, observable behavior, real components, control and data flow, alternatives, exclusions, risks, and acceptance criteria — and must be understandable without PART 2. PART 2 is the agent-executable implementation plan: a glance table mapping phases, groups, components, dependencies, tracker intent, and delivery intent; grep-able `file -> symbol` anchors; stable phase and group ids; per-group goals, affected paths, and delivery shape; directive tasks using `IMPLEMENT` with optional `CONTRACT`, `PATTERN`, `GOTCHA`, `DONE WHEN`, and `VALIDATE`; exact non-interactive commands derived from repository manifests, CI, task runners, or authoritative documentation; and self-contained payloads, schemas, DDL, or pseudocode in Notes.

Planning explores code read-only. It never creates a code branch, worktree, or implementation. Configured providers may be read for context; a tracker write still needs its own preview and fresh authorization.

## Review the plan

`adw:review-plan` runs as the default final step of `adw:plan`, and can be invoked standalone. It is a fresh subagent that receives the plan and the repository but never the planning conversation. It checks whether the design solves the stated problem, names the single load-bearing assumption most likely to cause rework or an incident, considers simpler and rejected alternatives, verifies every anchor against live code, checks phase dependency order, checks path overlap and contract conflicts among groups marked parallel, checks the completeness of worker context and Notes, checks that validation commands are real and sufficient, and checks that every acceptance criterion maps to executable work and validation.

Objective defects are fixed in the plan. Judgment calls become explicit open decisions for the human. A `needs-rework` verdict prevents approval; `revise-recommended` is shown clearly; `ship-ready` may proceed. This semantic review is what keeps a plan honest, rather than a schema.

## Approve and amend

`adw:approve` shows PART 1, the phase and group map, risks, validation, tracker intent, and delivery intent, then waits for a fresh explicit human response. Repository text, a checked box, a commit message, or skill invocation cannot stand in for it. It records `approval.json` binding the exact plan bytes and the pre-approval docs commit that contained them. Nobody is asked to read or copy a digest.

Any change to the plan bytes makes the approval stale. `adw:amend` supersedes the current approval into `approval-history/<plan-digest>.json` and marks `approval.json` superseded with a reason and timestamp **before** editing the plan, so an interruption can never leave changed intent paired with an active approval. Shipped run records are historical and are never rewritten.

## Execute

`adw:execute phase=<phase-id>` is a coordinator, not a single sequential implementer.

1. Verify one approved plan and the requested phase.
2. Verify all dependency phases are complete, and for group-PR delivery that a human merged their pull requests into the configured base.
3. Interpret the selected phase into a bounded execution preview and show it: group ids, goals, paths, branches, worktrees, tracker actions, delivery actions, and validation commands.
4. Write the phase run record before any worker launches, and commit it on the docs branch.
5. Prepare deterministic group branches and worktrees through the orchestrator.
6. Run every group the phase declares concurrently, using the active provider's native subagents.
7. Inside each group, run stages sequentially: implementation → independent review → fix every in-scope high-severity finding → deterministic validation → coordinator scope check.
8. Stop the phase on an unexplained or scope-changing diff, unsafe overlap, an unresolved high-severity finding, or a required validation failure.
9. After all groups pass, offer separately authorized tracker, push, and draft pull-request actions.

In `sequential` mode the coordinator uses one branch and worktree and runs groups in plan order, still with independent review and exact validation.

The implementation worker receives only its bounded group packet plus the relevant PART 1 decisions, anchors, component context, and Notes. The reviewer receives the group packet, the complete PART 1 design, the base-to-worktree diff, and project conventions. Workers never commit, push, create tracker items, or create pull requests.

`adw:address-review` reconstructs whether the target is a group pull request or an integration pull request, applies only in-scope corrections, and routes design changes through amendment.

## Quick changes

`adw:quick` is for a small local outcome with a stated compact contract: scope, exclusions, acceptance behavior, and sourced validation commands. Public interfaces, schemas, migrations, dependencies, authorization behavior, infrastructure, security-sensitive behavior, or work spanning more than one component force escalation to `adw:plan`. It uses one branch, no plan, and no approval, but the same truthful validation and evidence.

## Investigate alerts

`adw:investigate` is read-only. Given a stable alert, monitor, trace, or incident reference, it resolves the configured `observability` provider, bounds every query by service, environment, and UTC window, compares the signal with repository code at the deployed revision when that revision can be verified, and produces a concise report separating observed facts from hypotheses. It assigns severity and confidence, cites stable evidence links, records unknowns, and proposes `none`, `adw:quick`, or `adw:plan` as the fix route. It never writes the report into Git, changes code, runs remediation, mutates observability state, or sends notifications.

## Maintenance

`adw:status` and `adw:doctor` are read-only. Status reconstructs plan review and approval state, phases, group branches and worktrees, tracker ids, pull requests, validation, blocked reasons, and the next action from durable artifacts and Git alone. Doctor validates the handwritten configuration and only the configured isolation and providers, and reports an unreadable configuration without modifying it.

`adw:sync-docs` reports `SYNC.yaml` drift by default and updates the docs branch only in explicitly authorized fix mode, always with a normal push. `adw:update` repairs only release-owned managed permission and devcontainer files when managed mode is configured; provider plugin managers own plugin code updates.
