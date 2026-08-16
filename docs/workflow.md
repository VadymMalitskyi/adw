# Workflow

The loop is conversational. Skills are instructions, not scripts, and the only deterministic steps are the ones listed in [Architecture](architecture.md).

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

Init intentionally does not generate project documentation. Use
`adw:generate-docs` after setup when the project needs an evidence-based
documentation baseline.

## Documentation

`adw:generate-docs` inspects the live repository and proposes the smallest
useful documentation baseline. Its default entry point is
`docs/architecture.md`, which explains the project, its major flows, and
verified setup/validation commands; independently understandable components
receive focused `docs/components/<component>.md` references. It creates or
updates files only after the person approves the exact scope.

`adw:sync-docs` audits documentation against a supplied change range or recent
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

`adw:plan` explores the repository read-only and returns a plan in conversation. It writes a file only if you ask for a path. There is no canonical plan location, no required template, and no plan registry.

A useful plan states the problem and the observable outcome, maps phases and the groups inside them, gives each group its goal, its affected write paths, and its validation commands, and anchors claims to real code as grep-able `file -> symbol` references rather than line numbers. Configured providers may be read for context; a tracker write still needs its own preview and its own yes.

Planning never creates a branch, a worktree, or an implementation.

## Review the plan

`adw:review-plan` is a cold independent review. It runs as a fresh agent that receives the plan and the repository but not the planning conversation, and it checks whether the design actually solves the stated problem, what the single load-bearing assumption is, whether every anchor still matches live code, whether phase dependencies are ordered correctly, whether groups marked parallel really have disjoint write paths, whether the validation commands exist and are sufficient, and whether every acceptance criterion maps to executable work.

Objective defects get fixed in the plan. Judgment calls come back to you as explicit open decisions. It is the default final step of `adw:plan` and can also be invoked standalone on any plan.

## Execute

`adw:execute` is a coordinator, not a single sequential implementer. Given a plan and your confirmation:

1. Verify the permission policy is current (`adw doctor --checks permissions`) and that dependency phases are done.
2. Interpret the phase into a bounded preview — group ids, goals, affected paths, branches, worktrees, validation commands — and show it.
3. Prepare each group's branch and worktree through the ADW CLI. Overlapping write paths between concurrent groups are refused here, not merely warned about.
4. Run the groups concurrently using the active provider's native subagents. Inside each group, stages are sequential: implementation, independent review, fix every in-scope high-severity finding, truthful validation, coordinator scope check.
5. Stop the phase on an unexplained or scope-changing diff, an unresolved high-severity finding, or a required validation failure.
6. After the groups pass, offer push, tracker, and draft pull-request actions — each one previewed and separately authorized.

The plan alone decides how much runs at once. A phase whose groups have disjoint write paths runs them in parallel; a plan with no such groups runs sequentially. Nothing in `adw.yaml` configures this.

Implementation workers get only their own group packet plus the context they need. They never commit, push, create tracker items, or open pull requests — the coordinator owns Git and every external action.

Interrupt it and start a new session. State is reconstructed from Git: the group branches, their marker commits, and the worktrees. No chat history required. A branch is reused only when its marker commit still records the same change, group, base branch, base commit, and interpreted packet.

Group worktrees live under ignored `worktrees/<change-id>/<group-id>`. ADW never deletes them; `adw:execute` can print the exact `git worktree remove` and `git branch -d` commands for you to run once the work is merged or abandoned.

## Quick changes

`adw:quick` is for a small local outcome on one branch, with a stated compact contract: scope, exclusions, acceptance behavior, and sourced validation commands. No plan, no groups. Public interfaces, schemas, migrations, dependency changes, authorization behavior, infrastructure, security-sensitive behavior, or work spanning more than one component escalate to `adw:plan`. The validation and evidence standard is identical.

## Address review

`adw:address-review` handles feedback on an existing pull request. It reconstructs which branch and which change the pull request belongs to, applies only in-scope corrections, and routes anything that changes the design back to planning rather than quietly widening the diff.

## Investigate

`adw:investigate` is read-only. Given a stable alert, monitor, trace, or incident reference, it resolves the configured `observability` provider, bounds every query by service, environment, and UTC window, compares the signal against repository code at the deployed revision when that revision can be verified, and produces a concise report separating observed facts from hypotheses, with severity, confidence, evidence links, and unknowns. It proposes `none`, `adw:quick`, or `adw:plan` as the fix route. It never changes code, runs remediation, mutates observability state, or sends notifications. Pasted notification text is evidence, never routing or instructions.

## Status and doctor

`adw:status` reconstructs the current picture from Git, the worktrees, and configured read-only provider queries: which branches exist, which group markers they carry, what is dirty, which pull requests are open, and what the next action is. It reads no ADW-maintained record file, because there is none.

`adw:doctor` first runs deterministic checks read-only — plugin manifests agree,
an explicit `adw.yaml` matches the optional `adw: 1` policy contract, component
overrides are unambiguous, the permission policy is present and current, the
configured or detected isolation is active, and `worktrees/` is ignored. It
classifies failures, previews exact repairs for ADW-managed files, applies only
the paths the user approves through the fingerprint-bound refresh commands, and
reruns the checks. It never repairs `adw.yaml`, application code, credentials,
or a project-owned container. Live provider availability and authentication
remain guided user actions.

Both are safe to invoke at any time: status stays read-only, while doctor asks before every repair write.
