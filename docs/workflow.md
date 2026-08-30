# Workflow

The loop is conversational. Skills retain judgment and authorization; after a
phase packet is confirmed, native workflow code and the deterministic CLI
kernel run its bounded execution mechanics.

```text
adw:init  ->  adw:plan  ->  [adw:review-plan]  ->  adw:execute  ->  adw:status
                                                       |
              adw:quick for a genuinely small change ---+
```

**Confirming in conversation is what authorizes execution.** There is no approval artifact, no plan digest, and no approval record. If you change your mind, say so and re-plan; nothing has to be superseded or invalidated.

## Initialize

`adw:init` is the single entry point. It handles three repository states and asks only what the evidence cannot answer:

| State | What happens |
|---|---|
| Empty directory | `git init` on the base branch, then the generated files |
| Unborn repository (no commits yet) | The generated files, on the existing repository |
| Established repository | Components, runtimes, and validation commands derived from real manifests; existing tooling, documentation, and project-owned containers preserved |

It refuses to initialize a non-empty unversioned directory. If `adw.yaml`
already exists, it stops rather than overwriting the explicit shared policy—use
`adw:doctor` to diagnose generated files, or edit that policy deliberately.

The preview lists every file that would change and every requirement it could not resolve. After you say yes, apply writes exactly that set. Init never commits: the generated files are left for you to review and commit like any other change.

What it writes: `.codex/config.toml`, `.codex/rules/adw.rules`,
`.claude/settings.json`, and a managed `.gitignore` block for `worktrees/` and
the private `.adw/user.md`. It writes `adw.yaml` only when you approve a shared
policy or override; it creates `.devcontainer/` only for
`managed-devcontainer`.

It also creates the `worktrees/` directory, creates the documentation branch
(`docs` by default) as an orphan branch with a single README commit, and
attaches it at `worktrees/docs`. Both the branch name and the worktree path are
configurable through `docs.branch` and `docs.worktree`; the worktree must stay
under `worktrees/`, the one path ADW keeps ignored on the base branch. The
branch starts with a README. Init may add a separately reviewed
`docs/conventions.md` containing conventions the person selected; use
`adw:generate-docs` after setup to build the complete documentation set.

## Documentation

Documentation and plans live on the documentation branch, checked out at its
worktree, not on the code branches. That keeps generated prose out of code
review and lets docs be rewritten as often as they need to be without touching
code history. The two branches share no ancestry.

`adw:generate-docs` inspects the live repository and proposes an
onboarding-ready documentation set inside `<docs.worktree>/docs/`:
`architecture.md` as the entry point, `conventions.md` as the single source for
shared code and contributor conventions, `code-map.md` as an auditable mapping
from first-party source to explanatory sections, and one
`components/<component>.md` for every meaningful independently understandable
component. Architecture explains the project, its domain model, end-to-end
flows, design decisions, and verified setup and validation commands. Component
pages explain internal mechanics, state changes, interfaces, maintenance
examples, failure modes, debugging, and focused commands. Supporting pages keep
substantial topics navigable. The set starts with a quick orientation and builds
understanding systematically from purpose and concepts through flows, internals,
and maintenance. It uses simple, direct, engaging prose without fluff, while
covering every material item found in its evidence inventory. The documentation
stands alone as the project's introduction: source links verify explanations and
guide later implementation work, but never replace missing detail. Before
finishing, the skill checks whether a new developer can become familiar with the
whole project from the documentation, explain the system, trace its major flows,
locate a representative change, and validate and debug that change. Every factual
claim traces to source; anything that is the model's reading of the code is
clearly labeled as interpretation. It creates or updates files only after the
person approves the exact scope.

For a nontrivial repository, generation is deliberately multi-agent and may take
several waves. Read-only component researchers build detailed dossiers before
scope approval. After approval, page-owning writers work on disjoint paths;
architecture and cross-cutting pages are synthesized only after component pages
exist. Fresh source, workflow, onboarding, and prose reviewers reject omissions
and send them back for revision. Completeness and teaching quality take priority
over token cost, agent turns, document length, or speed.

