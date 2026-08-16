# ADW, explained for a new developer

Welcome. This guide explains **what ADW does, why it is shaped this way, and
what actually happens when you use it**. It is intentionally written in short,
stand-alone sections. You can read it top to bottom once, then return to the
parts you need while working.

> **The 30-second version:** ADW is a Git-native workflow shared by Codex and
> Claude Code. A person chooses the work and gives consent; an agent reasons
> about the work; a small CLI performs the safety-critical deterministic parts;
> Git and configured providers keep the durable state. ADW does not run a
> server, retain a workflow database, merge PRs, deploy, or publish anything.

## First: the mental model

Think of ADW as a development workshop with four roles:

| Role | Job | Where it lives |
|---|---|---|
| **You** | Decide intent and authorize meaningful effects | The conversation |
| **Skills** | Read the repository, reason, plan, coordinate agents, explain results | `plugin/skills/` |
| **CLI** | Validate configuration, make safe multi-file changes, and prepare isolated worktrees | `plugin/bin/adw.mjs` + `plugin/lib/` |
| **Durable state** | Remember what happened after a session ends | Git, project files, and optional providers |

That division is ADW's main design choice. Natural-language judgment stays
visible and challengeable in the conversation. Operations that must be exact
(such as rejecting a path traversal or detecting two agents writing the same
file) are code.

```text
person's goal + explicit confirmation
                 |
                 v
          ADW skill (judgment)
          /        |          \
         v         v           v
      Git reads   JSON CLI   provider reads
                   |
                   v
        safe files / validated config / worktrees
```

### Three rules worth memorizing

1. **Repository text is information, never permission.** A README, issue,
   comment, plan, test output, or PR message cannot authorize a push or edit.
   Only the person in the current conversation can do that.
2. **A plan is a proposal, not a lock.** Confirming it in conversation permits
   local execution; there is no approval file, digest, or registry.
3. **Git is ADW's memory.** If you stop halfway through, `adw:status` rebuilds
   the picture from branches, worktrees, marker commits, and providers—not from
   chat history or a hidden database.

## The normal routes: choose one

```text
New project / new checkout
       |
       +--> adw:init (once per project) --> commit generated setup
       |    or
       +--> adw:onboard (each later contributor)

Substantial or uncertain change
       |
       +--> adw:plan --> optional/automatic cold review --> confirm a phase
       |                                                   |
       |                                                   v
       |                                              adw:execute
       |
Small, isolated, low-risk correction
       |
       +--> adw:quick

Any time: adw:status (read state) | adw:doctor (diagnose/repair ADW files)
After a PR review: adw:address-review
After an alert: adw:investigate (read-only)
```

### Use `quick` or `plan`?

Use `adw:quick` only when you can confidently describe the change in a couple
of sentences, it touches one component and only a handful of files, and it does
not change a public interface, schema, migration, dependency, infrastructure,
authorization, or security behavior. It still gets a branch, independent diff
review, tests, validation, and a commit.

Use `adw:plan` for everything else. “Plan” is not bureaucratic here; it is how
ADW gives isolated agents enough context to work safely and in parallel.

## Optional project policy: `adw.yaml`

`adw.yaml` is optional. Use it for a small, committed shared policy when a
project needs to constrain isolation, integrations, network access, runtimes,
or an exceptional component/validation override. Otherwise ADW uses safe
defaults and repository evidence.

```yaml
adw: 1

git:
  base_branch: main

execution:
  isolation: provider-sandbox

components:
  app:
    path: "."
    validate:
      - command: "npm test"
        cwd: "."
        timeout_ms: 120000
        required: true
        source: "package.json#scripts.test"

providers: {}
```

| Section | Meaning | Why ADW needs it |
|---|---|---|
| `adw: 1` | The contract version | Prevents silent changes in meaning |
| `git.base_branch` | Optional override for the branch new work starts from | Git normally supplies this |
| `execution` | Isolation mode and, for a managed container, web-access policy | Tells ADW what safety boundary must be active |
| `development.runtime_versions` | Optional unpinned runtime versions | Fills only gaps the repository does not pin itself |
| `components` | Optional component and validation overrides | Use only when discovery is ambiguous |
| `providers` | Optional capability-to-provider configuration | Enables integrations without hard-coding a vendor |

