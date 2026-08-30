# Changelog

All notable changes to this private plugin are documented here.

## Unreleased

### Exhaustive documentation now uses independent agent waves

- `adw:generate-docs` no longer lets one context research, write, and certify a
  nontrivial repository. Parallel read-only researchers produce component
  dossiers before approval; disjoint page owners write after approval;
  architecture and the code map are synthesized last; and fresh source,
  workflow, onboarding, and prose reviewers require corrections until material
  findings are gone.
- Completeness explicitly wins over token cost, tool calls, agent turns,
  document length, and speed. Broad components must split, code-map rows use
  exact section anchors, and hard anti-compression floors replace the 1.2.9
  thresholds that real output treated as finish lines.
- Version bumped to 1.3.0 so provider caches load the multi-agent workflow.

### Documentation depth is now verified

- `adw:generate-docs` inventories domain concepts, state, major workflows,
  boundaries, extension points, and failure paths before proposing files. It
  requires end-to-end code walkthroughs, component maintenance examples where
  evidence supports them, and an onboarding review that catches checklist-only
  pages without imposing arbitrary line-count quotas.
- Generated sets now open with a quick repository orientation, build a
  systematic learning path, cover every material evidence-backed inventory
  item, and use simple, engaging prose with explicit anti-fluff rules.
- Documentation must stand alone as the project's complete introduction. Source
  references support verification and later implementation work but cannot
  replace detailed explanations or force a newcomer to read code to fill gaps.
- After a real 1.2.8 generation still compressed a multi-runtime project into
  3,051 words, the coverage inventory became a visible approval contract and
  `docs/code-map.md` became a required source-to-explanation audit. Component
  code tours, matching discovered/documented totals, and complexity-based depth
  review triggers prevent heading-only compliance.
- Version bumped to 1.2.9 so provider caches load the enforceable coverage pass.

### ADW activation is explicit

- Codex and Claude can no longer invoke ADW skills implicitly. Installing the
  plugin leaves ordinary agent requests on the agent's normal workflow until a
  person explicitly invokes an ADW skill.
- `adw:init` now always creates `adw.yaml`, with `adw: 1` as the minimal
  contract. Every other ADW workflow requires that committed activation marker
  and stops with an initialization instruction when it is absent.

### Managed development is now the recommended default

- `adw:init` now creates a managed devcontainer by default. It preserves an
  existing project-owned devcontainer, and provider sandboxing remains an
  explicit lightweight alternative.
- Managed containers now provide container-local Codex and Claude Code status
  lines with context, limits, token usage, and other session details. Host UI
  settings and session state remain isolated.
- Version bumped to 1.2.0.

### Documentation and plans moved to their own branch

- `adw.yaml` gained an optional `docs` section with `branch` and `worktree`.
  Defaults are branch `docs` at `worktrees/docs`. The worktree must stay under
  `worktrees/`, the one path ADW keeps ignored on the base branch, and the
  branch must differ from `git.base_branch`.
- `adw:init` now creates the `worktrees/` directory, creates the documentation
  branch as an orphan with a single README commit, and attaches its worktree.
  Both are part of the reviewed preview and are bound by its fingerprint. An
  existing branch is reused and an already-attached worktree is left alone; a
  foreign directory at the worktree path is refused.
- `adw:plan` now writes every plan to
  `<docs.worktree>/plans/<YYYY-MM-DD>-<abbreviation>-<short-description>.md`
  instead of only returning it in conversation. A plan file still authorizes
  nothing.
- `adw:generate-docs` produces a full documentation set rather than the
  smallest useful baseline, and writes it to the documentation branch. Verified
  claims and interpretation are now both allowed, but must be visibly
  separated: interpretation carries an explicit label. `adw:sync-docs` audits
  that branch against code history and keeps those labels intact.
- `adw:doctor` reports the documentation branch and whether it is checked out
  at its configured worktree. It never creates or attaches either.
- Version bumped to 1.1.0.