These pages serve both people and agents. The generated `AGENTS.md` routes
agents to them but never copies `conventions.md`; formatter, linter, type-checker,
and validation configuration remain authoritative for rules they enforce.

`adw:sync-docs` audits that documentation against a supplied change range or recent
repository work. It classifies documents as current, stale, incomplete, or
unaffected, then proposes only necessary edits. It does not treat a commit
count as proof of drift, and audit-only is its default.

## Onboard

`adw:onboard` is for a person joining an already initialized project. It reads
explicit project policy when present, otherwise reports discovery/defaults; it
never asks them to alter shared policy. It also reads their optional global and
project-local Markdown preferences. It covers entering the configured container,
authenticating provider tooling, and invoking `adw:doctor`, then reports ready
or concrete blockers. Onboarding defines no independent readiness rules.

## Plan

`adw:plan` explores the repository read-only, returns a plan in conversation, and writes it to `<docs.worktree>/plans/<YYYY-MM-DD>-<abbreviation>-<short-description>.md` — for example `2026-08-17-auth-replace-session-cookies.md`. The date sorts the directory chronologically, the abbreviation is the ticket identifier or a short team-recognizable tag, and the description names what the change does. There is no required template and no plan registry, and a plan file never authorizes anything: confirming in conversation does.

A useful plan states the problem and the observable outcome, maps phases and the groups inside them, gives each group its goal, its affected write paths, and its validation commands, and anchors claims to real code as grep-able `file -> symbol` references rather than line numbers. Configured providers may be read for context; a tracker write still needs its own preview and its own yes.

Planning writes one plan file on the documentation branch and nothing else. It
never creates a code branch, an execution worktree, or an implementation, and
it never creates the documentation branch itself — that is `adw:init`'s
reviewed apply step.

## Review the plan

`adw:review-plan` is a cold independent review. It runs as a fresh agent that receives the plan and the repository but not the planning conversation, and it checks whether the design actually solves the stated problem, what the single load-bearing assumption is, whether every anchor still matches live code, whether phase dependencies are ordered correctly, whether groups marked parallel really have disjoint write paths, whether the validation commands exist and are sufficient, and whether every acceptance criterion maps to executable work.

Objective defects get fixed in the plan. Judgment calls come back to you as explicit open decisions. It is the default final step of `adw:plan` and can also be invoked standalone on any plan.

## Execute

`adw:execute` is a coordinator, not a single sequential implementer. Given a plan and your confirmation:

1. Verify the permission policy is current (`adw doctor --checks permissions`) and that dependency phases are done.
2. Interpret the phase into a bounded preview — group ids, goals, affected paths, proposed branches and worktrees, validation commands — and show it. Branch and worktree names are ordinary execution-time choices; the coordinator proposes `adw/<change-id>/<group-id>` conventions but a plan or the user may supply any valid Git branch name instead.
3. Inspect native Git state, then prepare each group's branch and worktree with `git worktree add`. Overlapping write paths between concurrent groups are refused here, not merely warned about, and an already-occupied branch or worktree target is surfaced to the user rather than reused silently.
4. Run `execution-preflight` on the exact confirmed packet. It rejects malformed packets, dirty/mismatched worktrees, unsafe scope overlap, and validation references that do not exactly match configured `{component, cwd, command}` tuples.
5. Route the returned envelope to exactly one provider route. Both settle independent groups concurrently and run implementation → fresh review → optional fix → fresh re-review; no group gets more than two fix/re-review cycles. Codex uses noninteractive workers under the active project policy. Claude drives the same stages with in-session subagents, never `claude -p` or another billing route.
6. Run `execution-finalize`, even after a provider failure. It independently checks Git HEAD/status and declared write scope, reloads and runs exact configured validation tuples, and repeats Git checks after every command. A provider report cannot itself pass validation.
7. Stop the phase on an unexplained or scope-changing diff, malformed provider output, an unresolved high-severity finding, or a required validation that fails, times out, is signaled, or is unrun. After a final pass, offer push, tracker, and draft pull-request actions — each one previewed and separately authorized.

