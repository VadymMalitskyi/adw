# Updating and recovery

## Plugin updates

Provider plugin managers distribute skill, template, and runtime changes. Pin private installations to a semantic-version tag for reproducibility. After updating the marketplace snapshot, reinstall or update the plugin in each provider and start a new session so skill metadata reloads.

Run `adw:doctor` before resuming work. It diagnoses the installed release and offers an exact managed-file repair when one is needed. Roll back through the provider manager to the last known-good tag when needed; a plugin-only rollback needs no repair unless doctor reports drift.

## Refreshing managed files

`adw:doctor` repairs only the files ADW itself generates: the permission policy, the managed `worktrees/` ignore block, and, when selected, the managed devcontainer. It never rewrites application code, project-owned documentation, a project-owned `.devcontainer/`, or `adw.yaml`.

```text
refresh-preview  ->  changed paths shown  ->  you say yes  ->  refresh-apply --fingerprint
```

1. Doctor runs its deterministic checks read-only, reads the installed plugin version, and parses any present `adw.yaml` through the bundled YAML 1.2 parser and the `adw: 1` policy contract check. An absent policy uses defaults; invalid configuration stops repair with no writes.
2. For repairable drift it re-renders the current release's permission files — `.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json` — restores the managed `.gitignore` block, and, when `execution.isolation` is `managed-devcontainer`, re-renders the whole generated `.devcontainer/` using the project's own `development.runtime_versions` and provider `domains`.
3. It shows exactly which paths would change. For `provider-sandbox` and `project-devcontainer` projects with a current policy, the write set is normally empty.
4. After your plain yes, doctor hands its internally retained preview fingerprint to apply, which atomically writes exactly the reviewed files and refuses if anything moved in between. Nobody reads or copies the fingerprint.

This is what fixes marker drift after an ordinary plugin upgrade — a bumped plugin version, a new Codex or Claude Code pin, changed permission rules, a changed egress proxy. If configuration from an older release no longer validates, fix `adw.yaml` deliberately or re-initialize in a clean directory; doctor will not migrate it for you.

After a managed-container refresh, rebuild the image and reopen the container, then rerun `adw:doctor`.

## Regenerating the vendored parser

`plugin/lib/vendor/yaml.mjs` is the only generated file in the plugin. It bundles the pinned `yaml` development dependency so an installed plugin needs no `node_modules`.

```bash
npm run build:vendor    # regenerate it
npm run check:vendor    # verify its exact bytes are reproducible and current
```

Never hand-edit the bundle. Every other file under `plugin/bin/` and `plugin/lib/` is handwritten and edited directly.

## Recovering an interrupted change

Start a new session and run `adw:status`. State is reconstructed from Git alone: the group branches, their commits, the worktrees they are attached to, the diff, and — when a `code_host` is configured — the open pull requests. Chat history is not required and is not trusted.

An interrupted execution recovers from Git evidence across sessions. Resuming a group's branch is a judgment call: Git can show its merge base with the configured base branch, the commits it holds since that base, and whether its worktree is dirty, but an ordinary branch carries no digest or trailer proving it was prepared for the same prior task packet. ADW derives a fresh packet and confirms it before continuing, rather than silently reusing or refusing it. Stage progress lives only in the running session and in the group worktrees; ADW adds no durable execution state.

ADW never removes a branch or worktree for you. Ask for the cleanup commands and run them yourself once the work is merged or deliberately abandoned.

## What was removed

Earlier releases carried a second workflow database beside Git. If you remember any of these, they are gone and have no replacement:

| Removed | What to do instead |
|---|---|
| `SYNC.yaml` and doc-sync markers | The docs branch carries no state file; `adw:generate-docs` builds the documentation set and `adw:sync-docs` audits and reconciles drift against live repository evidence |
| `changes/<id>/plan.md` as a required canonical location | Plans live in the conversation and in `<docs.worktree>/plans/<date>-<abbreviation>-<description>.md` on the documentation branch |
| `approval.json`, approval history, plan digests, plan-approval binding | Confirming in conversation authorizes execution |
| Phase run records and their state machine | Git is the cross-session evidence; the transient deterministic workflow has no durable record |
| The project-owned plan-template registry (`planning:` in `adw.yaml`) | Plans are ordinary Markdown; `plugin/templates/plan.md` is optional guidance |
| `.adw/local.yaml`, `.adw/preferences.md`, `.adw/cache/` | Use optional Markdown profiles: global `~/.config/adw/profile.md` and Git-ignored `.adw/user.md`; ADW maintains no machine-readable local state |
| Generated `PROJECT.md` and ADW routing blocks in `AGENTS.md` / `CLAUDE.md` | Skills carry their own instructions |
| `execution.mode` (`orchestrated` / `sequential`) | The plan decides how much runs at once |
| `plugin/lib/adw-helper.mjs` and the first-party runtime bundle | `plugin/bin/adw.mjs` plus `plugin/lib/*.mjs`, shipped as source |
| `npm run build:helper` / `check:helper` | `npm run build:vendor` / `check:vendor` |
| `adw:approve`, `adw:amend` | Confirm in conversation; to change the design, edit the plan and confirm again |
| `adw:discover` | Folded into `adw:init`, `adw:plan`, and `adw:doctor` |
| The old `adw:sync-docs` branch-maintenance workflow | Use the new `adw:sync-docs` skill, which audits the documentation branch against live repository changes |
| `adw:init-greenfield`, `adw:init-brownfield` | One `adw:init` that detects the repository state |
| `conventions:` in `adw.yaml` | Keep every convention, including branch naming, in repository-owned instruction and contributor documentation |
| `adw:update` | Invoke `adw:doctor`; it diagnoses first and offers the same preview-bound managed-file repair when needed |
| `git.branch_template` in `adw.yaml` | Branch and worktree names are ordinary execution-time choices proposed and confirmed during `adw:execute`, not project configuration |
