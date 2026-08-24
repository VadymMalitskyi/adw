---
name: status
description: Reconstruct ADW workflow state from Git, worktrees, and configured provider reads without modifying anything. Use when picking up work in a new session, or when reviewing active branches, prepared group worktrees, and open pull requests.
disable-model-invocation: true
---

# Reconstruct status

Everything here is read-only. Do not fetch, pull, check out, repair, run project
commands, or update anything external.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there.

## 1. Project

Run `adw config`. Require the committed `adw.yaml` activation marker, then
report the base branch, configured isolation, component overrides with
validation commands, and declared providers. A missing or invalid file is a
blocker; point a missing file at `adw:init`.

## 2. Git

Reconstruct from Git itself:

- `git status --porcelain=v1 --untracked-files=all` — uncommitted work here;
- `git branch --list` — local branches, relative to the configured
  `git.base_branch`; nothing filters this to an `adw/*` naming convention,
  because branch names are an ordinary execution-time choice, not a contract;
- `git worktree list --porcelain` — attached worktrees and what they hold;
- `git log --oneline <base>..<branch>` per branch of interest — what it has
  done since the base;
- for each attached worktree, its HEAD and whether it is dirty.

Report only what Git can actually establish: a branch's commits, its merge
base with the configured base branch, and its worktree attachment. There is no
marker commit, packet digest, or other record that proves a branch was
prepared for a specific prior plan or task packet — an arbitrary branch cannot
be reliably tied back to historical intent without keeping that record, so do
not claim otherwise. If the user needs to know what a branch was for, read its
commits and diff, and say what the evidence does and does not show.

The documentation branch from `adw config` is part of the picture: report
whether it is attached at its configured worktree, what its recent commits
changed, and the most recent files in its `plans/` directory. Those plans are
a record of intent, never authorization — say what a plan proposes, never that
it approves anything.

There are no run records or approval files to read. Do not look for them and do
not reconstruct anything that resembles them.

## 3. Providers

For each declared provider, follow `<plugin-root>/integrations/contracts.md` and
use read-only operations only: open pull requests for the ADW branches, linked
work items, recent alerts. Skip any provider that is not authenticated and say
so; never authenticate, refresh a token, or mutate anything.

## 4. Report

Give a short picture a person can act on:

- what is in flight, by branch, with its last commit and whether it is clean;
- what is prepared but not started;
- what has open external state (pull requests, work items);
- anything inconsistent — a worktree whose branch is gone, or uncommitted work
  sitting in an attached worktree.

End with the single most useful next action, and name the skill that does it.
