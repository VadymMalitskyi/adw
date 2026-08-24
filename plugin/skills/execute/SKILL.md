---
name: execute
description: Carry out a confirmed plan phase through ADW's deterministic native-provider workflow, Git gates, configured validation, and a coordinator-owned summary.
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
5. Restate the phase, groups, write paths, branches, worktrees, validation
   tuples, and selected provider route. Preview the exact normalized packet and
   ask the user to confirm it. Conversation confirmation authorizes this one
   packet; there is no approval artifact, plan digest, or durable run record.

Do not execute a phase that has no configured validation tuples capable of
matching its required checks. A packet-supplied shell command is never itself
authorization to run a validation command.

## 2. Prepare isolation and preflight

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

## 3. Run the selected native workflow

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

## 4. Finalize authoritatively

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

## 5. Commit, report, and recover

The native workflow and finalizer never commit or make an external provider
operation. After a passing final result, commit each group's work on its own
branch. Pushing, pull requests, tracker updates, merges, releases, deployments,
and other external writes each need separately named approval.

Summarize the safe final result and Git evidence per group: branch, HEAD,
provider outcome, review/fix outcome, configured-validation outcome, and any
remaining failure. `groups_passed` means execution gates passed; it never means
the independently produced branches were integrated. Whole-phase/integration
validation needs a separately authorized integration step.

There is no ADW-owned durable workflow state or `resumeFromRunId`. Claude may
resume a paused native Workflow only within the same interactive session. After
an interruption across sessions, use `adw:status`, inspect Git branches and
worktrees, derive a fresh packet, and obtain fresh confirmation.

For cleanup, give the user the exact `git worktree remove <worktree>` and
`git branch -d <branch>` commands to run after merge or abandonment. ADW never
removes a branch or worktree by itself.
