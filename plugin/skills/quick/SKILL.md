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
Read the component documentation for the area you are about to touch, following
"Read the documentation branch" in `<plugin-root>/authorization.md`. It is also
what makes the boundary above checkable: `docs/components/<component>.md` is
where a component's responsibility and owned paths are written down, so it is
the evidence for whether this change stays inside one component or crosses
two.

## 2. Work

Create one branch off the configured base branch — creating a local branch is
allowed without asking. Make the change there.

Add or extend the test that would have caught the problem. A quick change with
no test is only acceptable when the change genuinely cannot be tested, and you
must say why.

## 3. Review the whole diff

Spawn an independent review agent on the complete diff — not on your summary of
it. Ask for correctness problems first. Address what you agree with; report what
you rejected and why.

## 4. Validate

Run explicit validation overrides when present; otherwise derive focused
validation from repository manifests and CI, show it before running, and report
the real output.
Never call a check passed unless you ran it and saw it pass. Say plainly if
something was skipped.

## 5. Finish

Commit on the branch. Committing is allowed; pushing is not.

Summarize the change, the diff, the test you added, and the validation result.
Then ask separately before anything external: push, pull request, tracker update.
Follow `<plugin-root>/integrations/contracts.md` for configured providers. Never
merge, mark a pull request ready, release, deploy, or force-push.
