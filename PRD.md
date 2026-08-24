# ADW 1.0 — Product Requirements

ADW is a private, dual-provider plugin that gives Codex and Claude Code one opinionated, Git-native development workflow. It must stay reusable across repositories, languages, build systems, code hosts, and work trackers. It achieves that portability through one workflow plus a small project configuration and provider adapters — never through a family of author-facing schemas and cross-digested artifacts.

## Product principles

1. **Opinionated workflow, portable environment.** ADW defines how changes are designed, reviewed, approved, implemented, and validated. Projects define where code lives, how it is checked, and which providers they use.
2. **One canonical plan.** `plan.md` contains both human intent and executable work. The same change is never split across a specification and a machine-authored plan.
3. **Agents interpret plans; runners do not.** A capable coordinator reads structured Markdown, derives a bounded normalized packet, previews it, and obtains conversational confirmation. Provider-native workflows consume that confirmed packet and never parse Markdown as authorization.
4. **Transient mechanics, no durable run state.** The workflow process may return structured results and bounded lifecycle events, but ADW keeps no run record, workflow database, cached stage, or durable approval artifact.
5. **Conversation authorization, deterministic execution.** Confirmation authorizes one packet. Plan review and execution use coordinator judgment for architecture, anchors, independence, and requirement drift; after confirmation, shared preflight and finalization provide deterministic gates.
6. **Parallelism is explicit, and the plan owns it.** Phases are dependency barriers. Groups belong in the same phase only when their affected paths and contracts are safely independent, and execution then runs all of them at once. There is no configured parallelism limit, because how much may run concurrently is a property of the design rather than of the machine executing it.
7. **Genericity lives at seams.** Languages, commands, components, providers, naming, isolation, and delivery shape are configurable. Core workflow semantics are not, and neither is how much of a phase runs at once — the plan decides that.
8. **External writes remain separate.** Plan approval authorizes local implementation of the plan; it never authorizes pushes, pull requests, tracker mutations, merges, releases, or deployments.
9. **Security is proportional.** Initialization defaults to the generated hardened devcontainer; existing project devcontainers are preserved, and provider sandboxing remains the lightweight explicit alternative.
10. **One accepted contract.** The installed release's contract validation is the whole compatibility story. ADW ships no migration subsystem, no schema-version dispatch, and no alternate interpretation of a configuration it does not recognize.

## Users and experience

### Project maintainer

