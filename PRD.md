# ADW 1.0 — Product Requirements

ADW is a private, dual-provider plugin that gives Codex and Claude Code one opinionated, Git-native development workflow. It must stay reusable across repositories, languages, build systems, code hosts, and work trackers. It achieves that portability through one workflow plus a small project configuration and provider adapters — never through a family of author-facing schemas and cross-digested artifacts.

## Product principles

1. **Opinionated workflow, portable environment.** ADW defines how changes are designed, reviewed, approved, implemented, and validated. Projects define where code lives, how it is checked, and which providers they use.
2. **One canonical plan.** `plan.md` contains both human intent and executable work. The same change is never split across a specification and a machine-authored plan.
3. **Agents interpret plans.** A capable coordinating agent reads structured Markdown under the execution skill. The canonical plan is not forced into YAML merely to make conventional parsing easy.
4. **Machines record runs.** Small JSON records are appropriate for runtime state produced and consumed by tooling. Humans never author them.
5. **Exact approval, semantic execution.** Approval binds the exact plan bytes and docs commit. Plan review and execution use agent reasoning to judge architecture, anchors, independence, and requirement drift.
6. **Parallelism is explicit.** Phases are dependency barriers. Groups within a phase run concurrently only when their affected paths and contracts are safely independent.
7. **Genericity lives at seams.** Languages, commands, components, providers, naming, isolation, delivery shape, and maximum parallelism are configurable. Core workflow semantics are not.
8. **External writes remain separate.** Plan approval authorizes local implementation of the plan; it never authorizes pushes, pull requests, tracker mutations, merges, releases, or deployments.
9. **Security is proportional.** Provider sandboxing is the lightweight default. Existing project devcontainers are preserved. The generated hardened devcontainer is an explicit opt-in.
10. **No invisible compatibility framework.** 1.0 is a breaking contract. Existing 0.6 projects receive a clear transition guide, not a permanent migration subsystem.

## Users and experience

### Project maintainer

```text
1. Install ADW through the provider plugin manager.
2. Run adw:init.
3. Review a small adw.yaml and generated project/component context.
4. Commit the project configuration and publish the docs branch.
5. Optionally enable the hardened managed devcontainer.
```

### Contributor

```text
1. Install ADW.
2. Run adw:onboard.
3. Authenticate only the providers the project uses.
4. Run adw:doctor if readiness is uncertain.
5. Use adw:status, adw:plan, adw:approve, adw:execute, and adw:quick.
```

A maintainer must be able to explain ADW with five facts: the docs branch stores durable context and plans; substantial changes use plan → approve → execute; small changes use quick; phases run in order and groups within a phase run in parallel; external writes always get a separate preview and authorization; and ADW never merges, releases, or deploys.

No developer needs to understand JSON Schema, policy digests, profile digests, ordered approval manifests, payload profiles, generated helper internals, or receipt schemas.

## Functional requirements

### Project configuration

A handwritten `adw: 1` contract declares the base branch, docs branch and worktree, execution mode and maximum parallelism, isolation mode, components with their validation commands, optional provider capabilities, and optional plain-language conventions. Validation enforces only operationally important invariants: the contract version; safe non-empty relative branch and worktree values; supported execution mode, isolation, and positive maximum parallelism; unique component ids with project-relative paths and non-empty validation commands; known capability names with non-empty provider names; rejection of credential-like settings; and unknown provider-specific keys permitted only inside `settings`.

The contract must not require command-source fields, component policy digests, enforcement profiles, payload profiles, or schema validation.

### Canonical plan

Every substantial change has exactly one file, `changes/<change-id>/plan.md`, in the mandatory PART 1 / PART 2 shape. PART 1 is written for engineers and must be understandable without PART 2. PART 2 is written for coordinator and worker agents and carries a phase/group glance table, grep-able `file -> symbol` anchors, stable ids, per-group goal, component, dependencies, affected paths and delivery shape, directive tasks, exact non-interactive commands derived from real repository sources, and self-contained artifacts in Notes.

The plan is immutable after approval. Ticket ids, pull-request URLs, progress markers, and validation results live in run records. A design or scope change uses `adw:amend`, changes the plan bytes, and requires reapproval.

### Plan review

`adw:review-plan` is the default final step of `adw:plan` and is also invocable standalone. It runs as a fresh subagent that receives only the plan and repository. It must check design fitness, the single load-bearing assumption, simpler and rejected alternatives, every anchor against live code, phase dependency order, path overlap and contract conflicts among parallel groups, worker-context completeness, whether validation commands are real and sufficient, and whether every acceptance criterion maps to executable work and validation. Objective defects are fixed; judgment calls become explicit open decisions. `needs-rework` prevents approval.

### Approval

