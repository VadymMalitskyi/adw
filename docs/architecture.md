# Architecture

ADW is a private plugin that gives Codex and Claude Code one shared development workflow. It has two parts and no third:

```text
plugin/skills/     raw instructions — reasoning, coordination, conversation
plugin/bin + lib/  a small JSON CLI — the deterministic boundaries only
```

Two provider manifests (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) carry packaging metadata and point both providers at the same physical `skills/` tree. `plugin/authorization.md` is the one contract every skill follows: how to resolve the plugin root and the project, and which effects run, ask, or are refused. There is no daemon, server, scheduler, telemetry, agent runtime, workflow database, or artifact framework. Git, the project's files, and the configured providers are the only state.

## What is code, and why

Code exists only where interpretation, duplication, or partial failure creates a material risk. Everything else is prose in a skill.

| Module | Deterministic boundary it owns |
|---|---|
| `plugin/lib/safe-files.mjs` | Path confinement and scoped atomic writes. Rejects absolute paths, `..` traversal, NUL bytes, symlinked destinations and symlinked ancestors; stages every managed write in a transaction directory, checks a caller-supplied `expected_content` precondition, and rolls the whole set back on any failure. Also defines the shared exit codes and error classes. |
| `plugin/lib/config.mjs` | Parsing and validating `adw.yaml`. YAML 1.2 with duplicate-key rejection and no merge keys; unknown keys are rejected rather than ignored; credential-like keys are refused anywhere in the document. Normalizes and deduplicates validation commands and provider domains. |
| `plugin/lib/permissions.mjs` | Generating the Codex and Claude permission policy (`.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json`) and the container-owned Claude settings. Merges into existing files and refuses a merge that would weaken the profile. |
| `plugin/lib/managed-environment.mjs` | Reading repository evidence — manifests, lockfiles, pinned version files, CI workflows, Dockerfiles — and rendering the managed devcontainer from it. Reports what it could not settle instead of guessing. |
| `plugin/lib/project-setup.mjs` | Confined multi-file initialization and managed-file refresh, both as preview/apply pairs. |
| `plugin/lib/doctor.mjs` | Read-only readiness checks answerable from bytes on disk: manifests agree, `adw.yaml` matches the contract, the permission policy is present and current, the managed container still matches the digests in its own marker. |
| `plugin/lib/worktrees.mjs` | Validating parallel execution-group packets and preparing resumable branch/worktree state. Enforces disjoint write paths between concurrent groups and writes a durable marker commit. |
| `plugin/lib/vendor/yaml.mjs` | The only generated file in the plugin: the pinned YAML parser, bundled so an installed plugin needs no `node_modules`. |

`plugin/bin/adw.mjs` is a dispatcher and nothing else. It parses arguments, reads JSON from stdin when a command takes structured input, calls the owning library module, and prints one JSON object.

Everything else — repository discovery, planning, plan review, splitting a phase into groups, spawning implementers and reviewers, running Git and validation commands, summarizing status, investigating incidents, choosing and invoking providers, asking for authorization — is a raw skill. Those steps benefit from model judgment and stay observable to the user in conversation; wrapping them in scripts would make them opaque without making them safer.

## The CLI

Every command prints exactly one JSON object on stdout, including on failure (`{"ok": false, "error": {"code", "message"}}`).

| Command | Input | Answers |
|---|---|---|
| `config` | `--project-root` | Validated `adw.yaml` plus the resolved validation-command list |
| `init-preview` | `--project-root`, answers JSON on stdin | Which files would change, what is unresolved, and a fingerprint |
| `init-apply` | `--project-root`, `--fingerprint`, answers JSON on stdin | Applies exactly the previewed file set |
| `refresh-preview` | `--project-root` | Which ADW-managed files doctor can repair from the installed release |
| `refresh-apply` | `--project-root`, `--fingerprint` | Repairs exactly the file set approved through doctor |
| `doctor` | `--project-root`, optional `--checks all\|permissions`, optional `--details` | Read-only check list with pass/fail/info |
| `worktree-preview` / `worktree-inspect` | group request JSON on stdin | Per-group state, planned action, and blockers |
| `worktree-prepare` | group request JSON on stdin | Creates or attaches each group's branch and worktree |
| `worktree-cleanup-guidance` | group request JSON on stdin | The exact commands a person may run to remove them |
| `render-managed` | `--into` or `--project-root`, options JSON on stdin | Renders `.devcontainer/` without touching project configuration; used by build and security tests |

Exit codes come from `EXIT` in `safe-files.mjs`:

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Bad input or arguments |
| 3 | Contract invalid — `adw.yaml`, answers, or a managed file failed validation |
| 5 | A check failed — doctor found a failure, or a worktree group is blocked |
| 7 | Path violation |
| 8 | Write failed, and the transaction was rolled back |
| 9 | Internal error |

## Preview and apply

Only two operations write more than one managed file at a time, and both are split. Doctor owns the refresh pair's user-facing repair workflow:

```text
init-preview   ─┐                    ┌─> the user reads the summary and says yes
refresh-preview ┘ ─ fingerprint ──>  └─> init-apply / refresh-apply --fingerprint
```

The preview computes the exact before/after bytes of every file it would touch and returns a SHA-256 fingerprint over them. Apply recomputes the plan and refuses unless it is handed that same fingerprint back, so a changed answer, a changed repository, a changed template, or a changed target file stops the write instead of silently applying a different set. The fingerprint is internal plumbing between a skill's two calls — nobody is asked to read, copy, or retype it. The bytes themselves never leave the runtime; the skill receives only the summary.

Apply then writes through `applyAtomicWrites`, which additionally requires each destination to still hold its previewed `before` content.

## Parallel execution

The plan alone decides how much runs at once. A phase's groups may run concurrently when their write paths are disjoint; `worktrees.mjs` refuses to prepare a set that overlaps, unless every overlapping path is declared shared.

Each prepared group gets its own branch and its own worktree under `worktrees/<change-id>/<group-id>`, created from an explicit base commit and opened with an empty marker commit whose trailers record the change id, group id, base branch, base commit, and a digest of the interpreted task packet. A later session reconstructs execution state from Git alone: a branch is reused only when every trailer still matches and the marker commit still sits directly on the same base. Preparation is all-or-nothing — a failed group is torn back down so the coordinator can retry deterministically.

The module never spawns agents, implements tasks, commits implementation work, pushes, opens pull requests, or mutates trackers. It also never removes a branch or worktree; `worktree-cleanup-guidance` prints the commands and a person runs them.

## Trust model

Skills are operating instructions, not a security boundary. The enforceable boundary is the configured isolation mode plus the generated permission policy, and `adw doctor --checks permissions` is the cheap gate a workflow can call to fail closed on drift before it starts.

Repository content, plans, validation output, review comments, tracker text, and provider responses are untrusted input. None of them can grant authorization for a write or an external effect. Configured access and working authentication prove capability, never intent. See [Security](security.md).
