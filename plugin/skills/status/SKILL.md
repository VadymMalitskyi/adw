---
name: status
description: Reconstruct ADW workflow state from Git, worktrees, and configured provider reads without modifying anything. Use when picking up work in a new session, or when reviewing active branches, prepared group worktrees, and open pull requests.
---

# Reconstruct status

Everything here is read-only. Do not fetch, pull, check out, repair, run project
commands, or update anything external.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there.

## 1. Project

Run `adw config`. Report the base branch, the configured isolation, the
components with their validation commands, and any declared providers. If
`adw.yaml` is missing or invalid, report that and stop — point at `adw:init` or
`adw:doctor` rather than guessing.

## 2. Git

Reconstruct from Git itself:

- `git status --porcelain=v1 --untracked-files=all` — uncommitted work here;
- `git branch --list 'adw/*'` — prepared execution branches;
- `git worktree list --porcelain` — attached worktrees and what they hold;
- `git log --oneline <base>..<branch>` per ADW branch — what each has done since
  the base;
- for each attached worktree, its HEAD and whether it is dirty.

For a prepared group, read its marker commit body: it carries the change id,
group id, base branch, base commit, and packet digest. That is the durable
record of what the group was prepared for. A branch whose marker no longer
matches the current plan is a real finding — say so.

There are no run records, approval files, or docs-branch artifacts to read. Do
not look for them and do not reconstruct anything that resembles them.

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
- anything inconsistent — a worktree whose branch is gone, a marker that does not
  match, uncommitted work in a group worktree.

End with the single most useful next action, and name the skill that does it.
