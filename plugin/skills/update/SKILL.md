---
name: update
description: Check compatibility between the installed ADW plugin and the current project schema without changing project files. Use after a provider-managed plugin update or when doctor reports an unsupported project schema; previous ADW versions are not migrated.
---

# Check Project Compatibility

Limit this workflow to plugin-schema compatibility. Provider plugin managers update ADW itself. This release supports only its current project schema and does not carry automatic migrations from previous ADW versions.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/update/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/update/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
2. Resolve the project root with `git rev-parse --show-toplevel` and run `node <plugin-root>/skills/update/scripts/update.mjs preview --project-root <project-root>`.
3. If the installed plugin supports the current project schema, report compatibility and stop. Do not normalize, regenerate, touch, commit, or migrate any project file.
4. If the schema is unsupported, stop. Report the installed plugin version, project schema, and supported schema. Do not attempt an automatic migration, downgrade, or partial rewrite.
5. Recommend reinitializing ADW from the current release in a clean project or performing a separately reviewed manual replacement of ADW-owned configuration. Preserve application code and repository-owned documentation, but do not claim historical ADW artifacts are compatible.

The `apply` command is intentionally a no-op compatibility check for current projects and refuses unsupported projects. It exists only to keep the preview/apply interface deterministic while no migration paths are bundled.
