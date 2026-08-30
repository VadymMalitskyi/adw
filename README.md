# ADW

**Agentic Development Workflow** — a hardened sandbox, your tools wired in, and one Git-native change loop. Shared by Codex and Claude Code.

```text
adw:init   →  generates a locked-down devcontainer + permission policy from your repo
           →  connects your tracker, code host, observability, and docs by capability

adw:plan   →  adw:review-plan  →  you say yes  →  adw:execute  →  adw:status
```

There are only two things you author: **a plan, and a yes.**

---

## What you get on day one

### 🔒 A hardened sandbox you didn't have to build

`adw:init` **generates a complete hardened devcontainer for you** — read from your actual manifests, lockfiles, and CI files, not from a template you fill in. No project has to design its own agent jail.

Inside it, the agent runs **non-root** with `--cap-drop=ALL` (five capabilities back, no `SYS_ADMIN`/`SYS_PTRACE`/`NET_RAW`). All egress goes through a **fail-closed proxy** that requires port 443, an *exact* hostname from a root-owned allowlist, and a TLS ClientHello whose SNI matches — no wildcards, no IP literals, no IPv6, and it refuses to start if the allowlist is empty. A root-owned `git` wrapper rejects force pushes and branch deletions before they reach real Git. Nothing mounts your host home, `~/.ssh`, cloud credentials, or the Docker socket; agent credentials live in project-scoped named volumes, seeded once from a read-only staging mount so you don't reauthenticate in every container. Agent versions are pinned and auto-update is off, and `.devcontainer/adw-managed.json` records SHA-256 digests of every generated control so `adw:doctor` catches drift.

Don't want a container? The generated permission policy is written in **every** mode — the guardrails are useful on a bare host too.

### 🔌 Your tools, wired in by capability

Declare a provider in `adw.yaml` and skills can read your tracker, your code host, your observability data, and your knowledge base:

```yaml
providers:
  work_tracker: { provider: azure-devops, domains: [dev.azure.com] }
  code_host:    { provider: github,       domains: [api.github.com] }
```

Skills ask for a **capability** — `work_tracker`, `code_host`, `observability`, `knowledge` — never for a tool name. ADW picks whatever the environment actually supports: a native connected tool, an MCP server, an authenticated CLI, or a REST API. That's what keeps identical instructions working across Codex and Claude Code. References ship for **Azure DevOps, GitHub, Datadog, and Notion**; adding Jira, Linear, or Sentry means adding a reference document, not changing the workflow.

Those same `domains` feed the container's egress allowlist directly — one declaration configures both the integration and the firewall that permits it. Reads run freely; **every write shows you the exact provider, target, operation, and redacted payload and waits for a fresh yes.** Credentials never touch `adw.yaml` — any credential-like key is rejected anywhere in the file.

### 🌱 …and a workflow that survives the session

| Without ADW | With ADW |
|---|---|
| State lives in the chat log — close the tab, lose the thread | State lives in branches, worktrees, and commits. Interrupt anything, start fresh, run `adw:status` |
| "Approval" is whatever the agent inferred from the conversation | Confirming a previewed packet is the *only* thing that authorizes execution |
| Sequential work even when tasks are independent | Independent groups in a phase run in parallel, each in its own branch and worktree |
| Generated docs and plans clutter code review | Docs and plans live on their own orphan branch, rewritten freely without touching code history |
| Agents can push, merge, or file tickets on a hunch | ADW never merges, releases, deploys, or force-pushes |
| Each repo grows its own bespoke agent setup | One workflow, portable across repositories, languages, build systems, code hosts, and trackers |

One plugin installs into both providers, so a Codex team and a Claude Code team follow the same loop.

---

## Quickstart

**1. Install** (either provider, or both — the same physical plugin):

