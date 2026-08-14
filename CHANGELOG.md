# Changelog

## 1.0.0 - 2026-08-13

Breaking. ADW 1.0 replaces the 0.6 schema-heavy sequential workflow with a simpler, generic, phased one. It restores capability that 0.6 removed and removes ceremony that 0.6 accumulated. See `docs/migrating-from-0.6.md`; there is no migration subsystem.

### Restored capability

- Restore dependency-ordered phases and parallel groups within a phase, each in its own branch and worktree, bounded by `execution.max_parallel`.
- Add `plugin/execution/orchestrator.mjs`: deterministic preview, prepare, inspect, and cleanup guidance for group branches and worktrees, with a durable marker commit per group so an interrupted phase resumes from Git alone.
- Rewrite `adw:execute` as a coordinator that runs implementation, independent review, high-severity fixes, truthful validation, and a scope check per group through the active provider's native subagents. Workers never commit, push, or touch external systems.
- Restore `adw:review-plan` as a cold red-team pass and make it the default final step of `adw:plan`. It verifies anchors against live code, phase dependency order, parallel path overlap, worker-context completeness, real validation commands, and acceptance-criterion coverage, and emits `ship-ready`, `revise-recommended`, or `needs-rework`.
- Support two delivery strategies per plan — one draft pull request per group, or one draft integration pull request — and merge neither.
- Add machine-written phase run records at `changes/<change-id>/runs/<phase-id>.json` with truthful, monotonic state transitions.

### Removed ceremony

- Replace `spec.md` plus `plan.yaml` with one canonical `changes/<change-id>/plan.md` in a mandatory PART 1 / PART 2 shape.
- Replace project schema 5 with a small handwritten `adw: 1` contract that a human can read without documentation.
- Replace the ordered approval bundle with an exact-byte plan approval that never asks a human to copy a digest.
- Remove `integrations.yaml`, standalone `validation.json`, `external-events/` receipts, `adw/work-items/*.yaml` payload profiles, effective-policy snapshots, and every policy, profile, requirement, and authorization digest.
- Delete `plugin/schemas/` and the entire JSON Schema engine; drop AJV as a dependency and shrink the generated helper bundle by roughly half.
- Reduce the helper to the operations that genuinely need conventional code, and reduce its CLI to fourteen commands.
- Replace work-item payload profiles with adapter defaults, four provider-neutral operations (`read`, `create`, `update`, `link`), and four tracker intents.

### Changed defaults

- `provider-sandbox` is now the default isolation mode for a repository without a devcontainer. An existing project devcontainer is still preserved and selected automatically. The hardened managed devcontainer remains fully supported and tested, but is an explicit opt-in rather than a prerequisite for adopting ADW.
- `adw:onboard` no longer requires Docker for a provider-sandbox project.
- `adw:doctor` recognizes an 0.6 `schema: 5` project and returns exact transition guidance without modifying it.

### Preserved

Exact-byte human approval and drift detection, real exit-code/signal/timeout/bounded-output validation evidence, timeout process-tree termination, path confinement and symlink defenses, atomic managed-file writes, explicit authorization before every external write, Git-native resume and status reconstruction, provider-neutral capability boundaries, and every managed-container security control and its tests.

## 0.6.1 - unreleased

- Harden the Claude managed permission hook against quoted, escaped, dynamic, aliased, nested, and Git-global-option command obfuscation; unknown Git verbs now require approval.
- Preserve initialization-selected runtime versions through managed-container repair, safely recovering consistent legacy evidence and failing closed on ambiguity.
- Repair partial Codex managed blocks in place, match contributor docs refs exactly, and remove the unimplemented pull-request documentation-delivery option.
- Terminate timed-out validation process groups with bounded escalation, atomically replace managed files without an absent-destination crash window, and record exact execution bases in durable branch metadata.
- Reconstruct quick-change state from standalone validation evidence, audit immutable approval history, and complete the documented artifact inventory.
- Remove the unused onboarding agent-choice input and execute-stage work-item binding, clarify that managed initialization provisions both agents, and align Azure DevOps transport documentation with the provider registry.
- Use the same plain-approval, internally retained preview-digest interaction for init, onboard, and update.

All notable changes to this private plugin are documented here.

## 0.6.0 - 2026-08-10

- Make Claude Code's managed-development policy sandbox-first, with a fail-closed managed hook backed by static ask/deny rules.
- Auto-allow sandbox-confined work while prompting for external writes and forbidding force-push, merge, release, publish, and deployment commands across Codex and Claude Code.
- Add `adw:onboard` with digest-bound personal configuration, safe attachment of an existing remote docs branch, and doctor/status-backed readiness reporting.
- Add read-only `adw:investigate` with bounded observability queries and schema-validated incident reports.
- Derive managed-container runtimes, dependency setup, native packages, ports, and package-registry domains from supported repository evidence.
- Add digest-verified managed-file repair, stronger DNS and egress controls, agent-aware diagnostics, and adversarial cross-provider policy coverage.
- Generate the self-contained helper deterministically from one runtime source and remove the legacy helper mirror.
- Add schema-5 `managed-development` permissions and generated Codex and Claude Code policy files.

## 0.5.0 - 2026-08-09

- Drop support for project schemas 1–4, plan schema 1, approval schema 1, and all bundled migrations from previous releases.
- Make the installed release's validators the artifact contract and reject unsupported schemas without rewriting historical evidence.

## 0.4.0 - 2026-08-09

- Add project schema 4 with optional work-tracker workflow policy and committed payload-profile references.
- Add plan schema 2 with digest-bound effective components, validation, and tracker policy.
- Add deterministic project-policy resolution, work-item profile and payload validation, diagnostics, and contract coverage.
- Add one bundled YAML 1.2 and draft-2020-12 schema-validation path that reads exact artifact bytes and rejects duplicate keys and placeholders.
- Add interactive initialization and evidence-derived managed development support for Node, Python, Go, Rust, Java, Ruby, and .NET projects.

## 0.3.0 - 2026-08-05

- Add a schema-3 execution contract with managed-devcontainer, project-devcontainer, and provider-sandbox profiles.
- Make a pinned, non-root, egress-filtered managed devcontainer the default for newly initialized repositories.
- Preserve project-owned devcontainers byte-for-byte and require an explicit active-runtime marker before executing project commands.
- Install pinned Codex and Claude Code CLIs in the managed image while keeping each agent's own inner permission and sandbox controls enabled.
- Add doctor and status evidence for configured and active isolation, conservative schema migration, and security-focused container tests.

## 0.2.0 - 2026-08-05

- Add provider-neutral integration contracts for work trackers, code hosts, observability systems, and knowledge systems.
- Add optional, required, and disabled integration behavior so lightweight projects remain unchanged.
- Add Azure DevOps-first work tracking, GitHub code hosting, Datadog read-only observability, and Notion knowledge-provider profiles.
- Add explicit authorization, idempotency, post-write readback, drift detection, and durable redacted receipts for external actions.
- Keep credentials outside committed ADW artifacts and allow native connector, MCP, CLI, or API transports without coupling workflows to one transport.

## 0.1.0 release candidate - 2026-08-05

- Add one shared ADW skill tree for Codex and Claude Code.
- Add private marketplace manifests for both providers.
- Add schema-validated project, planning, approval, and validation artifacts.
- Add the plan, approval, execution, maintenance, and migration workflows.
