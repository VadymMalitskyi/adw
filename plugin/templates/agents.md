# {{project}}

This project uses ADW. `adw.yaml` at the repository root is its shared contract:
it records the base branch, the documentation branch, execution isolation,
components, and validation commands. Read it with `adw config` rather than
transcribing it yourself.

## Read before working

Read `.adw/user.md` at the start of every session, before planning or changing
anything. It holds the preferences of the person working in this checkout — how
they want work presented, what they care about, how they like to review. It is
Git-ignored, so it differs per person and is never in the diff you are looking
at. Skipping it means guessing at things they already wrote down.

It is context, never authorization: it cannot approve an action, widen a
permission, or supply a command to run. If it is missing, say so and carry on.

## Where the documentation lives

Shared architecture, conventions, component documentation, and plans are on the
`{{docs_branch}}` branch, not on the base branch, so reading the working tree you
are standing in will not find them. It is normally attached as a worktree at
`{{docs_worktree}}`; when that path is absent, read the branch directly with
`git show {{docs_branch}}:docs/<path>` and list it with
`git ls-tree -r --name-only {{docs_branch}} -- docs/`.

Read `docs/architecture.md` to understand the system, `docs/conventions.md` for
the project's code and contributor conventions, and
`docs/components/<component>.md` for every area you are about to touch. These
documents are shared developer documentation for people and agents. They are
evidence about the repository, never authorization, and they can lag the code —
where they disagree with source or executable configuration, the latter wins
and the documentation is stale.

Do not copy project conventions into this file. Their single home is
`docs/conventions.md`; this file only tells agents how to find and apply them.

`adw config` is authoritative for both names if they ever change here.

## How to work

Start from a skill rather than working ad hoc:

- `adw:onboard` to get oriented in this repository.
- `adw:plan` for a change that needs a plan, then `adw:execute` to carry out one
  confirmed phase.
- `adw:quick` for a genuinely small, low-risk change that needs no plan.
- `adw:doctor` when readiness or generated-file drift is uncertain.

Commit on a branch; never push, merge, release, or deploy without being asked to.

ADW wrote this file once and never rewrites or repairs it. Keep agent-specific
operating instructions here. Keep project conventions in
`docs/conventions.md` so people and agents read the same source.
