---
name: update
description: Check compatibility between the installed ADW plugin and a project's workflow schema, then preview and apply only required project artifact migrations. Use after a provider-managed plugin update, when doctor reports an unsupported project schema, or when recovering an interrupted migration; never use it to update the plugin itself.
---

# Update Project Artifacts

Limit this workflow to plugin-schema compatibility and project artifact migration. Provider plugin managers update ADW itself.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/update/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/update/SKILL.md` from that locator. Never derive plugin resources from the current working directory.
2. Resolve the project root with `git rev-parse --show-toplevel` and run `node <plugin-root>/skills/update/scripts/update.mjs preview --project-root <project-root>`.
   - Resolve `<plugin-root>/execution/contracts.md`. Migration from a pre-schema-3 project may run outside the future required environment because it only records the existing boundary; after migration, enforce the selected profile for later mutations.
3. If the installed plugin supports the current project schema, report compatibility and stop. Do not normalize, regenerate, touch, commit, or migrate any project file for a patch/minor plugin update.
4. If the project is newer than the plugin or no contiguous bundled migration exists, stop and recommend installing a compatible plugin version or performing a reviewed manual recovery. Never downgrade artifacts.
5. When migration is required, require a clean worktree and show the exact before/after bytes, explicit write paths, source/target schemas, and preview digest. Historical `changes/` artifacts, specifications, approvals, validation evidence, and repository-owned documentation are protected and must remain untouched.
6. Ask for explicit confirmation. Apply only the exact reviewed preview by running:
   `node <plugin-root>/skills/update/scripts/update.mjs apply --confirmed --preview-digest <digest> --project-root <project-root>`.
7. The script must invoke the installed plugin's transactional migration helper with exact-content preconditions. Validate compatibility again after applying, show the project diff, and leave committing to the user.

If migration is interrupted or fails, do not retry blindly. Confirm `adw.yaml` still has the previous schema and content, inspect for an `.adw-migration-*` directory, and rerun preview only from a clean checkout. The helper restores replaced files on failure; if external interruption prevented cleanup, preserve the prior committed configuration, remove temporary state only after inspecting it, and install the last compatible plugin version if recovery cannot be verified.
