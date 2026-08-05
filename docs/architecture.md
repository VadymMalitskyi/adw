# Architecture

ADW is a private plugin repository with provider-specific packaging and one canonical workflow implementation.

```text
Codex manifest ─┐
                ├─> plugin/skills + schemas + templates + lib
Claude manifest ┘                    |
                                     v
                            initialized project
                     code branch + docs branch worktree
```

The plugin owns workflow instructions and deterministic mechanics. A target project owns only `adw.yaml`, bounded routing blocks, local ignored state, authoritative code documentation, and docs-branch context/change records.

## Boundaries

- Provider manifests contain packaging metadata only.
- `plugin/skills/` is the shared user interface.
- `plugin/lib/adw-helper.mjs` performs schema, digest, evidence, compatibility, and migration mechanics. It is not a public CLI.
- `src/helpers/` contains typed helper modules plus the canonical dependency-free runtime source; `npm run build:helper` reproduces the checked-in bundle exactly.
- `worktrees/docs` is the only ADW worktree. Feature implementation uses the project's normal code checkout and one branch.
- Git and files are the workflow database. ADW has no daemon, server, telemetry, or agent runtime.

## Trust model

Skills are operating instructions, not a security boundary. The active provider's sandbox and permissions remain authoritative. Repository content, plans, validation commands, review comments, and integration responses are untrusted input; none can grant authorization for writes or external effects.
