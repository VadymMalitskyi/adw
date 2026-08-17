# ADW, explained for a new developer

Welcome. This guide explains **what ADW does, why it is shaped this way, and
what actually happens when you use it**.

You do not need to read this cover to cover before you can work. Start with
**Start here**, then use the jump table when a task puts you in a new part of
the workflow. Each section tries to answer one question at a time. The longer
sections are reference material: skim their opening summary first and come back
only when that detail becomes useful.

> **A note on readability:** this is designed to be friendly to a busy brain.
> Short sections, repeated decision rules, concrete examples, and explicit next
> actions are intentional. If you lose your place, run `adw:status`; it is the
> safe reset point for both the project and your mental context.

> **The 30-second version:** ADW is a Git-native workflow shared by Codex and
> Claude Code. A person chooses the work and gives consent; an agent reasons
> about the work; a small CLI performs the safety-critical deterministic parts;
> Git and configured providers keep the durable state. ADW does not run a
> server, retain a workflow database, merge PRs, deploy, or publish anything.

## Start here: your first ten minutes

If this is an existing ADW project, do these in order:

1. Run `adw:onboard` if this is your first time in this checkout or on this
   machine. It explains the project environment and any authentication you need
   to complete yourself.
2. Run `adw:doctor`. Read its outcome first. If it says the environment is
   ready, you can move on. If it proposes a repair, inspect the preview before
   approving it.
3. Run `adw:status` before you begin a task. It tells you whether work is
   already in progress and gives one recommended next action.
4. Choose a route: `adw:quick` for a truly small correction; `adw:plan` for
   anything uncertain, multi-part, or consequential.

If you are setting ADW up for a project for the first time, begin with
`adw:init` instead. Do not rerun init merely because you cannot find an
`adw.yaml`; that file is optional.

### Jump to the part you need

