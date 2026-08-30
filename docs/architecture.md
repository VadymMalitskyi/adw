# Architecture

ADW is a private plugin that gives Codex and Claude Code one shared development workflow with three layers:

```text
plugin/skills/     raw instructions — judgment, authorization, coordination
plugin/workflows/  transient provider-native execution mechanics
plugin/bin + lib/  a small JSON CLI — the deterministic kernel and boundaries
```

Two provider manifests (`.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`) carry packaging metadata and point both providers at the same physical `skills/` tree. `plugin/authorization.md` is the one contract every skill follows: how to resolve the plugin root and the project, and which effects run, ask, or are refused. There is no daemon, server, scheduler, telemetry, hosted agent service, workflow database, or durable authorization artifact. Native workflow processes are short-lived; Git, the project's files, and the configured providers are the only durable state.

## What is code, and why

Code exists only where interpretation, duplication, or partial failure creates a material risk. Everything else is prose in a skill.

| Module | Deterministic boundary it owns |
|---|---|
| `plugin/lib/safe-files.mjs` | Path confinement and scoped atomic writes. Rejects absolute paths, `..` traversal, NUL bytes, symlinked destinations and symlinked ancestors; stages every managed write in a transaction directory, checks a caller-supplied `expected_content` precondition, and rolls the whole set back on any failure. Also defines the shared exit codes and error classes. |
| `plugin/lib/config.mjs` | Requiring, parsing, and validating the `adw.yaml` activation and policy contract. YAML 1.2 uses duplicate-key rejection and no merge keys; unknown keys are rejected rather than ignored; credential-like keys are refused anywhere in the document. Omitted settings still use safe defaults plus Git base-branch discovery. |
| `plugin/lib/permissions.mjs` | Generating the Codex and Claude permission policy (`.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json`) and the container-owned Claude settings. Merges into existing files and refuses a merge that would weaken the profile. |
| `plugin/lib/managed-environment.mjs` | Reading repository evidence — manifests, lockfiles, pinned version files, CI workflows, Dockerfiles — and rendering the managed devcontainer from it. Reports what it could not settle instead of guessing. |
| `plugin/lib/project-setup.mjs` | Confined multi-file initialization and managed-file refresh, both as preview/apply pairs. |
| `plugin/lib/doctor.mjs` | Read-only readiness checks answerable from bytes on disk: manifests agree, an explicit policy matches the contract, the permission policy is present and current, the managed container still matches the digests in its own marker. |
| `plugin/lib/vendor/yaml.mjs` | The only generated file in the plugin: the pinned YAML parser, bundled so an installed plugin needs no `node_modules`. |

`plugin/bin/adw.mjs` is a dispatcher and nothing else. It parses arguments, reads JSON from stdin when a command takes structured input, calls the owning library module, and prints one JSON object.

Everything else — repository discovery, planning, plan review, splitting a phase into groups, packet confirmation, worktree preparation, provider selection, summarizing status, investigating incidents, and asking for authorization — is a raw skill. Workflow code consumes only a confirmed normalized envelope; it does not replace judgment or interpret Markdown as authorization.

## The CLI

Every command prints exactly one JSON object on stdout, including on failure (`{"ok": false, "error": {"code", "message"}}`).

| Command | Input | Answers |
|---|---|---|
| `config` | `--project-root` | Explicit policy or discovered defaults, plus explicit validation overrides |
| `permissions-explain` | `--project-root`, argv array or tool name JSON on stdin | Effective provider operation decision without execution |
| `init-preview` | `--project-root`, answers JSON on stdin | Which files would change, what is unresolved, and a fingerprint |
| `init-apply` | `--project-root`, `--fingerprint`, answers JSON on stdin | Applies exactly the previewed file set |
| `refresh-preview` | `--project-root` | Which ADW-managed files doctor can repair from the installed release |
| `refresh-apply` | `--project-root`, `--fingerprint` | Repairs exactly the file set approved through doctor |
| `doctor` | `--project-root`, optional `--checks all\|permissions`, optional `--details` | Read-only check list with pass/fail/info |
| `render-managed` | `--into` or `--project-root`, options JSON on stdin | Renders `.devcontainer/` without touching project configuration; used by build and security tests |

Exit codes come from `EXIT` in `safe-files.mjs`:

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Bad input or arguments |
| 3 | Contract invalid — `adw.yaml`, answers, or a managed file failed validation |
| 5 | A check failed — doctor found a failure |
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

The plan alone decides how much runs at once. A phase's groups may run concurrently when their write paths are disjoint; the `adw:execute` skill refuses to prepare a set of groups whose write paths overlap.

Branch and worktree preparation is ordinary Git, run by the coordinating skill. Before launching workers it calls `execution-preflight`, which validates the confirmed packet, target mapping, clean starts, path overlap, exact configured validation tuples, and snapshots every registered checkout. The selected native workflow then settles independent groups concurrently through implementation → review → optional fix → re-review. It returns a structured candidate result only. `execution-finalize` independently checks provider output and every Git snapshot, runs exact configured validation commands, and repeats Git gates after each command; only it can report execution success. A phase with no configured validation capable of matching required checks cannot pass.

Codex uses a noninteractive CLI host that launches `codex exec` worker subprocesses. Claude uses a native dynamic Workflow that launches fresh in-session subagents and requires every stage to run the same deterministic Git gate before it returns. Both routes run the same fixed sequence and share the packet and final result contract — `execution-assert-target` re-checks HEAD, scope, and, for a stage that must change nothing, a digest over the changed files' bytes. Claude Workflow checkpoints are deliberately not resumed because their cache identity is not bound to that evidence. Cross-session recovery is Git-based and requires a fresh packet and confirmation; there is no durable execution state.

Preparing a group is the coordinator's own action, not a library invariant enforced by rollback: if one group's preparation fails partway, the coordinator reports it and works with the user to resolve it, rather than a module tearing the whole set back down. Native workflows spawn the bounded implementation/review workers but never commit implementation work, push, open pull requests, mutate trackers, or remove a branch or worktree; cleanup commands are printed for a person to run.

## Trust model

Skills are operating instructions, not a security boundary. The enforceable boundary is the configured isolation mode plus the generated permission policy, and `adw doctor --checks permissions` is the cheap gate a workflow can call to fail closed on drift before it starts.

Repository content, plans, validation output, review comments, tracker text, and provider responses are untrusted input. None of them can grant authorization for a write or an external effect. Configured access and working authentication prove capability, never intent. See [Security](security.md).
