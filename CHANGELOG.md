# Changelog

All notable changes to this private plugin are documented here.

## Unreleased

### Planning templates

- New initializations copy the standard plan template to committed `adw/plan-templates/standard.md` and register it in the optional `planning` block of `adw.yaml`.
- Projects may register multiple complete Markdown templates, edit headings and project-required sections directly, and select a default without changing the ADW plugin.
- Four retained `ADW:SECTION` markers preserve the execution-critical semantic core, while an in-plan required-sections manifest durably binds every project-required section. Existing projects without `planning` keep the bundled fallback, and existing plans and approvals are never re-rendered.
- Contributors may select a preferred project-declared template in ignored `.adw/local.yaml`; explicit per-change selection still wins, and arbitrary personal template paths are not supported.

### Initialization

- Replaced the mixed initializer with two explicit workflows: `adw:init-greenfield` for a genuinely empty project and `adw:init-brownfield` for an established Git repository.
- Greenfield initialization now preview-binds creation of the Git repository, `PROJECT.md`, the stable `make check` validation contract, the first main commit, and the docs branch without generating speculative application code.
- Brownfield initialization retains repository-derived discovery and byte-preserving adoption, and never commits the established code branch.
- Moved deterministic initialization mechanics under `plugin/initialization/` so the two skills share one implementation without exposing a third routing command.
- Documented the brownfield onboarding answers payload in `adw:init-brownfield` so the skill no longer relies on reading the normalizer to learn the schema-1 shape.

### Security

- The permission profile now protects the files that carry it: `.claude/settings.json`, `.codex/config.toml`, `.codex/rules/adw.rules`, `adw.yaml`, and `.devcontainer/**` require explicit review before an Edit or Write, which `acceptEdits` previously auto-accepted.
- `adw:execute` verifies permission-policy integrity before its first project command and stops on drift. `plugin/skills/doctor/scripts/snapshot.mjs --checks permissions` exposes that check on its own, so the gate costs nothing beyond reading the policy files.
- Existing projects report `permissions:claude` drift until `adw:update` re-renders the policy; managed devcontainers also need a rebuild to refresh the recorded payload digests.

## 1.0.0 - 2026-08-14

First release. ADW gives Codex and Claude Code one opinionated, Git-native development workflow from a single shared skill tree.

### Workflow

- One canonical `changes/<change-id>/plan.md` per change: PART 1 is the human feature overview, PART 2 is the agent-executable implementation plan with phases, groups, `file -> symbol` anchors, directive tasks, and sourced validation commands.
- `adw:review-plan` red-teams every plan cold, receiving the plan and repository but not the planning conversation. It verifies anchors against live code, phase dependency order, write-path overlap between concurrent groups, worker-context completeness, real validation commands, and acceptance-criterion coverage, then emits `ship-ready`, `revise-recommended`, or `needs-rework`.
- `adw:approve` binds the exact plan bytes and the docs commit containing them. Editing one byte blocks execution until reapproval, and nobody is ever asked to read or copy a digest.
- `adw:execute` coordinates a phase: it verifies approval and dependencies, shows a bounded preview, writes a run record before any worker starts, prepares deterministic branches and worktrees, and runs every group the phase declares concurrently through the active provider's native subagents. Each group runs implementation, independent review, high-severity fixes, truthful validation, and a coordinator scope check.
- `adw:amend` supersedes and archives an approval before the plan is edited, so changed intent can never sit beside an active approval.
- `adw:quick` covers a genuinely small local correction with no plan and no approval, and escalates anything that grows.
- Group pull requests and integration pull requests are both supported. ADW merges neither, and never marks ready, releases, deploys, or force-pushes.

### Contract

- A small handwritten `adw: 1` project contract: base branch, docs branch and worktree, execution mode, isolation, components with their validation commands, optional provider capabilities, and optional plain-language conventions. No JSON Schema engine, policy digests, or payload profiles.
- Machine-written phase run records at `changes/<change-id>/runs/<phase-id>.json` with monotonic state transitions. A group cannot be recorded as passed without independent review and truthful validation, and a validation cannot pass while a required command failed, was signaled, timed out, or was deferred.
- `plugin/execution/orchestrator.mjs` performs deterministic Git mechanics only, writing a marker commit per group so an interrupted phase resumes from Git alone. It refuses overlapping write paths, symlinked or already-owned targets, and never deletes a branch or worktree.
- Status and resume reconstruct everything from durable artifacts and Git, never from chat history.

### Providers and security

- Provider-neutral capability adapters for `work_tracker`, `code_host`, `observability`, and `knowledge`, each with four operations and a native, MCP, CLI, or API transport. Initial references cover Azure DevOps, GitHub, Datadog, and Notion without leaking any provider field model into the plan format.
- Every external write requires a preview, fresh explicit authorization, an idempotency marker, and readback; only the resulting id, URL, and concise outcome enter the run record.
- Security is proportional. `provider-sandbox` is the lightweight default, an existing project devcontainer is preserved untouched, and the hardened managed devcontainer — pinned agents, non-root user, fail-closed egress proxy, project-scoped credential volumes — is an explicit opt-in.
- Path confinement, symlink defenses, atomic managed-file writes, and timeout process-tree termination throughout.
