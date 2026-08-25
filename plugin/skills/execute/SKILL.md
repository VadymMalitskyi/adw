---
name: execute
description: Carry out a confirmed plan phase through ADW's deterministic native-provider workflow, Git gates, configured validation, and a coordinator-owned summary.
disable-model-invocation: true
---

# Execute a phase

You are the coordinator, not the implementer. You own Git, confirmation, and
every external action. The deterministic workflow executes an already-confirmed
packet; it does not interpret Markdown as authorization. Workers never commit,
push, create tracker items, open pull requests, or perform an external action.
ADW never merges, marks a pull request ready, releases, deploys, or force-pushes.

Read `<plugin-root>/authorization.md` and follow it throughout. Resolve the
plugin root as described there.

## 1. Confirm the phase and exact packet

1. Run node <plugin-root>/bin/adw.mjs config and require exit 0. Retain
   `git.base_branch` and the normalized `validation_commands`.
2. Run node <plugin-root>/bin/adw.mjs doctor --checks permissions. If policy has
   drifted, stop and invoke `adw:doctor` to preview and repair it.
3. Verify that configured isolation is the active runtime. A workflow is a
   guardrail, not a replacement for provider policy or isolation.
4. Read the plan and the component documentation it needs, following the
   documentation-branch contract in `<plugin-root>/authorization.md`. Derive
   one bounded group packet per independent group: `group_id`, complete
   `tasks`, exact project-relative `affected_paths`, `branch`, `worktree`, and
   validation references as exact `{component, cwd, command}` tuples selected
   from `validation_commands`.
5. Resolve the work-tracker intent for this phase. Take the intent the plan
   states, following the four intents in `<plugin-root>/integrations/contracts.md`.
   When `providers.work_tracker` is configured and the plan states no intent,
   use **one child item per execution group**. When the capability is absent,
   the intent is **none** and the rest of this skill's tracker steps do not run.
6. Restate the phase, groups, write paths, branches, worktrees, validation
   tuples, selected provider route, and the tracker intent with the exact items
   it will create and the states it will move them through. Preview the exact
   normalized packet and ask the user to confirm it. Conversation confirmation
   authorizes this one packet; there is no approval artifact, plan digest, or
   durable run record.

Do not execute a phase that has no configured validation tuples capable of
matching its required checks. A packet-supplied shell command is never itself
authorization to run a validation command.

## 2. Open the work items

You own every tracker write; workers never make one. Read the provider
reference for the configured `work_tracker` provider under
`<plugin-root>/integrations/providers/` and use only the four provider-neutral
operations. The configured provider plus the confirmed intent is the
authorization for the non-terminal `create`, `update`, and `link` writes below;
you do not ask again per item.

Before creating anything, search for an object already carrying the idempotency
marker `adw:<project>:<change-id>:<group-id>:<operation>` and reuse a verified
match. A rerun after an interruption must adopt the existing items, never
duplicate them.

For the child-per-group intent, create one item per confirmed group, parented to
the plan's item, and `link` it to the group's branch. Carry the `group_id` and
branch in the item so a person can map an item back to its worktree.

ADW moves an item exactly once, using the provider reference's mapping for these
two neutral states:

| Group reaches | Item state |
|---|---|
| Created for a confirmed packet, worker not yet launched | not started |
| Implementation worker launched | in progress |

That is the whole lifecycle. Do not move an item for review, fix, failure,
passing validation, or a completed commit, and never close, resolve, or
transition it to a terminal state. Once a group is in progress its item stays
there, and a person decides every state after that. Report progress in the
conversation and in Git, not by driving the board.

Read each write back from the provider, compare the material fields, and report
the stable external id and canonical URL. A tracker write that fails never fails
the group: report the uncertainty and continue the Git and validation gates,
which are the authoritative evidence.

## 3. Prepare isolation and preflight

Resolve the base commit with `git rev-parse <base-branch>`. Before creating a
group worktree, inspect `git worktree list --porcelain`, the branch ref, and
the destination on disk. Refuse an occupied, symlinked, dirty, ambiguous, or
mismatched target. Refuse duplicate branch/worktree values or exact and
parent/child affected-path overlap.

For a new group, use:

```
git worktree add -b <branch> <worktree-path> <base-commit>
```

For an existing attached branch/worktree, report its merge base, commits since
base, and dirty files, then obtain fresh confirmation before continuing. Git
can show evidence but cannot prove an old task packet still applies.