| If you are trying to… | Read this |
|---|---|
| Understand the big idea | [First: the mental model](#first-the-mental-model) |
| Decide between a quick change and a planned change | [Use `quick` or `plan`?](#use-quick-or-plan) |
| Join or set up a project | [Initialization and joining a project](#initialization-and-joining-a-project) |
| Make your first change | [A guided first change](#a-guided-first-change) |
| Continue interrupted work | [Resume with `adw:status`](#6-resume-with-adwstatus) |
| Understand approvals and safety limits | [Safety and authorization](#safety-and-authorization-the-traffic-light-model) |
| Fix a confusing setup problem | [When something feels odd](#when-something-feels-odd) |
| Learn the implementation details | [Under the hood: repository map](#under-the-hood-repository-map) |

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
   the picture from branches, worktrees, commits, and providers—not from chat
   history or a hidden database. An ordinary branch cannot prove it was
   prepared for the same earlier task, so status reports what Git can actually
   show and asks before resuming it.

## The normal routes: choose one

```text
New project / new checkout
       |
       +--> adw:init (once per project) --> commit generated setup
       |    or
       +--> adw:onboard (each later contributor)

Substantial or uncertain change
       |
       +--> adw:brainstorm (when the idea needs discovery) --> adw:plan
       |                                                        |
       |                                           optional/automatic cold review --> confirm a phase
       |                                                                                |
       |                                                                                v
       |                                                                           adw:execute
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

### A guided first change

Imagine your first task is: “Correct a typo in the settings screen and add a
test if the project already tests that screen.” Here is the entire conversation
you should expect.

```text
You:      Please use adw:quick to fix the typo in Settings.
ADW:      I found one UI component and its existing tests. I will change these
          two paths, run this test command, review the diff, and commit locally.
You:      Yes, do that.
ADW:      [prepares an isolated branch, implements, reviews, validates]
ADW:      Done locally. The test passed. Here is the commit and the diff
          summary. Would you like me to push it or create a draft PR?
You:      Yes, create a draft PR.
ADW:      I will create this draft PR with this title/body against this branch.
          Please confirm this external write.
```

There are two important pauses in that example:

- Your approval to execute permits the **local** change, tests, and local
  commit. It does not silently permit a network action.
- A push or draft PR is a separate, specific request because it changes a
  system outside your checkout.

For a larger task, replace `adw:quick` with `adw:plan`. Read the overview and
the phase you are considering; you only need to confirm the one phase you want
to run now. It is fine to stop after planning. A useful plan is progress, not
a promise to start implementation immediately.

### The one-minute decision check

When you are unsure which route to use, answer these in order:

1. Can I name the desired change, affected component, and likely files without
   investigation? If no, plan.
2. Is it limited to one small component and a handful of files? If no, plan.
3. Does it avoid public interfaces, schemas, dependencies, infrastructure,
   permissions, and security behavior? If no, plan.
4. Would a second developer understand and safely review it in one small diff?
   If no, plan.

Only four confident “yes” answers make `quick` a good fit. Choosing `plan`
when you are uncertain is normal; it is not an escalation or a failure.

## Optional project policy: `adw.yaml`

`adw.yaml` is optional. Use it for a small, committed shared policy when a
project needs to constrain isolation, integrations, network access, runtimes,
or an exceptional component/validation override. Otherwise ADW uses safe
defaults and repository evidence.

```yaml
adw: 1

git:
  base_branch: main

docs:
  branch: docs
  worktree: worktrees/docs

execution:
  isolation: managed-devcontainer

components:
  app:
    path: "."
    validate:
      - command: "npm test"
        cwd: "."
        timeout_ms: 120000
        required: true
        source: "package.json#scripts.test"

providers:
  code_host:
    provider: github
    access: read-write

# Optional: customize yellow provider operations. Red safety floors stay red.
permissions:
  providers:
    github:
      operations:
        comment: allow
      tools:
        add_comment: comment
```

| Section | Meaning | Why ADW needs it |
|---|---|---|
| `adw: 1` | The contract version | Prevents silent changes in meaning |
| `git.base_branch` | Optional override for the branch new work starts from | Git normally supplies this |
| `docs` | Optional override for the documentation branch and its worktree | Documentation and plans live off the code branches; defaults are `docs` at `worktrees/docs` |
| `execution` | Isolation mode and, for a managed container, web-access policy | Tells ADW what safety boundary must be active |
| `development.runtime_versions` | Optional unpinned runtime versions | Fills only gaps the repository does not pin itself |
| `components` | Optional component and validation overrides | Use only when discovery is ambiguous |
| `providers` | Optional capability-to-provider configuration | Enables integrations without hard-coding a vendor |
| `permissions` | Optional provider operation and exact tool mapping | Generates matching Codex and Claude approval behavior |

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

### What you need to do—and what ADW handles

You are not expected to manually manage the branches, worktrees, reviews, or
state reconstruction described below. Your job is to state the goal, read the
important summaries, and approve meaningful effects. ADW's coordinator turns
an approved phase into the smaller technical steps.

| You decide | ADW coordinates |
|---|---|
| The outcome you want and what is out of scope | Repository investigation and a proposed plan |
| Whether a phase should start | Isolated branches/worktrees and bounded agent packets |
| Whether a proposed external action should happen | Independent diff review, validation, and an honest result |
| When to pause or change direction | Durable Git state so the work can be resumed later |

**Keep this rule handy:** a clear summary is a cue to decide, not a demand to
approve. Ask for a smaller phase, a different plan, or a pause whenever the
scope is not what you expected.

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

The coordinator turns each group into a bounded packet — task instructions,
write paths, validation commands, and a proposed branch and worktree:

```json
{
  "group_id": "api",
  "tasks": ["Implement the endpoint and its tests"],
  "affected_paths": ["src/api", "test/api"],
  "branch": "adw/<change-id>/api",
  "worktree": "worktrees/<change-id>/api",
  "validation": ["npm test"]
}
```

The branch and worktree here are ordinary execution-time choices, not
configuration: `adw/<change-id>/<group-id>` is a readable default the
coordinator proposes, but a plan or the user may hand it any valid Git branch
name and it is used unchanged.

Before creating anything, the coordinator inspects native Git state —
`git worktree list --porcelain` and `git show-ref` for every group's proposed
branch and target path — and refuses the request if paths overlap or a target
is already occupied by something else:

```text
base branch at an exact commit
     |
     +--> adw/<change-id>/<group-a> --> worktrees/<change-id>/<group-a>
     |
     +--> adw/<change-id>/<group-b> --> worktrees/<change-id>/<group-b>
```

A genuinely new group is created with `git worktree add -b <branch>
<worktree-path> <base-commit>`. Nothing writes an empty marker commit anymore:
the group's own commits are the record of what happened. If a proposed
branch already exists with a worktree attached, the coordinator treats it as a
resumed attempt — it reports what Git can establish (merge base, commits since
that base, dirty files) and confirms with the user before continuing, since an
ordinary branch carries no digest proving it still matches an earlier task.

If one group cannot be prepared, the coordinator reports the failure to the
user rather than silently working around it. ADW never automatically deletes
worktrees or branches later; it only prints exact cleanup commands for a
person to run.

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
- local branches and worktree attachments, relative to the configured base
  branch — nothing filters this to an `adw/*` naming convention;
- each branch's commits since the base;
- read-only configured provider state such as open PRs.

It ends with the most useful next action. There is intentionally no “run
record,” approval artifact, docs branch, or hidden ADW database to recover.

### If you are interrupted: a tiny recovery script

Interruptions are expected. Do not try to reconstruct the situation from an
old terminal scrollback or your memory.

1. Return to the same checkout.
2. Run `adw:status`.
3. Read the **recommended next action** and the section about uncommitted work.
4. If it is unclear, ask ADW to explain the status in plain language before
   authorizing anything else.

In particular, do not manually delete a worktree “to start fresh.” ADW keeps
them so it can distinguish unfinished work from a clean slate. It prints exact
cleanup commands for a person when cleanup is appropriate.

## The supporting skills

### Small glossary

| Term | Plain-English meaning |
|---|---|
| **Base branch** | The starting branch for a change, often `main` |
| **Component** | The smallest meaningful part of the repository ADW can scope and validate, such as an app or service |
| **Phase** | One dependency-ordered slice of a larger plan that you can approve independently |
| **Group** | A bounded piece of a phase assigned to one isolated worker; parallel groups cannot write the same paths |
| **Worktree** | Another local folder attached to its own Git branch, so separate changes do not step on each other |
| **Validation** | The project-sourced commands that check the final change, such as tests, type checks, or a build |
| **Provider** | An external service integration, such as GitHub, Notion, or Datadog |
| **Managed file** | A generated ADW policy file; change it through init/doctor's reviewed flow rather than hand-editing it |

| Skill | Use it when | What it deliberately does not do |
|---|---|---|
| `adw:init` | Establish ADW in a project | Commit generated setup or overwrite an initialized project |
| `adw:onboard` | Join an initialized project | Change shared configuration |
| `adw:doctor` | Check readiness or repair generated ADW files | Rewrite `adw.yaml`, app code, credentials, or project-owned containers |
| `adw:generate-docs` | Generate an architecture-first documentation set on the docs branch from the live repository | Present interpretation as verified fact, or overwrite project-authored docs without review |
| `adw:sync-docs` | Audit and reconcile documentation after meaningful repository changes | Treat commit count as documentation drift or rewrite unrelated docs |
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

### The pocket version

Before reading the implementation detail, remember this:

- **Green** means a local, reversible, or read-only action ADW may perform as
  part of the work you already approved.
- **Yellow** means the action may have a meaningful effect. ADW must describe
  the exact action and wait for a fresh yes.
- **Red** means ADW refuses it. It does not become acceptable because a plan,
  issue, command output, or another agent suggested it.

When in doubt, say what you want to happen rather than trying to classify a
command yourself. ADW can explain the proposed effect and ask at the right
point.

| Green: can run | Yellow: ask first | Red: always refused |
|---|---|---|
| Read-only Git; configured validation; local branch creation; `git add`/`commit`; prepared worktrees after execution is authorized; configured provider reads | Push, tag, branch/worktree deletion, rebase, merge, discarding changes; external object creation/update; manual edits to managed ADW files | Force push; destructive reset/clean; PR merge; release/package publish/deploy/IaC apply; credential export; bypassing isolation |

### Managed devcontainer: what actually decides whether a command runs?

**Short answer:** the agent runtime makes the allow/prompt/block decision before
it starts a shell command. ADW supplies the policy that the runtime reads; the
managed container protects that policy's installed source and limits what an
allowed command can reach. A Markdown document explains the policy, but does
not enforce it.

Keep these four layers separate:

| Layer | What it does | Is it the final command gate? |
|---|---|---|
| `plugin/authorization.md` | Human-readable contract: which effects are green, yellow, or red | No. It is documentation and instructions. |
| Generated policy files | Give Codex and Claude Code machine-readable rules | Not by themselves. A program must load and enforce them. |
| Codex or Claude Code | Checks a requested tool call against its policy and chooses allow, prompt, or deny | **Yes.** This is where a shell command is stopped before execution. |
| Managed devcontainer | Keeps the installed policy/hook root-owned, runs as non-root, restricts network and mounts, and adds a few independent guards | It limits the blast radius and protects the setup; it is not a general-purpose interpreter of shell-command intent. |

The resulting path is:

```text
Agent wants to use Bash
        |
        v
Codex rules OR Claude pre-tool hook classify the exact command
        |
        +-- allow ------> agent runtime starts the command in the sandboxed container
        |
        +-- prompt -----> agent runtime asks the person and waits
        |
        +-- forbidden --> agent runtime does not start the command
```

#### The concrete example: `git log` versus `git reset --hard HEAD`

`git log` is a read-only history query. It is green, so it can run without an
interactive approval prompt. `git reset --hard HEAD` discards tracked changes,
so it is red: it must not run, even if an agent tries to package it into a
longer shell command. “Without a prompt” here means “already permitted by the
reviewed project policy”; it does **not** mean unrestricted shell access.

| Requested command | Codex in the managed container | Claude Code in the managed container |
|---|---|---|
| `git log` | Matches the `git log` `allow` prefix rule, so Codex runs it | The pre-tool hook classifies it as `allow`, so Claude runs it |
| `git reset HEAD~1` | Matches the general `git reset` `prompt` rule, so Codex asks first | The hook recognizes general reset as sensitive and returns `ask` |
| `git reset --hard HEAD` | Matches both `git reset` = `prompt` and the more-specific `git reset --hard` = `forbidden`; the most restrictive match wins | The hook recognizes `reset --hard` and returns `deny`; Claude Code does not invoke Bash |

This is deliberately defense in depth. Codex does not rely on a Claude script,
and Claude Code does not rely on Codex rule parsing. Each agent receives a
native enforcement adapter for the traffic-light policy.

#### What `adw:init` creates

Choose `managed-devcontainer` during `adw:init`, review its preview, and apply
it. ADW then renders these files into the **target project** (not into the ADW
plugin source):

```text
.codex/config.toml                    Codex sandbox and approval settings
.codex/rules/adw.rules                 project-level Codex command rules
.claude/settings.json                  project-level Claude policy
.devcontainer/
  devcontainer.json                    starts the managed environment
  Dockerfile                           installs the protected runtime files
  codex-config.toml                    container-local default Codex status line
  codex.rules                          generated Codex command rules for the image
  permission-policy.json              canonical decisions consumed by the hook
  claude-settings.json                 generated managed Claude settings
  claude-statusline.sh                 managed context, limit, and token footer
  claude-permission-hook.mjs           Claude's Bash/MCP classifier
  git-wrapper.sh                       rejects force/delete pushes on its normal path
  allowed-domains.txt                  exact network destination allowlist
  init-firewall.sh                     installs fail-closed network filtering
  adw-managed.json                     records versions and file digests
```

Some of those are static templates, such as `Dockerfile`,
`claude-permission-hook.mjs`, and `git-wrapper.sh`. Others are rendered because
they depend on the project: `.devcontainer/codex.rules` comes from ADW's
`CODEX_RULES` policy, while `.devcontainer/claude-settings.json` includes the
exact allowed domains and web-access mode. Therefore you will not find a
checked-in `plugin/templates/devcontainer/codex.rules` source file.

#### Codex path, step by step

1. `adw:init`/`adw:doctor` write the committed, project-level
   `.codex/rules/adw.rules` (and `.codex/config.toml`) directly into the
   repository, using the same `CODEX_RULES` policy the managed devcontainer
   renders into `.devcontainer/codex.rules`.
2. Codex discovers and reads project-local exec policy from `.codex/` while
   walking from the repository root to the current directory, so the
   committed `.codex/rules/adw.rules` applies automatically inside the
   container without any separate install step. The rules name command
   prefixes and a decision: `allow`, `prompt`, or `forbidden`. The generated
   config also contains exact per-app/per-tool approval modes.
3. Multiple rules may match. The most restrictive decision wins. Thus the
   general `git reset` prompt rule cannot accidentally weaken the specific
   `git reset --hard` forbidden rule.
4. If allowed, Codex still runs inside its workspace-write sandbox and inside
   the managed container. The rules do not grant host access, arbitrary mounts,
   or unrestricted network access.

The managed image still contains a root-owned, read-only
`/etc/adw/codex.rules` built from the same policy, but nothing installs it
into the `vscode` user's home directory: `~/.codex` is an isolated,
container-scoped named volume (see "Isolation modes" above), and a project's
exec policy must not be written somewhere it would leak into every other
ADW-managed container on the same host account.

#### Claude Code path, step by step

1. The managed image installs a root-owned, read-only Claude settings file at
   `/etc/claude-code/managed-settings.d/20-adw.json` and a root-owned hook at
   `/usr/local/bin/adw-claude-permission-hook`.
2. Those managed settings register the hook for every `Bash` call (and for MCP
   calls). Claude Code runs the hook *before* it runs the requested tool.
   The hook reads the root-owned `/etc/adw/permission-policy.json` generated
   from the same canonical policy as Codex's rules.
3. The hook parses shell segments and recognizes dangerous forms, including
   force pushes, `git reset --hard`, forced cleans, credential export, merges,
   publishing, deployment, and ambiguous sensitive syntax.
4. The hook returns `allow`, `ask`, or `deny`. Claude Code honors that result:
   `ask` produces an approval request; `deny` prevents Bash from starting. If
   the hook itself cannot safely parse its input, it fails closed.
5. Claude's own sandbox and the container restrictions still apply after an
   `allow` decision.

#### What the container enforces independently

The policy decision is not the only protection. The managed container also
enforces technical limits that do not depend on an agent making a good choice:

- It runs the development user as non-root and drops most Linux capabilities.
- It does not mount the SSH directory, cloud credentials, or Docker socket. The
  only host paths it touches at all are read-only staging mounts of
  `~/.codex`/`~/.claude`, used once by root-owned `post-create` to copy an
  existing login into the container's own isolated credential volumes.
- Its firewall/proxy starts fail-closed and allows HTTPS only to the generated,
  exact domain allowlist; it checks TLS SNI as well.
- Its normal `git` path is a root-owned wrapper that rejects force/delete push
  forms before delegating to `/usr/bin/git`. This is an extra guard, not the
  sole Git policy: calling `/usr/bin/git` does not receive the wrapper's
  automatic approval and still goes through the agent runtime's policy.

There is an important limit to understand: a container cannot generally decide
whether arbitrary text such as `sh -c '...'` is safe. That is why enforcement
begins at the agent tool boundary, before Bash runs, and why ambiguous sensitive
commands are treated as yellow (ask) or red (deny), rather than silently
allowed.

#### How to inspect and verify it

Read the generated files in your project, especially
`.devcontainer/codex.rules`, `.devcontainer/claude-settings.json`, and
`.devcontainer/permission-policy.json`, and
`.devcontainer/claude-permission-hook.mjs`. Do not edit managed files casually:
they are part of the security contract and require a reviewed `adw:init` or
`adw:doctor` repair flow.

Run:

```bash
adw doctor --checks permissions
```

before execution work to verify that the project-level Codex/Claude policies
are present and unchanged. Run the full `adw doctor` from inside the managed
container to also verify the managed files, runtime marker, hardening, network
allowlist, and recorded digests. A mismatch fails the check rather than being
silently accepted.

#### Customize provider commands and tools without editing generated files

Put provider decisions in `adw.yaml`. Built-in mappings cover supported
GitHub, Notion, and Datadog CLI shapes. For MCP or Codex app tools, bind the
exact runtime tool name to one operation:

```yaml
permissions:
  providers:
    github:
      app: github
      mcp_server: github
      operations:
        read: allow
        comment: allow
        create: ask
        update: ask
        merge: deny
      tools:
        get_pull_request: read
        add_comment: comment
    notion:
      operations:
        read: allow
        create: ask
        update: ask
    datadog:
      operations:
        read: allow
        create: ask
        update: ask
        delete: deny
```

`app` is the Codex app identifier. `mcp_server` is the middle part of Claude's
tool name: `mcp__<server>__<tool>`. Tool mappings are exact on purpose. A new,
misspelled, or unmapped tool asks instead of inheriting a broad write grant.
Because `allow` removes a human checkpoint, only exact tool-to-operation
mappings reviewed in ADW's provider catalog may use it; other exact tools can
still be set to `ask` or `deny`. Any non-read `allow` also requires that the
same provider is declared under `providers` with `access: read-write`.

The immutable safety floor still wins. For example, configuring
`github.merge: allow` is rejected, and `git reset --hard` remains denied. After
editing `adw.yaml`, run the doctor repair preview/apply flow, rebuild the
container, then run full `adw doctor` inside it.

To inspect a provider decision without executing it, pass an argv array or an
exact tool name as JSON:

```bash
printf '%s\n' '{"argv":["gh","pr","comment","42"]}' \
  | adw permissions-explain --project-root .

printf '%s\n' '{"tool":"mcp__github__add_comment"}' \
  | adw permissions-explain --project-root .
```

### Isolation modes

| Mode | Meaning | Important reality check |
|---|---|---|
| `provider-sandbox` | Use the agent provider's own sandbox; lightweight explicit alternative | ADW must inspect and state the real active policy; it cannot infer it from a file |
| `project-devcontainer` | Use an existing project container untouched | It needs a runtime marker (`ADW_PROJECT_DEVCONTAINER=1` or equivalent) to prove it is active |
| `managed-devcontainer` | ADW renders and manages a hardened container; the init default when there is no project-owned container | It cannot replace an existing project-owned `.devcontainer/` |

Managed containers run non-root, drop Linux capabilities except a tiny named
set, use a fail-closed egress proxy with exact allowlisted HTTPS domains and SNI
matching, avoid Docker sockets/SSH mounts/other host credential directories,
use project-scoped credential volumes, pin agent versions, and install a Git
wrapper that blocks dangerous pushes. Codex and Claude credentials get a
one-time exception at container creation: a read-only staging mount of the
host's real `~/.codex`/`~/.claude` lets root-owned `post-create` copy an
existing login into each tool's own volume, so you don't have to reauthenticate
in every container. Nothing else about those host directories — session state,
sockets, host-only config — is shared. `public-pages` is an intentional,
bounded public-read exception; `hosted-only` keeps network use to configured
domains.

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
| `observability` | Datadog | `read`; configured writes remain approval-gated unless explicitly allowed |
| `knowledge` | Notion | `read`, `create`, `update`, `link` |

The transport can be a built-in connected tool, MCP, authenticated CLI, or API.
Configuration can select one; otherwise ADW prefers an available authenticated
transport in that order. An absent optional capability is not probed and does
not block the local workflow. A required capability blocks only the step that
needs it when unavailable.

Every external write not explicitly configured as `allow` follows the same safety dance: read current state, show
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
| `permissions-explain` | Explain one provider command/tool decision without executing it |
| `init-preview` / `init-apply` | Safely preview and initialize ADW-managed files |
| `refresh-preview` / `refresh-apply` | Safely preview and repair generated files |
| `doctor` | Run read-only deterministic readiness checks |
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

### Why branch and worktree preparation stays in the skill, not the CLI

Parallelism is useful only when it is honest, but deciding whether a proposed
branch name or worktree path is fine is a judgment call informed by the plan
and the user, not a fixed contract. `adw:execute` checks project paths for
overlap, inspects `git worktree list` and `git show-ref` for existing branch
and worktree state, and creates or asks about the correct isolated workspace
using ordinary Git — no dedicated CLI command or marker commit is involved. It
does not decide tasks, spawn agents, edit code, commit implementation, push, or
delete anything; those actions need judgment or consent outside this step.

## A practical first week

### Day 1: establish your footing

1. Run `adw:onboard` in an initialized checkout. Use `adw:init` only when the
   project has not been set up—not merely because `adw.yaml` is absent.
2. Run `adw:doctor` until it reports a ready environment. If it proposes a
   repair, read the exact files in its preview before approving.
3. Run `adw:status`. Treat its recommended next action as your starting point.

### First task: favor understanding over speed

1. Pick a task with a visible outcome and existing tests if possible.
2. Ask for `adw:plan`, even if the task looks modest. Read the feature overview
   first; then check the phase's exact write paths and validation.
3. Confirm only the phase you mean to run. You can approve a later phase later.
4. After execution, read the outcome, the validation result, and the diff
   summary. A green check is useful evidence, not a reason to skip review.
5. Approve a push or draft PR only if you want that external action now.

### A habit that pays off

At the beginning and end of a work session, run `adw:status`. It is read-only,
safe to run, and gives you a reliable handoff to your future self or a teammate.

## When something feels odd

| Symptom | Best next move |
|---|---|
| `adw.yaml` is missing | This is normal; ADW uses defaults and discovery. Add it only for shared policy or overrides |
| `adw.yaml` is invalid | Make a deliberate maintainer edit; doctor will not guess or rewrite it |
| A generated permission/container file drifted | Run `adw:doctor`, inspect its refresh preview, approve only the listed repair if correct |
| A plan's groups touch the same file | Put them in one group or sequential phases; do not claim they are parallel |
| An execution was interrupted | Run `adw:status`; branches, commits, and worktrees reconstruct the state |
| Provider auth is absent | Authenticate through the intended provider flow; do not add secrets to config |
| A review comment changes the design | Return to plan/re-plan; `adw:address-review` is for in-scope corrections |
| You are unsure whether an action is allowed | Treat it as yellow: describe its exact effect and ask the person first |

## The final idea

ADW is intentionally not an autonomous delivery system. It makes a good
developer workflow easier to repeat: inspect first, plan clearly, isolate work,
review independently, validate honestly, commit locally, and ask before any
irreversible or external step. Its internals exist to make that behavior
recoverable and hard to accidentally bypass—not to hide it behind automation.
