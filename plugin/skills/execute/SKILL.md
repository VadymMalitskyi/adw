---
name: execute
description: Carry out one phase of a confirmed plan by preparing isolated branches and worktrees for its parallel groups, spawning implementation and review agents, running the project's validation commands, and summarizing outcomes from Git. Use when the user asks to execute or implement a plan.
---

# Execute a phase

You are the coordinator, not the implementer. You own Git and every external
action. Subagents write and review code inside their own worktree; they never
commit, push, create tracker items, or open pull requests. ADW never merges,
marks a pull request ready, releases, deploys, or force-pushes.

Read `<plugin-root>/authorization.md` and follow it throughout. Resolve the
plugin root as described there.

## 1. Confirm what you are executing

1. Run `adw config` and require exit 0. Retain `git.base_branch` from its
   validated configuration.
2. Run `adw doctor --checks permissions`. If the permission policy has drifted,
   stop and invoke `adw:doctor` to preview and repair it — execution must not
   proceed on a weakened policy.
3. Verify the configured isolation is the active runtime, per the authorization
   contract.
4. Identify the plan and the specific phase. Restate to the user, in your own
   words: the phase, its groups, each group's write paths, the branch and
   worktree you propose for each group, and the validation that will run. Ask
   them to confirm.

That confirmation is the authorization. There is no approval file, no plan
digest, and nothing to verify against a stored record.

## 2. Derive group packets

Turn the confirmed phase into bounded packets — one per group:

- `group_id`: a short lowercase identifier;
- `tasks`: the interpreted instructions, complete enough for an agent that never
  sees this conversation;
- `affected_paths`: the exact project-relative paths the group will write;
- `branch`: the Git branch the group's work lands on. Propose
  `adw/<change-id>/<group-id>` as a readable default, but it is an ordinary
  execution-time choice — the plan or the user may hand you any valid Git
  branch name instead, and you pass it through unchanged;
- `worktree`: the local path for the group's isolated checkout. Propose
  `worktrees/<change-id>/<group-id>` with the same latitude;
- `validation`: the commands that prove the group works, drawn from
  `validation_commands` in `adw config`.

Groups within a phase must have disjoint write paths, branches, and worktree
paths. If write paths overlap, the plan is wrong for parallel execution: split
it differently or run the overlapping work sequentially in one group.

## 3. Prepare isolated branches and worktrees

Resolve the base commit yourself: `git rev-parse <base-branch>`.

Before creating anything, inspect native Git state for every group:

- `git worktree list --porcelain` — is the planned worktree path already
  attached, and to what branch?
- `git show-ref --verify --quiet refs/heads/<branch>` — does the branch already
  exist?
- Does the planned worktree path already exist on disk, and is it empty, a
  symlink, or occupied by something unrelated?

If a branch or worktree path is already in use for something else, or the
target is occupied or ambiguous, stop and resolve it with the user before
preparing anything — never force past it.

If a group's branch already exists and its worktree is already attached,
treat it as a resumed attempt rather than a fresh one: report what Git can
actually establish — whether the worktree is attached to the requested branch,
its merge base with the selected base branch, the commits it holds since that
base, and any dirty files — and confirm with the user before continuing to
work in it. There is no marker commit or packet digest to check against; Git
state is the only evidence, and it cannot prove the resumed work still matches
an earlier task packet.

For a genuinely new group, create its branch and worktree with native Git:

```
git worktree add -b <branch> <worktree-path> <base-commit>
```

Do not create an empty marker commit. The group's own commits, once work
starts, are the record of what happened.

## 4. Implement and review

For each group, in parallel:

1. Spawn an implementation agent scoped to that group's worktree. Give it the
   tasks, the write paths, the validation commands, and the instruction that it
   must not leave its worktree, commit, push, or touch anything external.
2. Spawn an independent review agent on the resulting diff. It must not be the
   agent that wrote the code. Ask it for correctness problems first, then
   anything that would fail review.
3. Feed high-severity findings back to the implementer and re-review. Stop when
   the review is clean or when a finding needs a human decision — surface those
   rather than deciding scope yourself.

## 5. Validate

Run the group's configured validation commands directly in its worktree, then
the whole-phase validation. Report the real output.

Never describe a check as passing unless you ran it and saw it pass. If a
command was skipped, timed out, or could not run, say exactly that. A phase with
an unrun required check is not a passing phase.

## 6. Commit and summarize

Commit each group's work on its own branch. Committing is allowed; pushing is
not — ask separately, and ask again for anything else external.

Summarize from Git and your tool results: per group, the branch, the head
commit, review outcome, and validation outcome, plus what remains. Reconstruct
this from `git log`, `git worktree list`, and the run you just did — there is no
record file to read.

## 7. Delivery and cleanup

Push, pull requests, tracker updates, and any other external write each need
their own explicit approval, named exactly. Follow
`<plugin-root>/integrations/contracts.md` for configured providers.

For cleanup, give the user the exact commands for each group — `git worktree
remove <worktree>` and `git branch -d <branch>` — to run once the work is
merged or intentionally abandoned. ADW never removes a branch or worktree by
itself.
