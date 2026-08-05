---
name: init
description: Preview and initialize ADW project artifacts in a Git repository while preserving existing instructions and tooling. Use when adding adw.yaml, local ignores, provider routing blocks, or the docs branch/worktree to a new or existing project.
---

# Initialize ADW

Preserve repository-owned content. Modify only the bounded ADW blocks, new ADW artifacts, and the dedicated docs checkout.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/init/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/init/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
2. Resolve and verify the project root with `git rev-parse --show-toplevel`.
3. Run `node <plugin-root>/skills/init/scripts/init.mjs preview --project-root <project-root>`.
4. Review the proposed file actions, command sources, docs branch action, and `devcontainer: untouched` result. Stop on incomplete or duplicate managed markers, a conflicting worktree, an invalid manifest, or an uncommittable docs branch.
5. Present the preview and request explicit approval before writing.
6. After approval, run `node <plugin-root>/skills/init/scripts/init.mjs apply --confirmed --project-root <project-root>`.
7. Report created and changed paths, the docs worktree action, unresolved command values, and any remaining manual decisions. Do not commit code-branch initialization files automatically.

The internal script must:

- preserve all bytes outside `<!-- ADW:START -->` / `<!-- ADW:END -->` blocks in `AGENTS.md` and `CLAUDE.md`;
- preserve all bytes outside `# ADW:START` / `# ADW:END` in `.gitignore` and avoid duplicate `.adw/` or `/worktrees/` rules;
- ignore local paths before creating `.adw/local.yaml`, `.adw/cache/`, or `worktrees/docs`;
- retain an existing `adw.yaml` for explicit migration instead of overwriting it;
- cite every detected validation command to a manifest or task-runner target and mark unknown commands unresolved and optional;
- create an orphan `docs` branch only when absent, attach an existing branch, and reuse an existing correct worktree;
- initialize only concise docs-branch context and commit that branch without disturbing the code checkout;
- never create or edit `.devcontainer/`, existing project docs, plugin files, or unrelated paths.

Resolve templates and scripts from the installed plugin root. Never copy plugin implementation into the project.