### The contract is deliberately strict

When present, `plugin/lib/config.mjs` parses YAML 1.2 and rejects duplicate keys, merge keys,
unknown keys (except provider-specific `settings`), malformed component paths,
and credential-like keys anywhere in the file. That means a typo fails loudly
instead of becoming a setting ADW silently ignores.

Never put passwords, tokens, cookies, API keys, private keys, or credentials in
`adw.yaml`. Authentication belongs in the relevant provider, MCP client,
authenticated CLI, or external credential store.

## Your personal profile

Shared policy is not where personal preferences belong. Keep global preferences
in `~/.config/adw/profile.md` and project-specific ones in `.adw/user.md`.
The latter is ignored by Git so it works both on the host and inside a managed
container without exposing your home directory.

```markdown
# My ADW preferences

- I have ADHD: lead with the outcome and keep sections short.
- Prefer one recommended next action.
- Use my authenticated tracker identity; do not guess from an email address.
```

These files are readable context, not executable configuration. They cannot
authorize an action or supply a command, and must never contain credentials.
Shared policy wins over a conflicting preference; a current conversation can
refine presentation but cannot weaken project security.

### Components are the unit of scope

A simple project does not need to declare components at all. ADW first reads
workspace manifests, build files, CI, and instructions. A component override is
available when that evidence is ambiguous. Its commands inherit the component's
directory, a 120-second timeout, and `required: true`.

ADW does not make up test commands during execution. It gets normalized,
sourced commands from `adw config`, shows them, and runs those commands. This
keeps an agent from treating prose in a README as shell instructions.

## Initialization and joining a project

### `adw:init`: once for the project

Init handles three states:

| Repository state | ADW behavior |
|---|---|
| Empty directory | Creates Git on the selected base branch, then generates setup |
| Git repository with no commits | Generates setup in the existing repo |
| Established Git repository | Derives components, runtimes, and validation from real manifests and preserves existing tooling |

It refuses a non-empty directory that is not a Git repository and refuses to
overwrite an existing `adw.yaml`. That protects an explicit shared policy; a
project without that file can still be initialized normally.

Init first gathers evidence from manifests, lock files, runtime pin files, CI,
Dockerfiles, and existing project files. It asks only for facts it cannot infer,
such as the isolation choice or optional integrations. It then uses a **preview
then apply** mechanism:

```text
init-preview --> list of exact proposed files + unresolved questions + fingerprint
       |                         |
       |                   person reviews and says yes
       v                         v
                   init-apply with the exact fingerprint
```

The fingerprint binds apply to the reviewed before/after state. If an answer,
template, or target file changes after preview, apply refuses rather than making
a different write. It writes no commit: review and commit the generated files
as ordinary project changes.

Normally init writes:

```text
adw.yaml                         only when shared policy/overrides are chosen
.codex/config.toml               Codex session policy
.codex/rules/adw.rules           Codex command policy
.claude/settings.json            Claude policy
.gitignore                       an ADW-managed block for worktrees/ and .adw/user.md
.devcontainer/                   only for managed-devcontainer mode
```

### `adw:onboard`: once per contributor/machine

Later contributors do **not** rerun init. Onboard reads the committed contract,
guides the developer into the required environment, points out provider
authentication that they must do themselves, runs the same readiness diagnosis,
and explains the everyday routes. It never reselects the project's isolation
mode or providers.

## The main change loop, slowly

### 1. Plan

`adw:plan` is read-only. It investigates actual source files, entry points,
tests, and configured validation, then writes a self-contained plan in the
conversation (or to a file only when asked). There is no required filename,
canonical plan directory, plan registry, or document parser.

A useful plan has two layers:

| Layer | Reader | Must answer |
|---|---|---|
| Feature overview | A human | What changes, why, what is excluded, and how success is observed |
| Implementation plan | Coordinator and isolated agents | Phases, group tasks, exact write paths, and validation |

A **phase** is a dependency-ordered slice of work. A **group** is work one
agent can complete alone. Parallel groups must list disjoint write paths. That
one rule is critical: two agents cannot independently change the same file
without creating a coordination problem. A one-group phase is completely normal;
ADW never invents parallelism for show.

