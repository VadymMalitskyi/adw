# Updating and recovery

## Plugin updates

Provider plugin managers distribute skill, template, and runtime changes. Pin private installations to a semantic-version tag for reproducibility. After updating the marketplace snapshot, reinstall or update the plugin in each provider and start a new session so skill metadata reloads.

Run `adw:doctor` before resuming work. Roll back through the provider manager to the last known-good tag when needed; a plugin-only rollback does not need `adw:update`.

## Refreshing managed files

`adw:update` repairs only the files ADW itself generates. It never rewrites application code, project-owned documentation, a project-owned `.devcontainer/`, or `adw.yaml`.

```text
refresh-preview  ->  changed paths shown  ->  you say yes  ->  refresh-apply --fingerprint
```

1. It reads the installed plugin version and parses `adw.yaml` through the bundled YAML 1.2 parser and the `adw: 1` contract check, without rewriting the file. Invalid configuration stops the update with no writes; ADW never reinterprets or repairs configuration on your behalf.
2. It re-renders the current release's permission files — `.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json` — and, when `execution.isolation` is `managed-devcontainer`, the whole generated `.devcontainer/`, using the project's own `development.runtime_versions` and provider `domains`.
3. It shows exactly which paths would change. For `provider-sandbox` and `project-devcontainer` projects with a current policy, the write set is normally empty.
4. After your plain yes, the skill hands its internally retained preview fingerprint to apply, which atomically writes exactly the reviewed files and refuses if anything moved in between. Nobody reads or copies the fingerprint.

This is what fixes marker drift after an ordinary plugin upgrade — a bumped plugin version, a new Codex or Claude Code pin, changed permission rules, a changed egress proxy. If configuration from an older release no longer validates, fix `adw.yaml` deliberately or re-initialize in a clean directory; `adw:update` will not migrate it for you.

After a managed-container refresh, rebuild the image and reopen the container, then rerun `adw:doctor`.

## Regenerating the vendored parser

`plugin/lib/vendor/yaml.mjs` is the only generated file in the plugin. It bundles the pinned `yaml` development dependency so an installed plugin needs no `node_modules`.

```bash
npm run build:vendor    # regenerate it
npm run check:vendor    # verify its exact bytes are reproducible and current
```

Never hand-edit the bundle. Every other file under `plugin/bin/` and `plugin/lib/` is handwritten and edited directly.

## Recovering an interrupted change

Start a new session and run `adw:status`. State is reconstructed from Git alone: the group branches, the marker commit on each one, the worktrees under `worktrees/`, the diff, and — when a `code_host` is configured — the open pull requests. Chat history is not required and is not trusted.

An interrupted execution resumes on the same evidence. A group branch is reused only when its marker commit still records the same change id, group id, base branch, base commit, and interpreted task packet, and still sits directly on that base commit. Anything else is reported as a blocker rather than silently reused.

ADW never removes a branch or worktree for you. Ask for the cleanup commands and run them yourself once the work is merged or deliberately abandoned.

## What was removed

Earlier releases carried a second workflow database beside Git. If you remember any of these, they are gone and have no replacement:

| Removed | What to do instead |
|---|---|
| The docs branch, its worktree, `SYNC.yaml`, and doc-sync markers | Keep architecture and component documentation on the normal code branch; update it through ordinary edits and review |
| `changes/<id>/plan.md` as a required canonical location | Plans live in the conversation, or in a file at a path you choose |
| `approval.json`, approval history, plan digests, plan-approval binding | Confirming in conversation authorizes execution |
| Phase run records and their state machine | Git, the pull request, and the tracker item are the record |
| The project-owned plan-template registry (`planning:` in `adw.yaml`) | Plans are ordinary Markdown; `plugin/templates/plan.md` is optional guidance |
| `.adw/local.yaml`, `.adw/preferences.md`, `.adw/cache/` | Nothing machine-local is maintained |
| Generated `PROJECT.md` and ADW routing blocks in `AGENTS.md` / `CLAUDE.md` | Skills carry their own instructions |
| `execution.mode` (`orchestrated` / `sequential`) | The plan decides how much runs at once |
| `plugin/lib/adw-helper.mjs` and the first-party runtime bundle | `plugin/bin/adw.mjs` plus `plugin/lib/*.mjs`, shipped as source |
| `npm run build:helper` / `check:helper` | `npm run build:vendor` / `check:vendor` |
| `adw:approve`, `adw:amend` | Confirm in conversation; to change the design, edit the plan and confirm again |
| `adw:discover` | Folded into `adw:init`, `adw:plan`, and `adw:doctor` |
| `adw:sync-docs` | Removed with the docs branch |
| `adw:init-greenfield`, `adw:init-brownfield` | One `adw:init` that detects the repository state |
