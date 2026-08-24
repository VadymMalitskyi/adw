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

## 4. Run the selected native workflow

Use exactly one provider-native route for the preflight envelope:

- **Codex:** invoke `<plugin-root>/workflows/adw-execute-phase-codex.mjs` with
  the envelope on stdin. It launches noninteractive `codex exec` workers with
  the active project policy; do not add a sandbox override, bypass flag, ignore
  flag, or approval-bypass flag. It emits bounded lifecycle NDJSON and one
  terminal `workflow.completed` event.
- **Claude Code:** call the native Workflow tool with
  `{name: "adw:execute-phase", args: executionEnvelope}`. Wait for its terminal
  result, validate the returned object against the shared result contract, and
  map missing, null, stopped, or malformed output to a typed provider failure.
  Never fall back to `claude -p`, an API adapter, or a different billing route.
  The Workflow uses the active interactive session's billing identity; display
  subscription identity when known and say it is unknown when it cannot be
  established.

Both routes settle independent groups concurrently and use the fixed group
sequence: implementation, fresh review, optional fix, fresh re-review, then
provider finalization. A group has at most two fix/re-review cycles. A worker
result is only a candidate: unresolved high findings, a malformed result, or a
worker failure makes that group fail. One failed group must not cancel
independent groups.

Codex additionally checks Git HEAD/status and read-only review behavior between
worker processes. Claude Workflow agents are instructed to be read-only during
review, but their authoritative Git/scope check happens after the native
workflow returns; do not claim identical inter-stage assurance.

## 5. Finalize authoritatively

Invoke the shared finalizer even when the provider result failed, so it can
report unintended Git mutations:

```
node <plugin-root>/bin/adw.mjs execution-finalize --project-root <absolute-project-root>
```

Supply the execution envelope and the typed provider result exactly as its
documented input contract requires. Require a schema-valid, zero-exit final
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

The native workflow and finalizer never commit or make an external provider
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

There is no ADW-owned durable workflow state or `resumeFromRunId`. Claude may
resume a paused native Workflow only within the same interactive session. After
an interruption across sessions, use `adw:status`, inspect Git branches and
worktrees, search the tracker for items carrying this change's idempotency
marker, derive a fresh packet, and obtain fresh confirmation. Existing items are
evidence about a prior run, never authorization to continue it.

For cleanup, give the user the exact `git worktree remove <worktree>` and
`git branch -d <branch>` commands to run after merge or abandonment. ADW never
removes a branch or worktree by itself.
