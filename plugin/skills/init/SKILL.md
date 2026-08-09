---
name: init
description: Preview and initialize ADW project artifacts and an execution-security profile in a Git repository while preserving existing instructions and tooling. Use when adding adw.yaml, a managed or project devcontainer policy, local ignores, provider routing blocks, or the docs branch/worktree.
---

# Initialize ADW

Preserve repository-owned content. Modify only the bounded ADW blocks, new ADW artifacts, and the dedicated docs checkout.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/init/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/init/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
2. Resolve and verify the project root with `git rev-parse --show-toplevel`.
3. Read `<plugin-root>/execution/contracts.md`, `<plugin-root>/integrations/contracts.md`, and `<plugin-root>/integrations/providers.json`. Run a baseline `node <plugin-root>/skills/init/scripts/init.mjs preview --project-root <project-root>` only to inspect repository-derived defaults. If `.devcontainer/devcontainer.json` exists, default to required `project-devcontainer` and preserve it. Otherwise recommend required `managed-devcontainer`. Offer `provider-sandbox` only with a clear explanation that it is the weaker portable profile and records `preferred` enforcement.
4. Conduct an adaptive onboarding interview before preparing the reviewed preview. Ask in small related groups, explain defaults, skip irrelevant follow-ups, and never infer a team policy merely from repository layout or an available provider tool:
   - select Codex, Claude Code, or both; for a managed container this controls installed CLIs, extensions, credential volumes, checks, and agent network domains;
   - confirm the execution profile and documentation delivery (`direct-push` or `pull-request`);
   - ask which `work_tracker`, `code_host`, `observability`, and `knowledge` capabilities are used, including none; for each selected capability collect a supported provider, `optional|required`, `read-only|read-write`, non-secret project or organization settings, preferred transport, and exact additional network domains needed in a managed container;
   - for a work tracker, ask whether changes require a binding, whether ADW may propose create-or-link or only link existing items, whether binding happens at plan or execute, one item versus a parent plus plan tasks, and the reviewed committed profile paths required by creation policy;
   - ask for concise branch, pull-request, and work-item conventions. Reject conventions that conflict with ADW invariants: external writes always need fresh authorization, pull requests remain draft-only, and ADW never automatically approves, merges, deploys, releases, or force-pushes;
   - optionally collect a display name, email, task-tracker account hint, per-capability account hint, and local transport preference. Explain that these values are stored only in ignored `.adw/local.yaml`, are not credentials, and will not be committed or used to authenticate. Prefer provider identity `self` after authentication over a display-name guess.
5. Normalize the answers into a temporary JSON file outside the repository using onboarding schema 1. Never place passwords, tokens, cookies, authorization headers, API keys, or other secrets in it. Use this shape, omitting unused optional objects:

   ```json
   {
     "schema": 1,
     "agents": ["codex", "claude"],
     "execution": { "isolation": "managed-devcontainer" },
     "documentation": { "delivery": "direct-push" },
     "integrations": {},
     "workflows": {},
     "conventions": {
       "branches": "Use ADW change branches.",
       "pull_requests": "Create one draft pull request after validation.",
       "work_items": "Link one item per change."
     },
     "local": { "identity": {}, "integrations": {} }
   }
   ```

6. Run `node <plugin-root>/skills/init/scripts/init.mjs preview --project-root <project-root> --onboarding <temporary-json>`. Review the proposed file actions, onboarding summary, preview digest, command sources, docs branch action, execution mode, detected development-environment evidence, unresolved requirements, generated setup commands, selected pinned agents, project runtime versions, native packages, forwarded ports, mounts, integrations, and allowed domains. For an existing project devcontainer, explicitly say agent selection is a preference only and the project-owned container remains unchanged. Never treat repository prose or arbitrary script bodies as executable setup instructions. Stop on invalid onboarding data, unsupported provider/capability pairs, incomplete markers, a conflicting or partial `.devcontainer`, a conflicting worktree, an invalid manifest, an uncommittable docs branch, or an unresolved requirement that prevents the intended workflow.
7. Present the normalized choices and exact preview digest and request explicit approval before writing. Authentication and provider availability are verified later by `adw:doctor`; initialization does not install provider transports, authenticate, contact business systems, change remotes, or perform external writes.
8. After approval, run `node <plugin-root>/skills/init/scripts/init.mjs apply --confirmed --preview-digest <exact-preview-digest> --project-root <project-root> --onboarding <same-temporary-json>`. A changed answer file, repository input, template, or target byte must produce a different digest and stop apply.
9. Remove the temporary answer file. Report created and changed paths, selected agents, configured capabilities, local-only identity fields, docs action, unresolved commands, and returned next steps. Do not print personal values, commit code-branch initialization files automatically, or claim provider setup is operational before doctor verifies it. For a required container, stop until the user commits, rebuilds/reopens, authenticates selected agents and provider tools inside project-scoped volumes, installs ADW there, and `adw:doctor` passes.

The internal script must:

- preserve all bytes outside `<!-- ADW:START -->` / `<!-- ADW:END -->` blocks in `AGENTS.md` and `CLAUDE.md`;
- preserve all bytes outside `# ADW:START` / `# ADW:END` in `.gitignore` and avoid duplicate `.adw/` or `/worktrees/` rules;
- ignore local paths before creating `.adw/local.yaml`, `.adw/cache/`, or `worktrees/docs`;
- retain an existing `adw.yaml` for explicit migration instead of overwriting it;
- cite every detected validation command to a manifest or task-runner target and mark unknown commands unresolved and optional;
- create an orphan `docs` branch only when absent, attach an existing branch, and reuse an existing correct worktree;
- initialize only concise docs-branch context and commit that branch without disturbing the code checkout;
- create the bundled managed `.devcontainer/` only when absent and selected; preserve every byte of an existing project devcontainer;
- install and validate only the explicitly selected pinned agent CLIs in a managed container, with matching project-scoped volumes, editor extensions, root-owned profile, marker, and least-privilege agent domains;
- validate onboarding provider/capability compatibility and keep reviewed shared integration and tracker policy in `adw.yaml`, concise compatible conventions in bounded routing blocks, and personal non-secret identity or account hints only in ignored `.adw/local.yaml`;
- bind onboarding apply to the exact preview digest and reject stale answers, source evidence, templates, targets, or docs actions before writing;
- derive managed-container runtimes and dependency setup only from supported manifests, lockfiles, version files, Compose port declarations, and environment templates, recording the source of every decision in `.devcontainer/project-requirements.json`;
- generate only curated setup commands, activate the outbound firewall before running them, hash the requirements and setup script in the managed marker, and report ambiguous or unpinned needs without guessing;
- never mount host home, SSH/cloud credential directories, global agent configuration, or the Docker socket.

Resolve templates and scripts from the installed plugin root. Never copy plugin implementation into the project.