- The C# extension's runtime redirect now points at `/usr/share/dotnet/dotnet`, the
  `DOTNET_ROOT` the devcontainer .NET feature actually installs into. The previous
  path did not exist, so the extension silently ignored it and fell back to a
  firewall-blocked download.
- Version bumped to 1.0.1. The plugin cache is keyed by version, so a pinned version
  string leaves every already-populated cache — including the one inside each managed
  container's `adw-claude-*` volume — serving stale bytes after an update.

### Simplified to a deterministic kernel plus raw skills

ADW now keeps code only where interpretation or partial failure is genuinely
dangerous. Everything that benefits from judgment is a raw skill again.

- One `adw:init` skill replaces `adw:init-greenfield` and `adw:init-brownfield` and
  handles an empty directory, an unborn repository, and an established project.
- Removed the `adw:approve`, `adw:amend`, `adw:discover`, and `adw:sync-docs` skills.
  Confirming in conversation authorizes execution; repository discovery folded into
  `adw:init` and `adw:plan`.
- Removed the docs branch, docs worktree, `SYNC.yaml`, canonical
  `changes/<id>/plan.md` storage, `approval.json` and approval history, plan digests,
  phase run records, the project-owned plan-template registry, `.adw/local.yaml`,
  `.adw/preferences.md`, and generated routing blocks in `AGENTS.md`/`CLAUDE.md`.
  Git, the provider's own objects, and the conversation are the record.
- Replaced every skill script and the generated `plugin/lib/adw-helper.mjs` bundle
  with one JSON CLI, `plugin/bin/adw.mjs`, over seven handwritten library modules.
  `plugin/lib/vendor/yaml.mjs` is now the only generated file, and an installed
  plugin runs without `node_modules`.
- `npm run build:vendor` / `check:vendor` replace `build:helper` / `check:helper`.

### Project contract

- `adw.yaml` keeps only `git`, `execution`, `development`, `components`, and
  `providers`. Project conventions remain in repository-owned instructions
  instead of being duplicated in ADW configuration. `docs`, `planning`,
  `execution.mode`, and `conventions` are removed; a stale
  field is now a loud validation error rather than a silent no-op.
- Provider declarations gained a validated `domains` list, which feeds the managed
  container's egress allowlist directly.
- Future versions may add optional fields and commands; removing a field or
  reinterpreting one requires a major migration.

### Doctor owns setup repair

- `adw:doctor` now classifies setup findings, previews exact repairs for
  ADW-managed permission, ignore, and devcontainer files, applies them only after
  approval, and reruns its checks.
- Removed the separate `adw:update` skill. Its deterministic
  `refresh-preview`/`refresh-apply` commands remain as doctor's byte-bound repair
  mechanism.

### Permissions and the managed container

- Pushing, tag creation, branch deletion, worktree removal, rebase, and merge now
  ask the user in both providers instead of being auto-allowed.
- `git worktree add` is now allowed automatically once execution is confirmed,
  matching native Git preparation instead of a dedicated CLI command.
- A managed container always carries both Codex and Claude, so the per-agent
  `agent_tools` profile is gone and the marker is schema 3.
- The generated managed file set no longer includes `project-requirements.md`.

### Execution mechanics simplified to native Git

- `git.branch_template` is removed from `adw.yaml`; `git` now supports only
  `base_branch`. Branch and worktree names for execution groups are ordinary
  execution-time choices proposed and confirmed in conversation, not shared
  configuration.
- Removed `plugin/lib/worktrees.mjs` and the `worktree-preview`,
  `worktree-prepare`, `worktree-inspect`, and `worktree-cleanup-guidance` CLI
  commands. `adw:execute` now inspects `git worktree list` and `git show-ref`
  directly and prepares groups with `git worktree add`.
- Prepared branches no longer carry an empty marker commit or a packet digest.
  `adw:status` and a resumed `adw:execute` report only what Git can actually
  establish about a branch — its commits, merge base, and worktree attachment —
  and no longer claim a branch can be proven to match an earlier task packet.

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
