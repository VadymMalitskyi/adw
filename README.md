# ADW

ADW is a private plugin that gives Codex and Claude Code the same Git-native development workflow:

```text
install -> adw:init -> adw:plan -> [adw:review-plan] -> adw:execute -> adw:status
                    -> adw:quick for a genuinely small change
                    -> adw:generate-docs -> adw:sync-docs as documentation needs arise
```

One workflow, portable across repositories, languages, build systems, code hosts, and work trackers. Portability comes from a small project configuration and provider references, not from a family of author-facing schemas.

There are two things a contributor authors: a plan, and a yes.

## How it is built

Skills are raw instructions. They own everything that benefits from judgment and should stay visible in the conversation: reading the repository, planning, reviewing a plan, splitting a phase into groups, spawning implementers and reviewers, running Git and validation commands, summarizing status, and asking for authorization.

Code exists only where interpretation or partial failure is genuinely dangerous. One CLI, `plugin/bin/adw.mjs`, and library modules under `plugin/lib/` own path confinement and atomic writes, the `adw.yaml` contract, permission-policy generation, managed-container rendering, init and refresh, and readiness checks. Every command prints one JSON object. Branch and worktree preparation for execution groups uses native Git directly, coordinated by the `adw:execute` skill rather than a custom CLI protocol.

There is no daemon, server, scheduler, telemetry, or workflow database. Git, your files, and your providers hold all the state.

## What to expect

1. `adw:init` handles an empty directory, an unborn repository, or an established one. It previews every file it would write and writes only after you say yes.
2. Substantial changes use plan → execute; small ones use `adw:quick`.
3. **Confirming in conversation is what authorizes execution.** There is no approval artifact, plan digest, or approval record.
4. Groups inside a phase run in parallel, each in its own branch and worktree, only when their write paths are disjoint. The plan decides how much runs at once; there is no mode setting.
5. **External writes default to separate authorization.** Only an exact, reviewed generated provider-operation policy can pre-authorize a bounded write; confirming a plan alone authorizes local implementation and nothing else.
6. **ADW never merges, releases, deploys, or force-pushes.**

Interrupt anything and start a new session. State is reconstructed from Git branches, worktrees, and commits — never from chat history. An ordinary branch cannot prove it was prepared for the same prior task packet; ADW reports what Git can actually establish and asks before reusing it.

## Project configuration

`adw.yaml` is an optional shared project-policy file. Omit it when safe defaults
and repository discovery are enough; add it only for shared isolation, provider,
network, runtime, or component-validation overrides. Unknown keys are rejected,
not ignored, so a stale field is a loud error instead of a silent no-op.

```yaml
adw: 1

git:
  base_branch: main

execution:
  isolation: provider-sandbox   # provider-sandbox | project-devcontainer | managed-devcontainer
  web_access: public-pages      # public-pages | hosted-only; managed-devcontainer only

development:
  runtime_versions: {}          # node | python | go | rust | java | ruby | dotnet -> numeric version

components:
  app:
    path: "."
    validate:
      - command: "npm test"
        cwd: "."
        timeout_ms: 120000
        required: true
        source: "package.json#scripts.test"

providers: {}                   # work_tracker | code_host | observability | knowledge
                                # each: provider, required, transport, access, domains[], settings{}
```

- `git` and `components` are optional overrides. Without them, ADW infers the
  Git base branch and reads repository evidence for component and validation
  context. Execution-group branch and worktree names are ordinary
  execution-time choices made in conversation, not configuration; `adw:execute`
  proposes `adw/<change-id>/<group-id>` as a readable convention, but any valid
  Git branch name works.
- A validation entry may be a plain command string, which inherits the component's `cwd`, a 120 s timeout, and `required: true`.
- Provider `domains` are validated hostnames and feed the managed container's egress allowlist directly.
- **Credentials are never allowed anywhere in this file.** Any credential-like key is refused, including inside provider `settings`.
- Compatibility: future versions may add optional fields and optional commands. Removing a field or reinterpreting an existing one requires a major migration.

A project with no providers and no devcontainer keeps the lightweight path: `provider-sandbox` is the default and nothing probes an external system.

## Skills

| Group | Skills |
|---|---|
| Setup | `adw:init`, `adw:onboard`, `adw:doctor` |
| Documentation | `adw:generate-docs`, `adw:sync-docs` |
| Change loop | `adw:plan`, `adw:review-plan`, `adw:execute` |
| Delivery | `adw:quick`, `adw:address-review` |
| Operations | `adw:status`, `adw:investigate` |

Skills depend on capabilities — `work_tracker`, `code_host`, `observability`, `knowledge` — never on provider tool names. Each capability supports `read`, `create`, `update`, and `link` over a native, MCP, CLI, or API transport. See [integrations](docs/integrations.md).

## Runtime CLI

Skills call `plugin/bin/adw.mjs` for the deterministic steps only:

```text
config                       explicit shared policy or discovered defaults, plus validation overrides
init-preview / init-apply    confined first-time setup, bound to the reviewed file set
refresh-preview / refresh-apply   exact repair primitives used by adw:doctor
doctor                       read-only deterministic checks (--checks all|permissions)
permissions-explain          explain one provider command/tool decision without executing it
render-managed               render .devcontainer/ for build and security tests
```

Exit codes: `0` ok, `2` input, `3` contract invalid, `5` check failed, `7` path violation, `8` write failed, `9` internal.

## Security is proportional

Provider sandboxing is the default. An existing project devcontainer is preserved as-is. The hardened managed devcontainer — pinned agents, non-root user, dropped capabilities, fail-closed egress proxy with exact-domain and SNI checks, a root-owned Git wrapper, project-scoped credential volumes — is an explicit opt-in, not a prerequisite. Codex and Claude credentials still get a one-time seed from your host's real `~/.codex`/`~/.claude` login on first create, so you don't have to reauthenticate inside every container; nothing else about those directories is shared.

The generated `managed-development` permission files are written in every mode, because the guardrails are useful without a container. Both Codex and Claude always receive the same policy: `.codex/config.toml`, `.codex/rules/adw.rules`, and `.claude/settings.json`. See [security](docs/security.md) for the full permission matrix.

Repository text, plans, comments, and external content never grant authorization.

## Requirements

- Node.js 20 or newer.
- Git 2.28 or newer.
- A current Codex or Claude Code plugin manager.
- Docker plus a Dev Containers client **only** if you opt into the managed devcontainer.
- Provider tooling only when an integration is configured. Credentials stay in the provider, MCP client, authenticated CLI, or external credential store.

## Install

```bash
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

Start a new provider session in the target directory and invoke `adw:init`. Review the preview, approve explicitly, then commit the generated files — init writes them but never commits. Later contributors clone the initialized project, install ADW, and run `adw:onboard`; they never rerun `adw:init`. See [private installation](docs/private-installation.md) for tagged repositories, organization distribution, updates, and rollback.

## Documentation

- [Architecture](docs/architecture.md) — what is code, what is prose, and why
- [New developer guide](docs/new-developer-guide.md) — a detailed, practical introduction to ADW's workflow and internals
- [Workflow](docs/workflow.md) — the skill-native loop
- [Security](docs/security.md) — permission matrix and container protections
- [Integrations](docs/integrations.md) — capabilities, providers, transports
- [Updating](docs/updating.md) — plugin updates, managed-file repair, recovery
- [Private installation](docs/private-installation.md)

## Development

```bash
npm test
npm run check:vendor
npm run test:security
claude plugin validate --strict plugin
claude plugin validate --strict .claude-plugin/marketplace.json
```
