---
name: init
description: Preview and initialize ADW project artifacts, the small adw.yaml contract, provider routing blocks, ignored local state, the docs branch and worktree, and an optional hardened development container. Use when adding ADW to a Git repository for the first time.
---

# Initialize ADW

Preserve repository-owned content. Modify only the bounded ADW blocks, new ADW artifacts, and the dedicated docs checkout.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/init/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/init/SKILL.md` from that locator. Never derive plugin resources from the current working directory or the target project.
2. Resolve and verify the project root with `git rev-parse --show-toplevel`.
3. Read `<plugin-root>/execution/contracts.md`, `<plugin-root>/integrations/contracts.md`, and `<plugin-root>/integrations/providers.json`. Run a baseline `node <plugin-root>/skills/init/scripts/init.mjs preview --project-root <project-root>` only to inspect repository-derived defaults. Before asking anything, inspect the repository: supported manifests and lockfiles, component roots, entry points, configuration, tests, CI, and existing authoritative documentation. Build one evidence-backed project model.
4. Conduct a short onboarding interview. Start with this plain-language orientation, then ask in small related groups, explain defaults, skip irrelevant follow-ups, and never infer a team policy from repository layout or an available provider tool:

   > ADW is a project workflow helper for planning, reviewing, and safely carrying out software changes with Codex and Claude Code. This setup does not change your project yet: first it creates a preview of every proposed file and waits for your approval. I'll ask only about choices ADW cannot safely guess — how work should run, which optional services your team uses, and your team's conventions. You do not need to know Docker, agents, or integrations in advance; use the default or say "I'm not sure." Never provide passwords, API keys, or tokens.

   - **Execution mode.** `orchestrated` runs dependency-ordered work with concurrent groups inside a phase, each in its own branch and worktree. `sequential` runs one branch at a time. Recommend `orchestrated`, and ask for `max_parallel` between 1 and 16 (default 3).
   - **Isolation.** Explain the three choices plainly. A provider sandbox is the lightweight portable default with fewer guarantees. An existing project devcontainer is left completely unchanged. A managed devcontainer is an isolated, repeatable workspace ADW configures and hardens. Default to `provider-sandbox` for a repository with no `.devcontainer/`; select `project-devcontainer` automatically when `.devcontainer/devcontainer.json` already exists and say explicitly that the project-owned container stays unchanged and must provide the required agent tools itself. Offer `managed-devcontainer` only as an explicit opt-in for teams wanting the stronger reproducible boundary; never present it as required to adopt ADW.
   - **Managed container follow-ups, only after that opt-in.** Explain that managed containers always install Codex and Claude Code with both sets of extensions, credential volumes, checks, and agent network domains. Explain web access before asking: `public-pages` lets Claude open public web pages for research; `hosted-only` is the stricter option limiting container egress to specifically approved domains. When a detected language has no pinned runtime version, name the language, explain that the container needs a version, offer the current supported major-version default, and record the answer in `development.runtime_versions`. Do not invent a version without repository evidence or the person's answer.
   - **Optional services.** Ask which capabilities the team actually uses — `work_tracker`, `code_host`, `observability`, `knowledge` — and why: this lets ADW check availability and propose the right safe actions. "None" is a valid answer and keeps the lightweight path. For each selected capability collect only the provider, whether it is required, non-secret settings, preferred transport, and any exact additional network domains. Do not ask about work-item field policy, payload profiles, or tracker cardinality; the plan states its tracker intent per change.
   - **Components and validation.** Explain the detected component boundaries and the validation command discovered for each, with the manifest, task runner, or CI file that proves it. Ask only about a component whose required check could not be derived from an observable source; never invent one.
   - **Conventions.** Ask for concise branch and pull-request conventions. Reject conventions that conflict with ADW invariants: external writes always need fresh authorization, pull requests remain draft-only, and ADW never approves, merges, deploys, releases, or force-pushes.
   - **Personal state.** Explain that initialization also creates ignored `.adw/preferences.md`, a short free-form personal collaboration profile for accessibility needs, preferred answer length, decision-making style, and progress-update preferences. It is never committed, shared team policy, authorization, or a place for secrets. Optionally collect a display name, email, and per-capability account hint or local transport preference, stored only in ignored `.adw/local.yaml`. These are not credentials and will not be used to authenticate.

5. Normalize the answers into a temporary JSON file outside the repository using onboarding schema 1. Never place passwords, tokens, cookies, authorization headers, API keys, or other secrets in it. Use this shape, omitting unused optional objects:

   ```json
   {
     "schema": 1,
     "execution": { "isolation": "provider-sandbox", "mode": "orchestrated", "max_parallel": 3 },
     "web_access": "public-pages",
     "providers": {},
     "conventions": {
       "branches": "Use ADW change branches.",
       "pull_requests": "Keep group pull requests small and draft until reviewed."
     },
     "local": { "identity": {}, "providers": {} }
   }
   ```

6. Run `node <plugin-root>/skills/init/scripts/init.mjs preview --project-root <project-root> --onboarding <temporary-json>`. Review the proposed file actions, onboarding summary, generated docs files and component map, command sources, docs branch action, isolation mode, and — for a managed container only — the detected development-environment evidence, unresolved requirements, generated setup commands, pinned agents, runtime versions, dependencies, native packages, forwarded ports, mounts, and allowed domains. Confirm every required project dependency is either installed by a curated setup command or explicitly resolved with the person. Never treat repository prose or arbitrary script bodies as executable setup instructions. Stop on invalid onboarding data, unsupported provider/capability pairs, incomplete markers, a conflicting or partial `.devcontainer`, a conflicting worktree, an invalid manifest, an uncommittable docs branch, or an unresolved requirement that prevents normal development.
7. Present the normalized choices in a short "What will change / What will not happen yet / What you need to do next" summary, then ask the person to reply simply `approve` or `cancel`. Do not show, name, or ask the person to copy a digest. Keep the preview digest internally: it is a stale-preview check for the tool, not an approval ceremony. Say explicitly that the preview is safe to inspect and no files change until approval. Initialization does not install provider transports, authenticate, contact business systems, change remotes, or perform external writes; `adw:doctor` verifies availability later.
8. After a plain `approve`, run `node <plugin-root>/skills/init/scripts/init.mjs apply --confirmed --preview-digest <internally-retained-preview-digest> --project-root <project-root> --onboarding <same-temporary-json>`. A changed answer file, repository input, template, or target byte must produce a different digest and stop apply; show a fresh concise preview and ask for `approve` again.
9. Remove the temporary answer file. Report created and changed paths, generated architecture and component docs, configured capabilities, local-only identity fields, docs action, and returned next steps. End with a calm checklist: review and commit the generated files; publish the docs branch through the project's approved delivery path so other contributors can attach it; and — for a container mode only — rebuild or reopen the repository and authenticate Codex, Claude Code, and any chosen providers when first used. Do not require another ADW configuration command from the initializing person: `adw:onboard` is optional as a readiness diagnostic for them and remains the contributor-local setup path for later clones. Do not print personal values, commit code-branch initialization files automatically, or claim authentication is operational before it is verified.

The internal script must:

- render the small `adw: 1` contract: `git.base_branch`, `docs.branch`/`worktree`/`sync_marker`, `execution.mode`/`max_parallel`/`isolation`, discovered `components` with their `validate` commands, optional `providers`, and optional `conventions`;
- preserve all bytes outside `<!-- ADW:START -->` / `<!-- ADW:END -->` blocks in `AGENTS.md` and `CLAUDE.md`;
- preserve all bytes outside `# ADW:START` / `# ADW:END` in `.gitignore` and avoid duplicate `.adw/` or `/worktrees/` rules;
- ignore local paths before creating `.adw/local.yaml`, `.adw/preferences.md`, `.adw/cache/`, or the docs worktree;
- retain an existing `adw.yaml` for separately reviewed manual replacement instead of overwriting it;
- cite every detected validation command to a manifest or task-runner target and mark unknown commands unresolved and optional;
- create an orphan docs branch only when absent, attach an existing branch, and reuse an existing correct worktree;
- generate evidence-backed `architecture.md`, `components/`, and an empty `changes/` on the docs branch, and create no specification, plan, or schema templates;
- create the bundled managed `.devcontainer/` only when absent and explicitly selected; preserve every byte of an existing project devcontainer;
- install and validate the pinned Codex and Claude Code CLIs in a managed container, with matching project-scoped volumes, editor extensions, root-owned profile, marker, and least-privilege agent domains;
- keep reviewed shared provider configuration in `adw.yaml`, concise compatible conventions in the bounded routing blocks, and personal non-secret identity or account hints only in ignored `.adw/local.yaml`; create the ignored free-form `.adw/preferences.md` profile without reading it into committed artifacts;
- bind apply to the exact preview digest and reject stale answers, source evidence, templates, targets, or docs actions before writing;
- derive managed-container runtimes, dependencies, native packages, and setup only from supported manifests, lockfiles, version files, port declarations, environment templates, and explicit onboarding runtime choices, recording the source of every decision;
- generate only curated setup commands, activate the outbound firewall before running them, hash the requirements and setup script in the managed marker, and raise any unresolved blocking requirement as a pre-approval question;
- never mount host home, SSH or cloud credential directories, global agent configuration, or the Docker socket;
- reject absolute paths, `..`, NULs, symlink escapes, and targets outside the project root, and apply every write atomically with rollback.

Resolve templates and scripts from the installed plugin root. Never copy plugin implementation into the project.
