---
name: init-greenfield
description: Turn a genuinely empty directory or unborn Git repository plus a project idea into an initialized ADW project with a reviewed product contract, validation foundation, first main commit, and docs branch. Use when starting a new project before application code exists.
---

# Initialize a New Project

Create the smallest truthful foundation needed for the normal `plan -> approve -> execute` loop. Do not generate speculative application code.

1. Resolve the installed plugin root independently of the project. In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}`. In Codex, start from the absolute loaded source path ending in `/skills/init-greenfield/SKILL.md` and remove that suffix. Use `<plugin-root>/initialization/init.mjs`; never copy plugin implementation into the project.
2. Require either a genuinely empty directory or an unborn Git repository with no files, refs, staged content, or commits. If meaningful project content or history exists, stop and recommend `adw:init-brownfield`.
3. Read `<plugin-root>/execution/contracts.md`, `<plugin-root>/integrations/contracts.md`, and `<plugin-root>/integrations/providers.json`.
4. Explain that the reviewed apply will create Git when absent, establish `main`, create a concise `PROJECT.md`, create a stable `make check` validation entry point, initialize ADW, commit the first main snapshot, and create the docs branch. It will not choose or generate an application framework.
5. Ask in small groups for:
   - project name, problem, intended users, and observable MVP outcome;
   - optional initial application shape, constraints, and non-goals;
   - selected runtime versions only when already decided;
   - execution mode and isolation, with `provider-sandbox` as the lightweight default and `managed-devcontainer` as the stronger reproducible opt-in;
   - optional provider capabilities and concise workflow conventions;
   - optional local non-secret identity hints and collaboration preferences.
6. Never accept credentials. Serialize normalized schema-1 answers to a secure temporary JSON file outside the directory using:

   ```json
   {
     "schema": 1,
     "greenfield": {
       "name": "Project name",
       "problem": "Problem to solve",
       "users": "Intended users",
       "mvp": "Observable first outcome",
       "shape": "Optional application shape",
       "non_goals": [],
       "constraints": []
     },
     "execution": { "isolation": "provider-sandbox", "mode": "orchestrated" },
     "development": { "runtime_versions": {} },
     "providers": {},
     "conventions": {},
     "local": {}
   }
   ```

7. Run `node <plugin-root>/initialization/init.mjs preview --kind greenfield --project-root <project-root> --onboarding <answers>`.
8. Review the exact Git action and first commit intent; `PROJECT.md`; `Makefile`; `adw.yaml`; routing, ignore, permission, and optional container files; docs files; integrations; and next steps. Ensure `adw.yaml` declares root component `app` with sourced validation command `make check`.
9. Present “What will change / What will not happen yet / What you need to do next.” Ask for plain `approve` or `cancel`. Keep the digest internal.
10. After `approve`, run the same command with `apply --confirmed --preview-digest <digest>`. Changed answers, directory contents, templates, or targets require a fresh preview.
11. Remove the temporary answers file. Report the first main commit, docs commit, generated files, selected environment, and next step: use `adw:plan` for the first real milestone and expand `make check` to the stack's actual lint, test, and build checks.

Greenfield initialization may create local Git commits because the exact seed bytes and commit intent are part of its approved preview. It never creates application framework code, installs dependencies, authenticates, contacts integrations, pushes, opens a pull request, merges, releases, or deploys.
