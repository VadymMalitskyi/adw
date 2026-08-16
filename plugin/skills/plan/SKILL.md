---
name: plan
description: Produce a repository-grounded implementation plan for a software change, structured into dependency-ordered phases with parallel-safe groups, returned in the conversation and written to a file only when the user asks for one. Use when a user wants to plan a change, define scope and acceptance criteria, or prepare implementation-ready work without modifying code.
---

# Plan a change

Return one self-contained plan in the conversation. Write a file only when the
user asks for a path. There is no canonical location, no plan digest, and no
approval artifact — the user confirming in conversation is what authorizes
execution later.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there. Run `adw config` to learn the base branch, components, validation
commands, and providers. Read repository-owned instruction files for project
conventions; `adw.yaml` does not duplicate them.

## 1. Ground the plan in the repository

Read before writing. Find the code the change actually touches: entry points,
the modules that own the behavior, the tests that cover it, and the validation
commands the project already runs. Prefer reading the code over trusting any
document that describes it.

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

## 3. Review it

Run a cold review pass before showing the plan: spawn a fresh subagent with only
the plan text and access to the repository, and ask it for the weakest point and
ranked findings. It must not see this conversation — that blindness is the
point, because implementers will be equally blind.

Apply the findings you agree with. Report the ones you rejected and why.

## 4. Return it

Present the plan in the conversation. If the user asks for a file, write it to
the path they name and nothing else — ask before committing it, and never push.
`<plugin-root>/templates/plan.md` is an optional skeleton you may start from;
nothing parses it, so rename, reorder, or drop its sections whenever the change
is better served that way.

Then state plainly what happens next: they confirm the plan and the phase they
want, and `adw:execute` carries it out. Nothing about the plan is binding until
they say so, and revising it needs no ceremony — edit it and ask again.