Before returning a plan, `adw:plan` performs a cold review by an agent that sees
the plan and repository but not the planning conversation. This intentionally
matches the limited context that implementers will have. The reviewer checks the
plan's load-bearing assumption, code anchors, phase ordering, parallel safety,
validation, and coverage of acceptance criteria. Objective flaws are corrected;
real product choices come back as explicit decisions.

### 2. Confirm a phase

The coordinator restates the selected phase, every group, expected write paths,
and validation. Your confirmation is the authorization for **local** execution.
It does not authorize a push, PR, issue, tracker update, knowledge-page update,
or any other external write.

### 3. Prepare worktrees

The coordinator turns each group into a machine-checkable packet:

```json
{
  "group_id": "api",
  "tasks": ["Implement the endpoint and its tests"],
  "affected_paths": ["src/api", "test/api"],
  "validation": ["npm test"]
}
```

`worktree-preview` checks all packets before making anything. If parallel groups
overlap in their paths, it refuses the request. `worktree-prepare` then creates
one local branch and one worktree for each group:

```text
base branch at an exact commit
     |
     +--> adw/<change-id>/<group-a> --> worktrees/<change-id>/<group-a>
     |
     +--> adw/<change-id>/<group-b> --> worktrees/<change-id>/<group-b>
```

Each branch begins with an empty **marker commit**. Its trailers record the
change ID, group ID, base branch, base commit, and digest of the interpreted
packet. This marker makes resume safe: the same request can reuse a matching
prepared branch; a changed task or base is reported as a mismatch rather than
quietly reusing the wrong work.

Preparation is all-or-nothing. If one group cannot be prepared, the CLI tears
down the partial preparation. ADW never automatically deletes worktrees or
branches later; it only prints exact cleanup commands for a person to run.

### 4. Implement, review, validate, commit

Within every group, ADW follows this sequence:

```text
group packet
   -> implementation agent in only that worktree
   -> independent reviewer reads the actual diff
   -> implementer fixes in-scope high-severity findings
   -> reviewer checks again
   -> configured validation commands run
   -> coordinator verifies scope and commits on that group branch
```

Groups whose write paths are disjoint can follow this sequence in parallel.
Inside one group, it is intentionally sequential: review needs an implemented
diff, and validation needs the final implementation.

Workers never commit, push, create PRs, or change external trackers. The
coordinator owns Git commits and all external action. A required test that was
not run is not a passing result—ADW must report skipped, timed-out, or failed
checks honestly.

### 5. Deliver only with another yes

After local work passes, ADW can propose delivery actions. Each action has its
own preview and fresh approval: pushing a specific branch, creating/updating a
draft PR, or creating/updating/linking a tracker item. ADW never force-pushes,
merges, marks a PR ready, releases, deploys, publishes packages, or applies
infrastructure.

### 6. Resume with `adw:status`

You can close the session at any point. `adw:status` reads, but does not modify:

- the validated project config;
- uncommitted Git state;
- `adw/*` branches and worktree attachments;
- each branch's marker commit and commits since the base;
- read-only configured provider state such as open PRs.

It ends with the most useful next action. There is intentionally no “run
record,” approval artifact, docs branch, or hidden ADW database to recover.

## The supporting skills

| Skill | Use it when | What it deliberately does not do |
|---|---|---|
| `adw:init` | Establish ADW in a project | Commit generated setup or overwrite an initialized project |
| `adw:onboard` | Join an initialized project | Change shared configuration |
| `adw:doctor` | Check readiness or repair generated ADW files | Rewrite `adw.yaml`, app code, credentials, or project-owned containers |
| `adw:plan` | Shape substantial work | Create worktrees or implementation branches |
| `adw:review-plan` | Get an independent plan verdict | Make code changes |
| `adw:execute` | Carry out one confirmed phase | Merge, deploy, force-push, or make external changes without separate approval |
| `adw:quick` | Make one genuinely small, low-risk change | Skip review, validation, or a local branch |
| `adw:address-review` | Address feedback on an existing PR | Quietly expand the design beyond the PR's scope |
| `adw:investigate` | Assess an alert/incident | Alter code, observability state, or send notifications |
| `adw:status` | Reconstruct work in flight | Fetch, pull, repair, run project commands, or write external state |

