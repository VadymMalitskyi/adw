---
name: init
description: Initialize ADW in any repository state — an empty directory, an unborn Git repository, or an established project — through a guided setup interview that recommends evidence-based choices, previews exact files, then writes them after explicit approval. Use when adopting ADW in a project for the first time.
---

# Initialize ADW

One skill covers every repository state. Detect what the repository proves,
present it as a recommendation, ask the user to confirm or change each setup
area, show the exact bytes, then write them after approval.

Read `<plugin-root>/authorization.md` first and follow it throughout. Resolve
the plugin root as described there.

## 1. Understand the repository

Resolve the target directory. `adw init-preview` classifies it as one of:

- `empty-directory` — no `.git` and no files. Apply will run `git init`.
- `unborn-repository` — a Git repository with no commits.
- `established` — at least one commit.

If the target already has `adw.yaml`, stop: it has an explicit shared policy.
Point at `adw:doctor` for diagnosis and managed-file repair, or a deliberate
policy edit. A project without that file can still be initialized; generated
permission files and the managed-container marker establish the local setup.

Read enough of the repository to answer the questions below honestly: the
manifests, lockfiles, `README`, and existing `.devcontainer/`. Do not write
anything yet and do not run project commands.

## 2. Run a guided setup interview

Ask every topic below, even when repository evidence supplies a recommendation.
Keep the interview compact: state the detected value, the recommended default,
and the effect of changing it. Let the user accept the recommendation, choose
another supported value, or record no override. Ask in short rounds and wait
for the user's answer before moving on; do not dump the whole questionnaire
into one message.

1. **Base branch** — state the detected branch and ask whether ADW should use
   it. An explicit answer records `git.base_branch`; otherwise it stays Git
   discovery.
2. **Documentation branch** — ADW keeps documentation and plans on their own
   orphan branch, checked out as a worktree, so generated prose never travels
   through code review on the base branch. The defaults are branch `docs` at
   `worktrees/docs`. Ask whether those names suit the project; an explicit
   answer records `docs.branch` and `docs.worktree`. The worktree path must
   stay under `worktrees/`, which ADW keeps ignored on the base branch.
3. **Isolation** — Recommend `managed-devcontainer`: it provides a generated,
   hardened, reproducible container with fail-closed egress. When the
   repository already owns `.devcontainer/devcontainer.json`, recommend
   `project-devcontainer` instead so ADW preserves it. Offer
   `provider-sandbox` only when the user explicitly wants the lightweight,
   weaker boundary.
4. **Web access** — managed container only. `public-pages` (default) allows a
   bounded public page-read channel; `hosted-only` restricts egress to exactly
   the allowlisted domains.
5. **Runtime versions** — review every detected runtime. Keep repository-pinned
   versions as evidence; ask whether each unresolved runtime needs a shared
   numeric version. Never invent a version the repository already pins.
6. **Components and validation** — review each detected component and its
   validation commands. Ask whether discovery is sufficient or whether the
   project needs an explicit component or validation override.
7. **Providers** — ask separately about optional work tracker, code host,
   observability, and knowledge integrations, with the exact hostnames each
   needs so the managed container can reach them. Never ask for or accept a
   credential.
8. **Workflow conventions** — ask about commit-message, pull-request, review,
   branch-naming, and issue-linking conventions. Explain that ADW treats
   branch and worktree names as ordinary execution-time choices, not
   configuration; keep every convention in existing repository-owned
   instructions or contributor documentation. Do not create or rewrite those
   files during init.
9. **Code style** — ask whether the project wants a starting set of code-style
   rules. Carry the answer, and anything the user said in topic 8, to the
   post-apply offer in step 6; nothing about style is written during apply.
   Skip the question entirely when the repository already answers it: an
   existing style guide, populated instruction files, or a configured
   formatter, linter, or type checker. A rule a configured tool already
   enforces must never be offered.

