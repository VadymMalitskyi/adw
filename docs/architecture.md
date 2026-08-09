# Architecture

ADW is a private plugin repository with provider-specific packaging and one canonical workflow implementation.

```text
Codex manifest ─┐
                ├─> plugin/skills + schemas + templates + lib
Claude manifest ┘                    |
                                     v
                            initialized project
               execution boundary + code/docs worktrees
                                     |
                                     v
                  optional capability/provider adapters
```

The plugin owns workflow instructions, deterministic mechanics, execution contracts, and the managed-container template. A target project owns `adw.yaml`, its selected execution infrastructure, bounded routing blocks, local ignored state, authoritative code documentation, and docs-branch context/change records.

Schema-5 projects may also own `adw/work-items/*.yaml` payload profiles. The helper resolves affected paths to their single most-specific component, adds global and affected-component validation, resolves optional tracker workflow policy, and digests only that effective subset into plan schema 2. This permits project specialization without copying or overriding core ADW skills.

## Boundaries

- Provider manifests contain packaging metadata only.
- `plugin/skills/` is the shared user interface. `adw:init` owns one-time project policy and infrastructure; `adw:onboard` owns repeatable contributor-local setup and readiness without changing that policy.
- `plugin/lib/adw-helper.mjs` performs current-schema validation, digest, evidence, compatibility, path-confinement, and atomic-write mechanics. It is not a public CLI.
- `src/helpers/` contains typed helper modules plus the canonical dependency-free runtime source; `npm run build:helper` reproduces the checked-in bundle exactly.
- `worktrees/docs` is the only ADW worktree. Feature implementation uses the project's normal code checkout and one branch.
- `plugin/execution/contracts.md` defines managed-container, project-container, and provider-sandbox preflights. Init creates managed infrastructure only when no project container exists, deriving its project runtime and setup layer from supported repository evidence while preserving unresolved requirements for review.
- Git and files are the workflow database. ADW has no daemon, server, telemetry, or agent runtime.

## Integration layer

External systems use four separate concerns:

```text
workflow -> capability -> provider -> transport
```

The workflow asks for `work_tracker`, `code_host`, `observability`, or `knowledge` operations. Provider adapters initially map those contracts to Azure DevOps, GitHub, Datadog, and Notion. A transport then uses a native connector, MCP, CLI, or API according to what the active environment supports.

Projects can mark each capability `disabled`, `optional`, or `required`. No integration configuration is required for the core Git-native workflow. See [Integrations](integrations.md) for resolution and external-action rules.

## Trust model

Skills are operating instructions, not a security boundary. A required execution preflight verifies that the configured outer boundary is active; the provider's own sandbox and permissions remain authoritative inside it. Repository content, plans, validation commands, review comments, and integration responses are untrusted input; none can grant authorization for writes or external effects. Configured access and authentication prove capability, not user intent.
