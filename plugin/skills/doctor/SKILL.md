---
name: doctor
description: Diagnose an ADW installation and initialized project without changing it. Use when checking provider/plugin compatibility, project schema, ignored local paths, routing blocks, docs context freshness, or optional integrations.
---

# Diagnose ADW

Perform every check read-only. Do not repair files, create caches, refresh integrations, or run project commands.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/doctor/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute source location advertised for this skill, specifically its absolute `SKILL.md` locator.
   - Remove `/skills/doctor/SKILL.md` from that locator. Never assume that the current working directory is the plugin root.
2. Resolve the project root with `git rev-parse --show-toplevel`. Stop if the requested directory is not that root.
3. Run `node <plugin-root>/skills/doctor/scripts/snapshot.mjs --project-root <project-root>`.
4. Report each pass, warning, informational result, and failure. Include:
   - both provider manifests, shared version, and shared skill tree;
   - supported project schema and configured docs checkout;
   - exactly one bounded routing block in `AGENTS.md` and `CLAUDE.md`;
   - ignored `.adw/` and root-level `/worktrees/` paths;
   - the attached `docs` worktree and `SYNC.yaml` freshness;
   - optional origin and project-owned devcontainer state.
5. Treat a missing resource, a literal unexpanded Claude variable, or a path outside the installed plugin root as a plugin failure.
6. Offer `adw:init`, `adw:update`, or a manual project edit as a separate follow-up. Make no repair during doctor.

Resolve any bundled schema, template, helper, or script from the same plugin root. Never write generated state into the installed plugin directory.