## Safety and authorization: the traffic-light model

The shared rulebook is [`plugin/authorization.md`](../plugin/authorization.md).
The active provider sandbox or container is the true technical boundary; skill
instructions and generated policies are layered guardrails.

| Green: can run | Yellow: ask first | Red: always refused |
|---|---|---|
| Read-only Git; configured validation; local branch creation; `git add`/`commit`; prepared worktrees after execution is authorized; configured provider reads | Push, tag, branch/worktree deletion, rebase, merge, discarding changes; external object creation/update; manual edits to managed ADW files | Force push; destructive reset/clean; PR merge; release/package publish/deploy/IaC apply; credential export; bypassing isolation |

### Isolation modes

| Mode | Meaning | Important reality check |
|---|---|---|
| `provider-sandbox` | Use the agent provider's own sandbox; default and lightweight | ADW must inspect and state the real active policy; it cannot infer it from a file |
| `project-devcontainer` | Use an existing project container untouched | It needs a runtime marker (`ADW_PROJECT_DEVCONTAINER=1` or equivalent) to prove it is active |
| `managed-devcontainer` | ADW renders and manages a hardened container | It is opt-in and cannot replace an existing project-owned `.devcontainer/` |

Managed containers run non-root, drop Linux capabilities except a tiny named
set, use a fail-closed egress proxy with exact allowlisted HTTPS domains and SNI
matching, avoid Docker sockets/host homes/SSH mounts, use project-scoped
credential volumes, pin agent versions, and install a Git wrapper that blocks
dangerous pushes. `public-pages` is an intentional, bounded public-read
exception; `hosted-only` keeps network use to configured domains.

### `adw:doctor`: the repair boundary

Doctor first performs only read-only checks: plugin manifest agreement, config
validity, component ownership, isolation, permission-policy freshness,
worktree ignore setup, and (when applicable) detailed managed-container
integrity. The small `adw doctor --checks permissions` check is the gate before
quick/execution work.

If ADW-managed bytes drift, doctor uses the same preview/fingerprint/apply model
as init to repair only the generated policy, `.gitignore` managed block, and
managed container. It cannot “fix” unclear configuration, app code,
credentials, or a project-owned container. Those are maintainer decisions.

## Optional integrations

ADW talks in **capabilities**, so the workflow does not depend on a particular
vendor or tool command:

```text
skill --> capability --> provider --> transport --> external service
```

| Capability | Example providers | Allowed conceptual operations |
|---|---|---|
| `work_tracker` | Azure DevOps Boards, GitHub Issues | `read`, `create`, `update`, `link` |
| `code_host` | GitHub, Azure DevOps Repos | `read`, `create`, `update`, `link` |
| `observability` | Datadog | `read` only—even if credentials could do more |
| `knowledge` | Notion | `read`, `create`, `update`, `link` |

The transport can be a built-in connected tool, MCP, authenticated CLI, or API.
Configuration can select one; otherwise ADW prefers an available authenticated
transport in that order. An absent optional capability is not probed and does
not block the local workflow. A required capability blocks only the step that
needs it when unavailable.

Every external write follows the same safety dance: read current state, show
provider/target/redacted payload and duplication risk, obtain approval, search
for an idempotency marker, perform only the approved write, verify it, and
report the stable URL/ID. The provider object and Git commit are the durable
record—again, no ADW side database.

## Under the hood: repository map

```text
plugin/
  bin/adw.mjs                    thin command dispatcher; JSON in/out
  authorization.md               shared human-authorization contract
  skills/<skill>/SKILL.md        visible behavioral instructions
  lib/
    safe-files.mjs               confined atomic filesystem writes
    config.mjs                   strict adw.yaml parser/validator
    permissions.mjs              Codex/Claude policy rendering and safe merging
    managed-environment.mjs      repository evidence + managed-container render
    project-setup.mjs            init/refresh preview and apply orchestration
    doctor.mjs                   deterministic on-disk readiness checks
    worktrees.mjs                parallel packet checks and resumable worktrees
    vendor/yaml.mjs              bundled pinned YAML parser
  templates/                     adw.yaml, plan, and managed-container sources
  integrations/                  provider-neutral contract and provider guides
  .codex-plugin/ + .claude-plugin/  package manifests pointing to one skill tree

docs/                            user-facing architecture, workflow, security,
                                 integrations, updates, installation
tests/                           contract and integration tests
scripts/test-security.sh         Docker-backed managed-container security tests
src/build-vendor.mjs             bundles the YAML dependency for installation
```

