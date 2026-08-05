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
3. Read `<plugin-root>/execution/contracts.md`. If `.devcontainer/devcontainer.json` exists, default to required `project-devcontainer` and preserve it. Otherwise default to required `managed-devcontainer`. Use `--execution provider-sandbox` only after the user explicitly chooses the weaker portable profile; record it as `preferred`, requiring fresh confirmation in mutating workflows.
4. Run `node <plugin-root>/skills/init/scripts/init.mjs preview --project-root <project-root> [--execution <mode>]`.
5. Review the proposed file actions, command sources, docs branch action, execution mode, container files, pinned agent versions, mounts, and allowed domains. Stop on incomplete markers, a conflicting or partial `.devcontainer`, a conflicting worktree, an invalid manifest, or an uncommittable docs branch.
6. Present the preview and request explicit approval before writing.
7. After approval, run `node <plugin-root>/skills/init/scripts/init.mjs apply --confirmed --project-root <project-root> [--execution <mode>]`.
8. Report created and changed paths, docs action, unresolved commands, and the returned next steps. Do not commit code-branch initialization files automatically. For a required container, stop until the user commits, rebuilds/reopens, authenticates and installs ADW inside it, and `adw:doctor` passes there.

The internal script must:

- preserve all bytes outside `<!-- ADW:START -->` / `<!-- ADW:END -->` blocks in `AGENTS.md` and `CLAUDE.md`;
- preserve all bytes outside `# ADW:START` / `# ADW:END` in `.gitignore` and avoid duplicate `.adw/` or `/worktrees/` rules;
- ignore local paths before creating `.adw/local.yaml`, `.adw/cache/`, or `worktrees/docs`;
- retain an existing `adw.yaml` for explicit migration instead of overwriting it;
- cite every detected validation command to a manifest or task-runner target and mark unknown commands unresolved and optional;
- create an orphan `docs` branch only when absent, attach an existing branch, and reuse an existing correct worktree;
- initialize only concise docs-branch context and commit that branch without disturbing the code checkout;
- create the bundled managed `.devcontainer/` only when absent and selected; preserve every byte of an existing project devcontainer;
- never mount host home, SSH/cloud credential directories, global agent configuration, or the Docker socket.

Resolve templates and scripts from the installed plugin root. Never copy plugin implementation into the project.