Do not ask about execution mode or plan templates.
Repository instruction files own conventions that do not have an ADW setting.
Personal preferences belong in `~/.config/adw/profile.md` or the Git-ignored
`.adw/user.md`, never in the shared project policy.

If the user asks to persist a convention for which ADW has no setting, stop
after the preview and propose a separate, deliberate documentation change.
Do not silently add unsupported fields to `adw.yaml`.

`<plugin-root>/templates/adw.yaml` documents every field the generated
configuration may contain, if you need to explain one.

## 3. Preview

Run:

```
node <plugin-root>/bin/adw.mjs init-preview --project-root <project-root>
```

with the answers as JSON on stdin:

```json
{
  "base_branch": "main",
  "docs": { "branch": "docs", "worktree": "worktrees/docs" },
  "isolation": "managed-devcontainer",
  "web_access": "public-pages",
  "runtime_versions": { "dotnet": "8" },
  "providers": { "code_host": { "provider": "github", "required": false, "domains": ["api.github.com"] } }
}
```

Every field is optional. Omit `base_branch` to use the detected/default Git
base branch, omit `docs` to use the default documentation branch and worktree,
and omit `components` to use detected components as planning
evidence. Init writes `adw.yaml` only when the approved answers introduce a
shared policy or override; it does not persist discovery as configuration.

Present to the user:

- the repository state and whether apply will run `git init`;
- each recommended choice, the user's selection, and any choice that remains
  repository discovery rather than shared policy;
- the chosen isolation and what it means for them;
- the `docs` block: the branch name, whether apply creates it or finds it
  already there, the worktree path, and whether apply attaches it. Say plainly
  that the branch is created as an orphan with one commit and that the
  worktree is ignored on the base branch, so neither shows up in their next
  commit;
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

Initialization writes files, creates the `worktrees/` directory, and creates
and attaches the documentation branch. It commits nothing on the base branch,
authenticates nothing, and contacts no external service. Say so, and name the
documentation branch and worktree it created.

Then give the next steps:

1. Review the generated files and commit them. Ask before committing, and never
   push.
2. For a container isolation, rebuild and reopen the repository in its
   devcontainer. Project runtimes and manifest-backed dependencies install after
   the outbound firewall is active.
3. Run `adw:doctor` when readiness is uncertain.
4. Authenticate Codex, Claude Code, and any configured provider tools when first
   used. Credentials stay in their own credential stores and project-scoped
   volumes — never in `adw.yaml`.
5. Run `adw:generate-docs` to fill the documentation branch, and `adw:plan` to
   write the first plan into its `plans/` directory.
6. Point at `adw:onboard` for anyone else joining the project.

## 6. Offer the code-style rules

Only when step 2 topic 9 established that the project wants them. This is a
separate, deliberate change: it is not in the preview, not in the fingerprint,
and not repaired by `adw:doctor`, because repository-owned instruction files
belong to the project and are expected to change.

Read `<plugin-root>/templates/code-style.md`. Present its rules as a menu the
user picks from, one line each, grouped as the catalog groups them. Recommend
the rules the repository has no tool for, and say which ones you left out
because a configured formatter, linter, or type checker already enforces them.

Then show the exact lines and the exact instruction file they would be appended
to, and ask for approval. On approval, append them and stop. Never rewrite or
reorder what the file already says, never create the file when the user did not
approve one, and never commit. If the user declines, say where the catalog
lives so they can take it later.

## Guarantees to keep

- Preserve every byte the preview did not list. An existing project-owned
  `.devcontainer/` is never converted or overwritten.
- Never write credentials into `adw.yaml`, and refuse any answer that contains
  one.
- Never generate speculative application code, architecture prose, project
  contracts, or plan templates. Code-style rules are not an exception: they are
  offered from the catalog after apply, chosen by the user, and never invented. The documentation branch is created empty apart
  from a README describing what it holds; filling it is `adw:generate-docs`.
- Never reuse an existing directory at the docs worktree path. If something is
  already there and is not an attached worktree, apply refuses.