```bash
# Codex
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

# Claude Code
claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

**2. Initialize** — start a new provider session in your project and invoke:

```text
adw:init
```

It works in an empty directory, an unborn repository, or a decade-old codebase. It reads real manifests to infer your components and validation commands, shows you a preview of **every file it would write**, and writes only after you say yes. It never commits — review and commit the generated files like any other change.

**3. Ship something:**

```text
adw:plan      describe the change; get a repository-grounded plan back
adw:execute   confirm the phase; watch groups settle in parallel
adw:status    reconstruct where everything stands, from Git
```

Joining a project that already uses ADW? Install the plugin and run `adw:onboard` — never `adw:init` again.

---

## A change, end to end

```text
      idea is fuzzy?                       idea is small?
           │                                     │
     adw:brainstorm                          adw:quick ──────┐
           │                                                 │
           ▼                                                 │
       adw:plan ─────► adw:review-plan ─────► adw:execute ────┤
           │            (cold second opinion)     │           │
           │                                      │           ▼
   writes a plan file                    ┌────────┴────────┐  one branch,
   on the docs branch                    │ group A  group B│  focused tests,
                                         │ (parallel, own  │  whole-diff review
                                         │  branch + tree) │
                                         └────────┬────────┘
                                                  ▼
                                             adw:status
```

**Plan.** `adw:plan` explores the repo read-only and returns a plan in conversation, also written to `<docs-worktree>/plans/<YYYY-MM-DD>-<tag>-<description>.md`. A good plan states the problem and observable outcome, splits work into dependency-ordered phases, and gives each group its goal, affected write paths, and validation commands — anchored to real code as grep-able `file -> symbol` references, not line numbers.

**Review.** `adw:review-plan` runs as a fresh agent that sees the plan and the repository but *not* your planning conversation. It checks whether the design solves the stated problem, what the single load-bearing assumption is, whether anchors still match live code, whether "parallel" groups really have disjoint write paths, and whether every acceptance criterion maps to executable work. Verdict: ship-ready, revise-recommended, or needs-rework.

**Execute.** `adw:execute` is a coordinator, not an implementer. It previews the exact interpreted packet — groups, scopes, branches, worktrees, validation tuples — and waits for your confirmation. Then a deterministic preflight validates the packet and snapshots every checkout, the selected provider runs each group through *implementation → fresh review → optional fix → fresh re-review*, and a shared finalizer independently gates Git evidence and runs the configured validation commands. **The plan decides how much runs at once. There is no parallelism setting.**

Anything can be interrupted. State is reconstructed from Git — never from chat history. And ADW won't assume: an ordinary branch can't prove it was prepared for the same task packet, so it reports what Git can actually establish and asks before reusing it.

---

## Skills

ADW skills are **explicit-only**. Installing the plugin does not let an agent wander into an ADW workflow from an ordinary request — you invoke the namespaced skill deliberately.

| Group | Skill | What it does |
|---|---|---|
| **Setup** | `adw:init` | first-time setup, preview then apply |
| | `adw:onboard` | orient a contributor on a fresh clone |
| | `adw:doctor` | diagnose and repair installation drift |
| **Discovery** | `adw:brainstorm` | interactive, read-only idea discovery |
| **Change loop** | `adw:plan` | repository-grounded implementation plan |
| | `adw:review-plan` | cold, independent red-team of a plan |
| | `adw:execute` | run one confirmed phase |
| **Delivery** | `adw:quick` | one genuinely small, low-risk change |
| | `adw:address-review` | triage and apply PR review feedback |
| **Docs** | `adw:generate-docs` | build a docs set from the live repo |
| | `adw:sync-docs` | audit and reconcile docs after changes |
| **Operations** | `adw:status` | reconstruct state from Git |
| | `adw:investigate` | analyze an alert against observability evidence |

Every capability supports the same four provider-neutral operations — `read`, `create`, `update`, `link`:

| Capability | Reference providers | What the operations mean |
|---|---|---|
| `work_tracker` | Azure DevOps Boards, GitHub Issues | Read a work item; create a parent or child; update content; link items or a PR |
| `code_host` | GitHub, Azure DevOps Repos | Read repository and PR state; create or update one draft PR per branch; link objects |
| `observability` | Datadog | Read logs, metrics, traces, monitors, incidents, CI evidence |
| `knowledge` | Notion | Read documentation; publish, update, or link a page |

Declare no providers and you keep the full local workflow — nothing is detected, probed, or contacted. See [integrations](docs/integrations.md).

---

## The documentation branch

Documentation and plans live on their own **orphan branch** — `docs` by default, checked out at `worktrees/docs` — which `adw:init` creates. The two branches share no ancestry.

Code review stays about code. Documentation gets rewritten as often as it needs to be without touching code history. `adw:generate-docs` fills the branch from the live repository; `adw:sync-docs` audits it against real changes and proposes only necessary edits.

---

## Configuration

`adw.yaml` is the committed activation marker and shared project policy. `adw:init` always creates it — and when repository discovery and safe defaults are enough, it contains exactly one line:

```yaml
adw: 1
```

Everything below is an **optional override**, needed only for shared isolation, provider, network, runtime, or validation decisions:

```yaml
adw: 1