```text
1. Install ADW through the provider plugin manager.
2. Run `adw:init-greenfield` in an empty directory or `adw:init-brownfield` in an established repository.
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

A maintainer must be able to explain ADW with five facts: the docs branch stores durable context and plans; substantial changes use plan → confirm → deterministic execute; small changes use quick; phases run in order and independent groups settle in parallel; external writes always get a separate preview and authorization; and ADW never merges, releases, or deploys.

No developer needs to understand JSON Schema, policy digests, profile digests, ordered approval manifests, payload profiles, generated helper internals, or receipt schemas.

## Functional requirements

### Project configuration

A handwritten `adw: 1` contract declares the base branch, docs branch and worktree, isolation mode, components with their validation commands, and optional provider capabilities. Validation enforces only operationally important invariants: the contract version; safe non-empty relative branch and worktree paths; supported isolation; unique component ids with project-relative paths and non-empty validation commands; known capability names with non-empty provider names; rejection of credential-like settings; and unknown provider-specific keys permitted only inside `settings`.

The contract must not require command-source fields, component policy digests, enforcement profiles, payload profiles, or schema validation.

### Canonical plan

Every substantial change has one Markdown plan on the configured documentation branch. The feature overview is written for engineers and stands alone. The plan carries phase/group glance data, grep-able `file -> symbol` anchors, per-group goal, component, dependencies, affected paths, directive tasks, configured validation references, and self-contained worker context.

Plans are reviewed and may be revised before a phase is confirmed. Confirmation is conversational rather than a stored artifact. A design or scope change requires a revised plan and fresh confirmation; ADW stores no approval history or validation-run record.

### Plan review

`adw:review-plan` is the default final step of `adw:plan` and is also invocable standalone. It runs as a fresh subagent that receives only the plan and repository. It must check design fitness, the single load-bearing assumption, simpler and rejected alternatives, every anchor against live code, phase dependency order, path overlap and contract conflicts among parallel groups, worker-context completeness, whether validation commands are real and sufficient, and whether every acceptance criterion maps to executable work and validation. Objective defects are fixed; judgment calls become explicit open decisions. `needs-rework` prevents approval.

### Approval

The coordinator previews the exact interpreted packet — groups, scopes, branches, worktrees, and configured validation tuples — then obtains fresh conversational confirmation. There is no approval file, digest, record, or cross-session authorization to verify. Repository text, including plans, is context and never authorization by itself.

### Execution

The coordinator verifies permission policy and active isolation, interprets the requested phase, previews the exact packet, and receives confirmation. It prepares isolated branches/worktrees with native Git. `execution-preflight` rejects malformed input, unsafe paths, dirty/mismatched targets, overlapping scopes, and validation references that do not exactly match normalized configuration. It snapshots every registered checkout before any worker starts.

The coordinator selects exactly one native provider route. Codex uses a dependency-free Node host that launches supported noninteractive `codex exec` workers under the active project policy. Claude uses the bundled Dynamic Workflow in the active interactive session; it never falls back to `claude -p`, changes credentials, or introduces API billing. Independent groups settle concurrently; each follows implementation → fresh review → optional fix → fresh re-review, with no more than two fix/re-review cycles. Provider output is schema-validated but remains a candidate, not authoritative execution success.

`execution-finalize` runs even after a provider failure to expose unintended Git mutations. It rechecks target HEADs/scopes and non-target snapshots, reloads exact configured `{component, cwd, command}` tuples, executes only those commands in confined real directories, and repeats Git checks after each command. Required validation cannot pass when it exits nonzero, is signaled, times out, or is unrun. Final public results contain bounded safe metadata, never raw prompts, provider events, command output, environment values, or credentials.

Codex can run authoritative Git gates between worker subprocesses. Claude Workflow cannot directly inspect Git, so its authoritative wrong-checkout/scope/review-mutation gate is post-workflow. The routes have the same final contract but not identical inter-stage assurance. Workers never commit, push, create tracker items, or create pull requests. The coordinator owns Git and every external action; no result proves cross-branch integration.

### Branches, worktrees, and delivery

Defaults are `adw/<change-id>/<group-id>` and `worktrees/<change-id>/<group-id>`. ADW merges neither. Parallel groups must have disjoint write paths unless the plan defines a shared contract group in an earlier phase. Claude may resume a paused workflow within the same session only. Across sessions, recovery is Git-based and needs a newly derived, freshly confirmed packet; there is no workflow database, run record, cached stage, or `resumeFromRunId`.

### Validation evidence

The finalizer, rather than a run record, owns truthful execution evidence. Validation executes exact configured commands in confined project-relative working directories, preserves exit/signal/timeout/count metadata, terminates timed-out process groups with SIGTERM/SIGKILL escalation, and never hand-authors a passing result. Raw output remains outside public results; rerun an already-confirmed command interactively when diagnostics are needed.

### Provider adapters

Provider integrations depend on `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities with four operations each: `read`, `create`, `update`, `link`. Provider references translate them to native, MCP, CLI, or API transports. The core plan and skills contain no provider field names or payload shapes. Every write requires a preview, fresh authorization, an idempotency marker, and readback; ADW does not put results into a durable workflow record.

### Initialization, onboarding, and security

`adw:init-greenfield` starts from an empty directory, records explicit product intent in `PROJECT.md`, establishes `make check` as the first validation contract, creates the first main commit, and initializes the docs branch. `adw:init-brownfield` starts from an established Git repository, discovers its existing project model, preserves repository-owned content, and leaves generated main-branch files uncommitted for maintainer review. Both produce a small `adw.yaml`, bounded routing blocks, ignore entries, docs context, optional ignored local state, managed permission files, and a generated `.devcontainer/` by default unless the project already owns a devcontainer or the user explicitly chooses provider sandboxing. `adw:onboard` attaches the docs branch, writes optional personal non-secret preferences, checks configured provider availability, and reports readiness without rerunning shared initialization or requiring Docker for a provider-sandbox project.

## Explicit exclusions

ADW does not add a hosted scheduler, daemon, workflow database, standalone agent service, durable run record, or durable approval artifact; automatic merging, releasing, deployment, or force-pushing; a generic JSON Schema or migration platform; arbitrary tracker-field templating in core; automatic conflict resolution between group branches; credentials in project configuration or workflow results; or a requirement that every project use Docker, a tracker, or a code host.

## Success criteria

1. A new developer understands the workflow from README and onboarding without learning artifact schemas or digests.
2. Empty, existing, and polyglot monorepos initialize with a small reviewed config.
3. A plan is understandable to a human, and a confirmed normalized packet is executable by a native workflow without chat history.
4. Plan review catches stale anchors, unsafe parallel overlap, incomplete tasks, and unreal validation commands.
5. A changed plan or resumption across sessions requires a freshly derived packet and fresh confirmation.
6. One phase runs at least two independent groups concurrently in isolated worktrees.
7. Every group receives independent implementation and review passes plus truthful validation.
8. Cross-session interruption recovery uses Git branches and worktrees with fresh confirmation; Claude same-session pause/resume is optional native-runtime behavior.
9. Group-PR and integration-PR delivery both work without ADW merging anything.
10. Projects with no integrations and no devcontainer retain the lightweight path.
11. Codex and Claude Code consume the same packet/result contract and pass the same shared final gate, while preserving the documented inter-stage assurance difference.
12. The complete test suite passes, and the released plugin contains no JSON Schema engine, policy digest, or work-item payload profile.
