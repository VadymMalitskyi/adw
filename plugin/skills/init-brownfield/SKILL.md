---
name: init-brownfield
description: Preview and initialize ADW in an established Git repository while preserving existing code, instructions, tooling, and project-owned containers. Use when adopting ADW in a repository that already has at least one commit.
---

# Initialize an Existing Project

Adopt ADW without redesigning or scaffolding the project. Write only after an exact preview receives explicit approval.

1. Resolve the installed plugin root independently of the project. In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}`. In Codex, start from the absolute loaded source path ending in `/skills/init-brownfield/SKILL.md` and remove that suffix. Use `<plugin-root>/initialization/init.mjs`; never resolve initialization resources from the target project.
2. Require the requested directory to be the Git top level with at least one commit. If it has no commit, stop and recommend `adw:init-greenfield`.
3. Read `<plugin-root>/execution/contracts.md`, `<plugin-root>/integrations/contracts.md`, and `<plugin-root>/integrations/providers.json`.
4. Run a baseline preview with `node <plugin-root>/initialization/init.mjs preview --kind brownfield --project-root <project-root>`. Inspect manifests, lockfiles, component roots, source entry points, configuration, tests, CI, containers, and authoritative documentation before asking questions.
5. Ask only about choices repository evidence cannot settle:
   - execution mode and isolation; preserve `.devcontainer/devcontainer.json` with `project-devcontainer` when it exists. Otherwise default to `provider-sandbox`. Offer `managed-devcontainer` only as an explicit stronger opt-in;
   - unpinned detected runtime versions required by a managed container;
   - optional provider capabilities, non-secret settings, access, transport preference, and exact network domains;
   - concise branch, pull-request, and work-item conventions;
   - optional local non-secret identity hints and collaboration preferences.
6. Never accept credentials. Serialize normalized schema-1 answers to a secure temporary JSON file outside the repository using:

   ```json
   {
     "schema": 1,
     "execution": { "mode": "orchestrated" },
     "development": { "runtime_versions": {} },
     "providers": {},
     "conventions": {},
     "local": {}
   }
   ```

   Do not include a `greenfield` object. Add `execution.isolation` only for an explicit choice that repository evidence did not settle, and `web_access` only when a managed container requires an explicit `public-pages` or `hosted-only` policy. Each configured `providers.<capability>` entry carries `provider` plus optional `required`, `transport`, `access`, `settings`, and `network_domains`.
7. Run `node <plugin-root>/initialization/init.mjs preview --kind brownfield --project-root <project-root> --onboarding <answers>`. Review every proposed `adw.yaml`, committed `adw/plan-templates/standard.md`, ignored `.adw/`, root `/worktrees/`, routing, permission, component and validation, docs, isolation, and managed-container action. Preserve every byte outside bounded ADW blocks and preserve an existing project devcontainer byte-for-byte.
8. Present “What will change / What will not happen yet / What you need to do next.” Ask for plain `approve` or `cancel`. Keep the preview digest internal.
9. After `approve`, run the same command with `apply --confirmed --preview-digest <digest>`. Any repository, answer, or target change invalidates approval and requires a new preview.
10. Remove the temporary answers file. Report changed paths and next steps. Initialization does not commit main-branch files, authenticate, contact integrations, push, merge, release, or deploy. Ask the maintainer to review and commit the generated files, publish the docs branch separately when collaborators need it, and reopen the selected container when required.

The shared engine must reject dirty or conflicting initialization state, unsafe symlinks, incomplete managed blocks, invalid manifests, stale previews, conflicting docs worktrees, and setup-blocking managed-container requirements. It may create and commit the dedicated docs branch, but never commit the established code branch.
