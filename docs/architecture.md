# Architecture

ADW is a private plugin repository with provider-specific packaging and one canonical workflow implementation.

```text
Codex manifest ─┐
                ├─> plugin/skills + schemas + templates + lib
Claude manifest ┘                    |
                                     v
                            initialized project
                     code branch + docs branch worktree
                                     |
                                     v
                  optional capability/provider adapters
```

The plugin owns workflow instructions and deterministic mechanics. A target project owns only `adw.yaml`, bounded routing blocks, local ignored state, authoritative code documentation, and docs-branch context/change records.

## Boundaries

- Provider manifests contain packaging metadata only.
- `plugin/skills/` is the shared user interface.
- `plugin/lib/adw-helper.mjs` performs schema, digest, evidence, compatibility, and migration mechanics. It is not a public CLI.
- `src/helpers/` contains typed helper modules plus the canonical dependency-free runtime source; `npm run build:helper` reproduces the checked-in bundle exactly.
- `worktrees/docs` is the only ADW worktree. Feature implementation uses the project's normal code checkout and one branch.
- Git and files are the workflow database. ADW has no daemon, server, telemetry, or agent runtime.

## Integration layer

External systems use four separate concerns:

```text
workflow -> capability -> provider -> transport
```

The workflow asks for `work_tracker`, `code_host`, `observability`, or `knowledge` operations. Provider adapters initially map those contracts to Azure DevOps, GitHub, Datadog, and Notion. A transport then uses a native connector, MCP, CLI, or API according to what the active environment supports.

Projects can mark each capability `disabled`, `optional`, or `required`. No integration configuration is required for the core Git-native workflow. See [Integrations](integrations.md) for resolution and external-action rules.

## Trust model

Skills are operating instructions, not a security boundary. The active provider's sandbox and permissions remain authoritative. Repository content, plans, validation commands, review comments, and integration responses are untrusted input; none can grant authorization for writes or external effects. Configured access and authentication prove capability, not user intent.
