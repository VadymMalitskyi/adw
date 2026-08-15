# Architecture

ADW is a private plugin repository with provider-specific packaging and one canonical workflow implementation.

```text
Codex manifest ─┐
                ├─> plugin/skills + templates + execution + integrations + lib
Claude manifest ┘                    |
                                     v
                            initialized project
               isolation boundary + code/docs/group worktrees
                                     |
                                     v
                  optional capability/provider adapters
```

The plugin owns workflow instructions, deterministic mechanics, execution contracts, and the optional managed-container template. A target project owns `adw.yaml`, its selected isolation infrastructure, bounded routing blocks, local ignored state, authoritative code documentation, and docs-branch context and change records.

Complexity is deliberately spent on execution safety and resumability, not on authoring bureaucracy. There is one handwritten project contract, one canonical plan, and two small machine records — no artifact registry, schema-version dispatch, policy digest, or payload profile.

## Boundaries

- Provider manifests contain packaging metadata only.
- `plugin/skills/` is the shared user interface, and both providers resolve the same physical skill tree. `adw:init-greenfield` establishes a new project's first reviewed contract and Git state; `adw:init-brownfield` adopts an established repository without redesigning it. Both use the deterministic mechanics under `plugin/initialization/`. `adw:onboard` owns repeatable contributor-local setup and readiness without changing shared policy.
- `plugin/lib/adw-helper.mjs` performs handwritten contract validation, digests, approval records, run records, validation processes, path confinement, and atomic writes. It is not a public CLI.
- `plugin/execution/orchestrator.mjs` performs deterministic Git mechanics only: preview, prepare, inspect, and cleanup guidance for group branches and worktrees. It never spawns agents, commits implementation, pushes, opens pull requests, or mutates trackers, and it never deletes a branch or worktree.
- `src/helpers/runtime-bundle.mjs` is the single canonical helper implementation. `npm run build:helper` uses esbuild to include its one pinned dependency — a YAML 1.2 parser with duplicate-key rejection — in the checked-in, self-contained Node 20 bundle; `npm run check:helper` verifies exact reproducibility. The generated bundle is never hand-edited.
- `plugin/execution/contracts.md` defines the managed-container, project-container, and provider-sandbox preflights.
- Git and files are the workflow database. ADW has no daemon, server, scheduler, telemetry, or agent runtime.

## Coordination model

The active Codex or Claude Code agent is the coordinator. ADW introduces no separate agent service.

```text
plan.md  ──approval──>  coordinator  ──orchestrator──>  group branch + worktree
                             |                                    |
                             |  native subagents                  |
                             v                                    v
                 implementation -> review -> validation     run record
```

Deterministic scripts handle Git worktrees, paths, digests, validation processes, and run records. Native provider subagent capabilities — Codex collaboration agents, Claude Code Agent tasks — handle reasoning and code work. No model product name appears in a skill; risk-based effort is requested in the active provider's own language. If native subagents are unavailable, orchestrated execution stops and offers sequential fallback only after the user agrees.

Each group is prepared with a durable empty marker commit carrying the change, phase, group, base branch, base commit, plan digest, and interpreted-packet digest as trailers. A later session therefore reconstructs execution state from Git alone, and a branch is reused only when every trailer and the parent commit still match.

## Parallelism

Phases are dependency barriers. Every group within a phase runs concurrently, and a group belongs in that phase only when its affected write paths are disjoint from its siblings'. The plan is the only thing that decides how much runs at once: there is no configured parallelism limit, because a machine's capacity is not a property of the design. Overlap that the plan does not explain through a shared contract group in an earlier phase is a blocking defect — `adw:review-plan` reports it, and the orchestrator refuses to prepare it.

## Integration layer

External systems use four separate concerns:

```text
workflow -> capability -> provider -> transport
```

The workflow asks for `work_tracker`, `code_host`, `observability`, or `knowledge`, in terms of four operations: `read`, `create`, `update`, `link`. Provider adapters map those to real systems; a transport then uses a native connector, MCP, CLI, or API according to what the active environment supports. No provider field model reaches the canonical plan format.

Projects declare each capability with `required: true` or `required: false`, or omit it entirely. No provider configuration is required for the core Git-native workflow. See [Integrations](integrations.md).

## Trust model

Skills are operating instructions, not a security boundary. A required execution preflight verifies that the configured outer boundary is active; the provider's own sandbox and permissions remain authoritative inside it. Repository content, plans, validation commands, review comments, and provider responses are untrusted input; none can grant authorization for writes or external effects. Configured access and authentication prove capability, not user intent.