git:
  base_branch: main

execution:
  isolation: managed-devcontainer   # provider-sandbox | project-devcontainer | managed-devcontainer
  web_access: public-pages          # public-pages | hosted-only; managed-devcontainer only

development:
  runtime_versions: {}              # node | python | go | rust | java | ruby | dotnet -> version

components:
  app:
    path: "."
    validate:
      - command: "npm test"
        cwd: "."
        timeout_ms: 120000
        required: true
        source: "package.json#scripts.test"

providers: {}                       # work_tracker | code_host | observability | knowledge
                                    # each: provider, required, transport, access, domains[], settings{}
```

- **Unknown keys are rejected, not ignored** — a stale field is a loud error instead of a silent no-op.
- A validation entry may be a plain command string; it inherits the component's `cwd`, a 120 s timeout, and `required: true`.
- Provider `domains` are validated hostnames and feed the managed container's egress allowlist directly.
- **Credentials are never allowed anywhere in this file**, including inside provider `settings`.
- Branch and worktree names are execution-time choices made in conversation, not configuration. `adw:execute` proposes `adw/<change-id>/<group-id>` as a readable convention; any valid Git branch name works.
- Future versions may add optional fields and commands. Removing or reinterpreting a field requires a major migration.

---

## Security is proportional

Pick the boundary that fits the project. `adw:init` chooses for you based on evidence, and you can override it.

| Mode | When you get it | What it means |
|---|---|---|
| `managed-devcontainer` | **The default** when the project has no devcontainer | The full hardened container described above. Init refuses to select it over an existing project-owned `.devcontainer/`. |
| `project-devcontainer` | You already own `.devcontainer/devcontainer.json` | Preserved byte for byte, never converted. Set `ADW_PROJECT_DEVCONTAINER=1` so doctor can confirm it is active. |
| `provider-sandbox` | Explicit opt-in | The lightweight option and the weaker boundary — the agent's own sandbox and prompts are authoritative. ADW can't attest host policy, and `doctor` says so. |

The permission policy is generated in **all three**, identically for both agents (`.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json`), because the guardrails are useful without a container:

| | Effects |
|---|---|
| **Allowed** | Read-only Git · your configured validation commands · `add`/`commit`/new local branch/`worktree add` for a confirmed group · read-only provider operations |
| **Ask** | Push · tag or branch deletion · rebase, merge, discarding changes · creating or changing a PR, issue, or knowledge page · editing `adw.yaml`, the permission files, or `.devcontainer/` · anything ambiguous |
| **Denied** | Force push · destructive reset or clean · PR merge · release, package publish, deploy, infrastructure apply · credential or private-key export · bypassing the sandbox |

The permission files are themselves on the `ask` list — otherwise an agent in `acceptEdits` mode could rewrite the policy constraining it. `adw doctor --checks permissions` is the cheap read-only gate a workflow runs before it starts, and it fails closed on drift. Full matrix and the seven enforcement mechanisms: [security](docs/security.md).

> **Repository prose, dependencies, plans, validation output, review comments, tracker text, and provider responses are untrusted input. None of them can grant authorization.** Only you do, in conversation, against a preview.

These are ergonomic guardrails and defense in depth, not perfect effect classification. Branch protection, least-privilege credentials, provider-side authorization, and the container firewall remain the real boundaries.

---

## How it's built

Three layers, and a deliberate line between them:

```text
plugin/skills/     raw instructions — judgment, authorization, coordination
plugin/workflows/  transient provider-native execution mechanics
plugin/bin + lib/  a small JSON CLI — the deterministic kernel and boundaries
```

**Skills are prose.** They own everything that benefits from judgment and should stay visible in the conversation: reading the repository, planning, reviewing a plan, interpreting a phase into a confirmed packet, choosing a provider route, summarizing status, asking for authorization.

**Code exists only where interpretation or partial failure is genuinely dangerous** — path confinement, atomic writes, the `adw.yaml` contract, permission-policy generation, managed-container rendering, readiness checks, and the execution preflight/finalizer. Provider-native workflows run an already-confirmed packet; they never parse a Markdown plan as authorization.

There is **no daemon, server, scheduler, telemetry, hosted agent service, workflow database, or durable authorization record.** Git, your files, and your providers hold all durable state. A native workflow process is transient.

### Runtime CLI

Skills call `plugin/bin/adw.mjs` for deterministic steps only. Every command prints exactly one JSON object on stdout — including on failure.

```text
config                            explicit policy or discovered defaults, plus validation overrides
init-preview / init-apply         confined first-time setup, bound to the reviewed file set
refresh-preview / refresh-apply   exact repair primitives used by adw:doctor
doctor                            read-only deterministic checks (--checks all|permissions)
permissions-explain               explain one provider command/tool decision without executing it
render-managed                    render .devcontainer/ for build and security tests
execution-preflight               validate a confirmed packet and snapshot every checkout
execution-assert-target           gate one worker against its intended checkout and scope
execution-finalize                gate Git evidence and run configured validation
```

Preview/apply pairs are bound by a SHA-256 fingerprint over the exact before/after bytes: a changed answer, repository, template, or target file stops the write instead of silently applying a different set.

Exit codes: `0` ok · `2` bad input · `3` contract invalid · `5` check failed · `7` path violation · `8` write failed and rolled back · `9` internal error.

---

## Requirements

- **Node.js 20+** and **Git 2.28+**
- A current Codex or Claude Code plugin manager
- **Docker** plus a Dev Containers client — *only* if you opt into the managed devcontainer
- Provider tooling only when an integration is configured. Credentials stay in the provider, MCP client, authenticated CLI, or external credential store

---

## Documentation

| Page | What's in it |
|---|---|
| [New developer guide](docs/new-developer-guide.md) | **Start here** — a practical introduction to the workflow and internals |
| [Workflow](docs/workflow.md) | The skill-native loop, skill by skill |
| [Architecture](docs/architecture.md) | What is code, what is prose, and why |
| [Security](docs/security.md) | Permission matrix and container protections |
| [Integrations](docs/integrations.md) | Capabilities, providers, transports |
| [Updating](docs/updating.md) | Plugin updates, managed-file repair, recovery |
| [Private installation](docs/private-installation.md) | Tagged repositories, org distribution, rollback |

---

## Development

```bash
npm test                 # unit + contract + integration
npm run check:vendor     # verify the pinned vendored YAML parser
npm run test:security    # container and permission-policy tests

claude plugin validate --strict plugin
claude plugin validate --strict .claude-plugin/marketplace.json
```