Approval binds one canonical plan: version, change id, plan path, plan digest, plan commit, approver, timestamp, and status. Verification requires exact current bytes matching the digest, a plan commit reachable on the docs branch containing byte-identical content, `active` status, and matching change id and plan path. Amendment archives the superseded approval under `approval-history/<plan-digest>.json` with a reason and timestamp before the plan is edited, and leaves execution blocked until fresh approval. No generalized input ordering, plan/spec pairing, schema/plugin version binding, profile digests, or requirement digests are retained.

### Execution

In `sequential` mode the coordinator uses one branch and worktree and runs groups in plan order, still with independent review and exact validation.

In `orchestrated` mode the coordinator verifies approval and the requested phase; verifies dependency phases are complete and, for group-PR delivery, merged by a human into the configured base; interprets the phase into a bounded preview; writes the phase run record before launching workers; prepares deterministic branches and worktrees; runs up to `max_parallel` groups concurrently; runs implementation → independent review → high-severity fixes → deterministic validation → coordinator scope check inside each group; stops the phase on scope drift, unsafe overlap, an unresolved high-severity finding, or a required validation failure; offers separately authorized tracker, push, and draft-PR actions afterwards; and records exact results.

Workers never commit, push, create tracker items, or create pull requests. The coordinator owns Git and every external action. Native provider subagent facilities are used without hardcoding model product names.

### Branches, worktrees, and delivery

Defaults are `adw/<change-id>/<group-id>` and `worktrees/<change-id>/<group-id>`. Preparation records the plan digest, phase and group ids, base branch and exact base commit, relative worktree and branch, interpreted packet, affected paths, and validation commands. Two delivery strategies are supported per plan: group pull requests (default) and one integration pull request. ADW merges neither. Parallel groups must have disjoint write paths unless the plan defines a shared contract group in an earlier phase.

### Runtime records and validation evidence

Machine-generated state lives in `changes/<change-id>/runs/<phase-id>.json` under one small handwritten contract with truthful state transitions and no passing validation containing a required nonzero exit, signal, timeout, or deferral. Validation executes exact commands in confined project-relative working directories, preserves exit code, signal, timeout, and bounded redacted output, terminates process groups with SIGTERM/SIGKILL escalation, and never hand-authors a passing result. Run records are committed on the docs branch so a later session can resume; pushing remains separately authorized.

### Provider adapters

Workflows depend on `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities with four operations each: `read`, `create`, `update`, `link`. Provider references translate them to native, MCP, CLI, or API transports. The core plan and skills contain no provider field names or payload shapes. Tracker intents are limited to none, one parent per plan, one child per group, and link-existing. Every write requires a preview, fresh authorization, an idempotency marker, and readback; the resulting id, URL, and concise outcome go into the run record.

### Initialization, onboarding, and security

`adw:init` produces a small `adw.yaml`, bounded routing blocks, ignore entries, the docs branch and worktree with `architecture.md`, `components/`, and `changes/`, optional ignored local state, managed permission files required by the active providers, and an optional generated `.devcontainer/` only when explicitly selected. Isolation defaults to preserving an existing project devcontainer, otherwise `provider-sandbox`, with `managed-devcontainer` offered as an opt-in. `adw:onboard` attaches the docs branch, writes optional personal non-secret preferences, checks configured provider availability, and reports readiness without rerunning shared initialization or requiring Docker for a provider-sandbox project.

## Explicit exclusions

ADW does not add a hosted scheduler, daemon, workflow database, or standalone agent service; automatic merging, releasing, deployment, or force-pushing; a generic JSON Schema or migration platform; arbitrary tracker-field templating in core; automatic conflict resolution between group branches; credentials in project configuration or run records; backward execution of active 0.6 plans; or a requirement that every project use Docker, a tracker, or a code host.

## Success criteria

1. A new developer understands the workflow from README and onboarding without learning artifact schemas or digests.
2. Empty, existing, and polyglot monorepos initialize with a small reviewed config.
3. A single `plan.md` is understandable to a human and executable by another agent without chat history.
4. Plan review catches stale anchors, unsafe parallel overlap, incomplete tasks, and unreal validation commands.
5. Editing an approved plan blocks execution until reapproval.
6. One phase runs at least two independent groups concurrently in isolated worktrees.
7. Every group receives independent implementation and review passes plus truthful validation.
8. Interrupted execution resumes from Git branches, worktrees, approval, and run records.
9. Group-PR and integration-PR delivery both work without ADW merging anything.
10. Projects with no integrations and no devcontainer retain the lightweight path.
11. Codex and Claude Code use the same plan, approval, run records, and workflow semantics.
12. The complete test suite passes and the 0.6 schema/profile machinery is absent from the released plugin.