### The CLI commands

Every `adw` CLI command prints exactly one JSON object to stdout, even on
failure. Code callers use this stable shape instead of scraping prose.

| Command | Purpose |
|---|---|
| `config` | Parse/validate explicit policy or return discovered defaults and explicit validation overrides |
| `init-preview` / `init-apply` | Safely preview and initialize ADW-managed files |
| `refresh-preview` / `refresh-apply` | Safely preview and repair generated files |
| `doctor` | Run read-only deterministic readiness checks |
| `worktree-preview` / `worktree-inspect` / `worktree-prepare` | Describe, inspect, and prepare isolated execution groups |
| `worktree-cleanup-guidance` | Print—not execute—the exact cleanup commands |
| `render-managed` | Render a managed `.devcontainer/` for tests/build tooling without changing project config |

Exit codes are stable too: `0` success, `2` bad input, `3` invalid contract,
`5` failed check/blocker, `7` path violation, `8` rolled-back write failure,
and `9` internal error.

### Why `safe-files.mjs` exists

Multi-file setup is more dangerous than it looks. This module rejects absolute
paths, `..`, backslashes, NUL bytes, symlink destinations and symlinked parent
directories. It stages managed writes in a transaction directory, verifies that
each target still contains the exact previewed “before” bytes, and rolls the
whole set back if any write fails. This is why init and doctor do not just have
an agent edit several settings files directly.

### Why `worktrees.mjs` exists

Parallelism is useful only when it is honest. This module checks project paths,
overlapping packets, branch state, worktree locations, base commits, and marker
trailers. It creates/reattaches the correct isolated workspace or refuses. It
does not decide tasks, spawn agents, edit code, commit implementation, push, or
delete anything; those actions need judgment or consent outside the module.

## A practical first week

1. Read this guide's first three sections, then run `adw:onboard` in an already
   initialized checkout. Use `adw:init` only when ADW's generated setup is not
   present—not merely because `adw.yaml` is absent.
2. Run `adw:doctor` until it reports a ready environment. If it proposes a
   repair, read the exact files in its preview before approving.
3. Run `adw:status` before starting work. It is always safe and tells you
   whether another change is already prepared.
4. For your first meaningful task, ask for `adw:plan`; read the feature overview
   and especially the exact write paths/validation for your phase.
5. Confirm only the phase you mean to run. Review the resulting commits and
   validation before approving a push or draft PR.

## When something feels odd

| Symptom | Best next move |
|---|---|
| `adw.yaml` is missing | This is normal; ADW uses defaults and discovery. Add it only for shared policy or overrides |
| `adw.yaml` is invalid | Make a deliberate maintainer edit; doctor will not guess or rewrite it |
| A generated permission/container file drifted | Run `adw:doctor`, inspect its refresh preview, approve only the listed repair if correct |
| A plan's groups touch the same file | Put them in one group or sequential phases; do not claim they are parallel |
| An execution was interrupted | Run `adw:status`; marker commits and worktrees reconstruct the state |
| Provider auth is absent | Authenticate through the intended provider flow; do not add secrets to config |
| A review comment changes the design | Return to plan/re-plan; `adw:address-review` is for in-scope corrections |
| You are unsure whether an action is allowed | Treat it as yellow: describe its exact effect and ask the person first |

## The final idea

ADW is intentionally not an autonomous delivery system. It makes a good
developer workflow easier to repeat: inspect first, plan clearly, isolate work,
review independently, validate honestly, commit locally, and ask before any
irreversible or external step. Its internals exist to make that behavior
recoverable and hard to accidentally bypass—not to hide it behind automation.