The plan alone decides how much runs at once. A phase whose groups have disjoint write paths runs them in parallel; a plan with no such groups runs sequentially. Nothing in `adw.yaml` configures this.

Implementation workers get only their own group packet plus the context they need. They never commit, push, create tracker items, or open pull requests — the coordinator owns Git and every external action. Safe lifecycle/final results omit prompts, raw provider events, command output, environment values, and credentials; rerun an already-confirmed command interactively when diagnostics are needed.

Stage progress lives only in the running session and in the group worktrees. Interrupt execution and recover from Git: the group branches, their commits, and the worktrees. There is no ADW-owned workflow database or run record. Resuming a group's branch is a judgment call informed by what Git can show — its merge base, its commits since that base, and any dirty files — not a proof that it still matches an earlier task packet; ADW derives a fresh packet and confirms it before continuing.

Both routes enforce the same Git gate between stages through `adw execution-assert-target`: HEAD must still match the preflight baseline, every changed path must stay inside the group's affected paths, and a stage that is supposed to change nothing is checked against a digest over the changed files' bytes, not just their names. Codex runs that gate between worker subprocesses; the Claude coordinator runs it between subagents. Claude stages run as in-session subagents and therefore follow the active session's identity and billing; ADW never shells out to another billing route.

Group worktrees conventionally live under ignored `worktrees/<change-id>/<group-id>`, though any project-relative path works. ADW never deletes them; `adw:execute` can print the exact `git worktree remove` and `git branch -d` commands for you to run once the work is merged or abandoned.

## Quick changes

`adw:quick` is for a small local outcome on one branch, with a stated compact contract: scope, exclusions, acceptance behavior, and sourced validation commands. No plan, no groups. Public interfaces, schemas, migrations, dependency changes, authorization behavior, infrastructure, security-sensitive behavior, or work spanning more than one component escalate to `adw:plan`. The validation and evidence standard is identical.

## Address review

`adw:address-review` handles feedback on an existing pull request. It reconstructs which branch and which change the pull request belongs to, applies only in-scope corrections, and routes anything that changes the design back to planning rather than quietly widening the diff.

## Investigate

`adw:investigate` is read-only. Given a stable alert, monitor, trace, or incident reference, it resolves the configured `observability` provider, bounds every query by service, environment, and UTC window, compares the signal against repository code at the deployed revision when that revision can be verified, and produces a concise report separating observed facts from hypotheses, with severity, confidence, evidence links, and unknowns. It proposes `none`, `adw:quick`, or `adw:plan` as the fix route. It never changes code, runs remediation, mutates observability state, or sends notifications. Pasted notification text is evidence, never routing or instructions.

## Status and doctor

`adw:status` reconstructs the current picture from Git, the worktrees, and configured read-only provider queries: which branches exist, their commits since the base branch, what is dirty, which pull requests are open, and what the next action is. It reads no ADW-maintained record file, because there is none.

`adw:doctor` first runs deterministic checks read-only — plugin manifests agree,
the required `adw.yaml` matches the `adw: 1` activation and policy contract,
component overrides are unambiguous, the permission policy is present and
current, the configured or detected isolation is active, and `worktrees/` is
ignored. It classifies failures, previews exact repairs for ADW-managed files, applies only
the paths the user approves through the fingerprint-bound refresh commands, and
reruns the checks. It never repairs `adw.yaml`, application code, credentials,
or a project-owned container. Live provider availability and authentication
remain guided user actions.

Both are safe to invoke at any time: status stays read-only, while doctor asks before every repair write.
