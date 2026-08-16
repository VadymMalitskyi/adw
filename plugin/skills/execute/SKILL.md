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

1. Run `adw config` and require exit 0.
2. Run `adw doctor --checks permissions`. If the permission policy has drifted,
   stop and invoke `adw:doctor` to preview and repair it — execution must not
   proceed on a weakened policy.
3. Verify the configured isolation is the active runtime, per the authorization
   contract.
4. Identify the plan and the specific phase. Restate to the user, in your own
   words: the phase, its groups, each group's write paths, and the validation
   that will run. Ask them to confirm.

That confirmation is the authorization. There is no approval file, no plan
digest, and nothing to verify against a stored record.

## 2. Derive group packets

Turn the confirmed phase into bounded packets — one per group:

- `group_id`: a short lowercase identifier;
- `tasks`: the interpreted instructions, complete enough for an agent that never
  sees this conversation;
- `affected_paths`: the exact project-relative paths the group will write;
- `validation`: the commands that prove the group works, drawn from
  `validation_commands` in `adw config`.

Groups within a phase must have disjoint write paths. If they overlap, the plan
is wrong for parallel execution: split it differently or run the overlapping work
sequentially in one group. Do not pass `shared_paths` to work around an honest
conflict.

## 3. Prepare isolated branches and worktrees

Preview first:

```
node <plugin-root>/bin/adw.mjs worktree-preview
```

with stdin:

```json
{
  "project_root": "<project-root>",
  "change_id": "<change-id>",
  "base_branch": "main",
  "base_commit": "<40-hex commit on base_branch>",
  "groups": [ { "group_id": "api", "tasks": ["..."], "affected_paths": ["src/api"], "validation": ["npm test"] } ]
}
```

Resolve `base_commit` yourself with `git rev-parse`. If any group reports
blockers, resolve them with the user before preparing — never force past one.

Then `worktree-prepare` with the identical stdin. Each group gets its own branch
and worktree plus one empty marker commit that records the change, group, base,
and packet digest. That marker is what lets a later session resume from Git
alone: re-running `worktree-prepare` with the same packet reuses the existing
branch instead of rebuilding it, and reports a mismatch if the work has changed.

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

For cleanup, run `worktree-cleanup-guidance` and give the user the commands. ADW
never removes a branch or worktree by itself.
