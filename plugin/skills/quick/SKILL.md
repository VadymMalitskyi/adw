---
name: quick
description: Implement a genuinely small, low-risk change on exactly one branch with focused tests, whole-diff review, and real validation. Use when the user explicitly asks for a quick change that needs no plan.
disable-model-invocation: true
---

# Make a quick change

Quick mode removes the plan. It removes nothing else: the branch, the review,
the tests, the validation, and the authorization boundary all stay.

Read `<plugin-root>/authorization.md` and follow it throughout. Resolve the
plugin root as described there.

## 1. Bound the change

Run `adw config` and `adw doctor --checks permissions`; stop on drift.

Restate the change in one or two sentences and name the files you expect to
touch. If the answer is more than a handful of files, or you cannot describe the
change without hedging, this is not a quick change: say so and offer `adw:plan`.

Quick mode is wrong for anything that changes an interface other code depends
on, alters security or permission behavior, needs a migration, or touches more
than one component.

There is no planning phase here, so this step is where you orient yourself.
Following "Read the documentation branch" in
`<plugin-root>/authorization.md`, read `docs/architecture.md`, apply
`docs/conventions.md`, and read the component documentation for the area you
are about to touch. The component page also makes the boundary above checkable:
`docs/components/<component>.md` is where responsibility and owned paths are
written down, so it is the evidence for whether this change stays inside one
component or crosses two.

## 2. Open the work item

Skip this section when `providers.work_tracker` is absent; a quick change needs
no tracker item to proceed.

When it is configured, read that provider's reference under
`<plugin-root>/integrations/providers/` and use only the four provider-neutral
operations. A quick change has no groups, so it takes one item for the whole
change — the parent-item intent in `<plugin-root>/integrations/contracts.md`.
The configured capability plus the change you restated in step 1 is the
authorization for that bounded write; you do not ask again.

Search for an object already carrying the idempotency marker
`adw:<project>:<change-id>:<operation>` before creating, and reuse a verified
match. Quick items are plan-level, so the marker carries no group id.

Create the item in **not started**, then move it to **in progress** once you
begin the change in step 3. That single move is the whole lifecycle: do not
move it for review, validation, a commit, or a failure, and never close,
resolve, or transition it to a terminal state. A person owns every state after
in progress.

Read the write back, and report the stable external id and canonical URL. A
tracker write that fails never blocks the change: report the uncertainty and
carry on with the branch, the review, and validation, which are the real
evidence.

## 3. Work

Create one branch off the configured base branch — creating a local branch is
allowed without asking. Make the change there.

Add or extend the test that would have caught the problem. A quick change with
no test is only acceptable when the change genuinely cannot be tested, and you
must say why.

## 4. Review the whole diff

Spawn an independent review agent on the complete diff — not on your summary of
it. Ask for correctness problems first. Address what you agree with; report what
you rejected and why.

## 5. Validate

Run explicit validation overrides when present; otherwise derive focused
validation from repository manifests and CI, show it before running, and report
the real output.
Never call a check passed unless you ran it and saw it pass. Say plainly if
something was skipped.

## 6. Finish

Commit on the branch. Committing is allowed; pushing is not. The work item stays
in progress; do not advance or close it.

Summarize the change, the diff, the test you added, the validation result, and
the work-item id and URL. Then ask separately before anything external: push,
pull request, any further tracker state. Follow
`<plugin-root>/integrations/contracts.md` for configured providers. Never merge,
mark a pull request ready, release, deploy, or force-push.
