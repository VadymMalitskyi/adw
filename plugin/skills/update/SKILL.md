---
name: update
description: Preview and refresh only ADW-managed permission and devcontainer files after a plugin update. Use after a plugin update, or when adw:doctor reports managed-file or permission drift.
---

# Refresh managed files

Provider plugin managers update ADW itself. This workflow regenerates only the
files ADW owns, through an exact preview and apply pair. It never rewrites
`adw.yaml`, application code, or a project-owned container.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there.

## 1. Preview

```
node <plugin-root>/bin/adw.mjs refresh-preview --project-root <project-root>
```

This reads the validated `adw.yaml`, re-renders the Codex and Claude permission
policy, and — when isolation is `managed-devcontainer` — re-renders the managed
container from the installed release plus the project's own configured runtime
versions and provider domains.

If `refresh_required` is `false`, everything is current. Say so and stop.

Otherwise show the user every path under `writes` with its action, and what each
group of files does:

- `.codex/config.toml`, `.codex/rules/adw.rules`, `.claude/settings.json` — the
  shared permission policy both agents run under;
- `.devcontainer/*` — the managed container, its egress allowlist, and the
  digests that let `adw:doctor` detect drift.

Ask once for approval to write exactly those files. Do not show or ask about the
fingerprint.

## 2. Apply

```
node <plugin-root>/bin/adw.mjs refresh-apply --project-root <project-root> --fingerprint <fingerprint-from-preview>
```

The fingerprint binds apply to the exact file set the user reviewed. If it is
rejected, something changed underneath the preview: re-run the preview and ask
again.

## 3. Report

Say what changed and what it means for them:

- permission policy changes take effect in the next agent session;
- managed container changes need a container rebuild and reopen before they are
  in force;
- the written files are uncommitted. Ask before committing, and never push.

Run `adw doctor` afterwards to confirm the project is consistent again.

## Boundaries

- `adw.yaml` is never rewritten here. If the project needs a different isolation,
  web-access mode, runtime version, or provider domain, that is a deliberate
  `adw.yaml` edit the user approves separately — then re-run this refresh.
- A project-owned `.devcontainer/` is never touched.
- Nothing outside the managed file list is written, even if it looks stale.
