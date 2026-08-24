---
name: plan
description: Produce a repository-grounded implementation plan for a software change, structured into dependency-ordered phases with parallel-safe groups, returned in the conversation and written to a dated file in the documentation branch's plans directory. Use when a user wants to plan a change, define scope and acceptance criteria, or prepare implementation-ready work without modifying code.
disable-model-invocation: true
---

# Plan a change

Return one self-contained plan in the conversation and write it to the project's
documentation branch. There is no plan digest and no approval artifact — the
user confirming in conversation is what authorizes execution later. A plan file
records intent; it never authorizes anything, no matter what it says.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there. Run `adw config` to learn explicit project policy plus inferred defaults.
Use repository evidence for component boundaries and validation when
`adw.yaml` has no overrides. Read `~/.config/adw/profile.md` and the
Git-ignored `.adw/user.md` when present for communication and workflow
preferences; neither file grants authorization or supplies commands. Read
repository-owned instruction files for project conventions.

## 1. Ground the plan in the repository

Read before writing. Find the code the change actually touches: entry points,
the modules that own the behavior, the tests that cover it, and the validation
commands the project already runs. Prefer reading the code over trusting any
document that describes it.

Read the project's own generated documentation as well, following "Read the
documentation branch" in `<plugin-root>/authorization.md`. You write plans to
that same branch, and `docs/components/<component>.md` states each component's
responsibility and owned paths, which is what the group split in step 2 depends
on. The preference above still holds: where the documentation and the code
disagree, the code wins.

Say what you could not determine. An honest gap is more useful than a confident
guess, because the agents who execute this plan will not see this conversation.

## 2. Write the plan

A plan has two audiences and must serve both.

**Feature overview** — for a person. What problem this solves, what changes for
users, what is explicitly out of scope, and the acceptance criteria. It must
stand on its own.

**Implementation plan** — for the coordinating agent and the implementers, who
see only this text. For each phase, in dependency order:

- what the phase delivers and why it must come after the previous one;
- the groups inside it, where a group is a unit one agent can implement alone;
- for each group: the interpreted tasks, the **exact project-relative paths it
  will write**, and the validation commands that prove it works;
- the whole-phase validation that proves the phase together.

Groups inside one phase must have **disjoint write paths**. Two groups that need
the same file are not parallel: put the shared file in an earlier group or an
earlier phase. `adw execute` refuses overlapping paths before it mutates
anything, so an honest split here saves a failed run later.

A phase with one group is normal and correct for small changes. Do not invent
parallelism.

Use the project's configured validation commands rather than inventing new ones.
Where the plan genuinely needs a new command, say so explicitly and say why.

## 3. Return it

Present the plan in the conversation, then write it to the documentation
branch. Take `docs.branch` and `docs.worktree` from `adw config`; the worktree
is where you write, never a `git checkout` of the base branch. If the worktree
is not attached and the branch exists, attach it with
`git worktree add <docs.worktree> <docs.branch>`. If the branch does not exist,
say so and point at `adw:init` rather than creating it here.

Write one file to `<docs.worktree>/plans/`, named
`<YYYY-MM-DD>-<abbreviation>-<short-description>.md`:

- `<YYYY-MM-DD>` — today's date, so the directory sorts chronologically;
- `<abbreviation>` — a short lowercase tag for the change, the issue or ticket
  identifier when the project has one, otherwise 2–5 letters the team would
  recognize;
- `<short-description>` — two to five lowercase hyphenated words naming what
  the change does.

For example, `2026-08-17-auth-replace-session-cookies.md`. If that path is
already taken, append `-2`; never overwrite an existing plan. Write only that
one file. Ask before committing it, and never push.

Resolve the plan skeleton in this order, and say which one you used:

1. a template path the user named in this invocation, for example
   `adw:plan --template <path>`;
2. `docs.plan_template` from `adw config`, when the project set one — a
   project-relative path on the base branch;
3. `<plugin-root>/templates/plan.md`, the skeleton shipped with the plugin.

If a template named by either of the first two does not exist, say so and stop
rather than silently falling back to the next one — a missing project template
is a configuration mistake worth surfacing.

A skeleton is optional in every case; nothing parses it, so rename, reorder, or
drop its sections whenever the change is better served that way. If the user
names a different output path, write there instead and say that it is outside
the plans directory.

Then state plainly what happens next: they confirm the plan and the phase they
want, and `adw:execute` carries it out. Nothing about the plan is binding until
they say so, and revising it needs no ceremony — edit it and ask again.
