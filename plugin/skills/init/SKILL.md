---
name: init
description: Initialize ADW in any repository state — an empty directory, an unborn Git repository, or an established project — by detecting what the repository already proves and asking only what it cannot. Previews the exact files, then writes them after explicit approval. Use when adopting ADW in a project for the first time.
---

# Initialize ADW

One skill covers every repository state. Detect what the repository proves,
ask only what evidence cannot settle, show the exact bytes, then write them
after the user approves.

Read `<plugin-root>/authorization.md` first and follow it throughout. Resolve
the plugin root as described there.

## 1. Understand the repository

Resolve the target directory. `adw init-preview` classifies it for you as one
of:

- `empty-directory` — no `.git` and no files. Apply will run `git init`.
- `unborn-repository` — a Git repository with no commits.
- `established` — at least one commit.

If the target already has `adw.yaml`, stop: this project is initialized. Point
at `adw:update` for managed-file refresh, or a deliberate `adw.yaml` edit.

Read enough of the repository to answer the questions below honestly: the
manifests, lockfiles, `README`, and existing `.devcontainer/`. Do not write
anything yet and do not run project commands.

## 2. Ask only what evidence cannot settle

Ask these, and nothing else. Each has a default you should state.

1. **Isolation** — recommend `managed-devcontainer`: a generated, hardened,
   reproducible container with fail-closed egress. Offer `project-devcontainer`
   when the repository already owns `.devcontainer/devcontainer.json`, and
   `provider-sandbox` as the lightweight option that relies on the agent
   provider's own sandbox. Say plainly that `provider-sandbox` is the weaker
   boundary.
2. **Web access** — managed container only. `public-pages` (default) allows a
   bounded public page-read channel; `hosted-only` restricts egress to exactly
   the allowlisted domains.
3. **Runtime versions** — only for runtimes the preview reports as unresolved.
   Never invent a version the repository already pins.
4. **Providers** — optional work tracker, code host, observability, and
   knowledge integrations, with the exact hostnames each needs so the managed
   container can reach them. Never ask for or accept a credential.
5. **Conventions** — optional single-line notes about branch naming, pull
   requests, or work items. They shape formatting; they never authorize
   anything.

Do not ask about execution mode, plan templates, documentation branches, or
personal preferences. None of those exist.

## 3. Preview

Run:

```
node <plugin-root>/bin/adw.mjs init-preview --project-root <project-root>
```

with the answers as JSON on stdin:

```json
{
  "isolation": "managed-devcontainer",
  "web_access": "public-pages",
  "base_branch": "main",
  "runtime_versions": { "dotnet": "8" },
  "providers": { "code_host": { "provider": "github", "required": false, "domains": ["api.github.com"] } },
  "conventions": { "branches": "Use adw/<change>/<group>." }
}
```

Every field is optional. Omit `base_branch` to use the detected default branch,
and omit `components` to use the detected components and their manifest-backed
validation commands.

Present to the user:

- the repository state and whether apply will run `git init`;
- the chosen isolation and what it means for them;
- every path under `writes`, grouped as configuration, permission policy,
  managed container, and ignore entries;
- the detected components and how many validation commands each has;
- every entry in `unresolved`, in plain language, with what it will cost them
  later if left unresolved.

Then ask for explicit approval. Do not show or ask about the fingerprint.

## 4. Apply

Only after the user approves, run the identical command with the identical
stdin:

```
node <plugin-root>/bin/adw.mjs init-apply --project-root <project-root> --fingerprint <fingerprint-from-preview>
```

The fingerprint binds apply to exactly the file set the user reviewed. If it is
rejected, the repository changed underneath the preview: re-run the preview and
ask again. Never re-derive or hand-edit it.

If any answer changed during the conversation, re-run the preview and get a
fresh approval. Never apply a preview the user did not see.

## 5. Report and hand off

Initialization writes files; it does not commit them, authenticate anything, or
contact an external service. Say so.

Then give the concrete next steps:

1. Review the generated files and commit them. Ask before committing, and never
   push.
2. For a container isolation, rebuild and reopen the repository in its
   devcontainer. Project runtimes and manifest-backed dependencies install after
   the outbound firewall is active.
3. Run `adw:doctor` when readiness is uncertain.
4. Authenticate Codex, Claude Code, and any configured provider tools when first
   used. Credentials stay in their own credential stores and project-scoped
   volumes — never in `adw.yaml`.
5. Point at `adw:onboard` for anyone else joining the project.

## Guarantees to keep

- Preserve every byte the preview did not list. An existing project-owned
  `.devcontainer/` is never converted or overwritten.
- Never write credentials into `adw.yaml`, and refuse any answer that contains
  one.
- Never generate speculative application code, architecture prose, project
  contracts, plan templates, or documentation branches.