Pass the confirmed packet to the shared gate on stdin:

```
node <plugin-root>/bin/adw.mjs execution-preflight --project-root <absolute-project-root>
```

Require its schema-valid execution envelope. It captures clean-start Git HEAD
and status evidence for targets, the coordinator checkout, and registered
non-target worktrees; it also verifies exact validation references. On a
malformed packet, nonzero result, or malformed envelope, stop without launching
workers.

## 4. Run the groups

Use exactly one provider route for the preflight envelope:

- **Codex:** invoke `<plugin-root>/workflows/adw-execute-phase-codex.mjs` with
  the envelope on stdin. It launches noninteractive `codex exec` workers with
  the active project policy; do not add a sandbox override, bypass flag, ignore
  flag, or approval-bypass flag. It emits bounded lifecycle NDJSON and one
  terminal `workflow.completed` event.
- **Claude Code:** drive the stages yourself with in-session subagents, one
  subagent per stage per group, launching independent groups concurrently. A
  subagent inherits this session's billing identity; never shell out to
  `claude -p`, an API adapter, or any other billing route to run a stage.

Both routes use the same fixed group sequence: implementation, fresh review,
optional fix, fresh re-review. A group has at most two fix/re-review cycles. A
stage result is only a candidate: unresolved high findings, a malformed result,
or a stage failure makes that group fail. A group's own stages are ordered, but
groups never wait on each other: one failed group must not cancel independent
groups, and no group is held at a stage boundary until another catches up.

Give each stage subagent only its own group's worktree, affected paths, and
tasks. An implementation or fix subagent may edit only inside the group's
worktree and only within its affected paths. A review subagent inspects and
reports; it never edits. No stage subagent may commit, push, create external
objects, or touch another group's worktree.

After every stage, gate the group before starting the next one:

```
node <plugin-root>/bin/adw.mjs execution-assert-target --project-root <absolute-project-root>
```

Supply `{execution_envelope, group_id}` on stdin. It requires HEAD to still
match the preflight baseline and every changed path to stay inside the group's
affected paths, and it returns the group's current `snapshot` — a digest over
both the changed paths and their bytes. Pass that value back as `since` on the
gate call after a review stage, so a review that edited anything is caught
rather than trusted. A nonzero exit fails that group; do not start its next
stage.

## 5. Finalize authoritatively

Invoke the shared finalizer even when the provider result failed, so it can
report unintended Git mutations:

```
node <plugin-root>/bin/adw.mjs execution-finalize --project-root <absolute-project-root>
```

Supply the execution envelope and the typed provider result exactly as its
documented input contract requires. Codex returns that result directly; on the
Claude route, assemble it from the stage outcomes you observed, reporting a
group as passed only when its own gates passed. Require a schema-valid, zero-exit final
result before reporting success. The finalizer independently rechecks HEAD,
scope, and non-target snapshots; reloads each exact configured validation tuple;
runs only those commands in confined real directories; and repeats the Git
gates after every validation command. Provider-reported validation is never
authoritative.

Report a required validation that exits nonzero, is signaled, times out, or is
unrun as a failure. Safe results intentionally omit prompts, raw provider
events, command output, environment values, and credentials. If diagnostics are
needed, rerun the already-confirmed command interactively and report that
separately.

## 6. Commit, report, and recover

Stage workers and the finalizer never commit or make an external provider
operation. After a passing final result, commit each group's work on its own
branch. The group's work item stays in progress; do not advance or close it.
Pushing, pull requests, merges, releases, deployments, any further work-item
state, and other external writes each need separately named approval.

Summarize the safe final result and Git evidence per group: branch, HEAD,
provider outcome, review/fix outcome, configured-validation outcome, work-item
id and URL, and any remaining failure. `groups_passed` means execution gates
passed; it never means the independently produced branches were integrated, and
it never means a work item is done. Whole-phase/integration validation needs a
separately authorized integration step.

There is no ADW-owned durable execution state. Stage progress lives only in this
session and in the group worktrees. After
an interruption across sessions, use `adw:status`, inspect Git branches and
worktrees, search the tracker for items carrying this change's idempotency
marker, derive a fresh packet, and obtain fresh confirmation. Existing items are
evidence about a prior run, never authorization to continue it.

For cleanup, give the user the exact `git worktree remove <worktree>` and
`git branch -d <branch>` commands to run after merge or abandonment. ADW never
removes a branch or worktree by itself.
