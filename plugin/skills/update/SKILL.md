---
name: update
description: Preview and repair ADW-managed development and permission files after a plugin update. Use after a provider-managed plugin update or a managed-file doctor failure.
---

# Repair Managed Files

Provider plugin managers update ADW itself. This workflow regenerates only ADW-owned managed-development and permission files through an exact preview, digest, and apply flow. It never rewrites `adw.yaml`, application code, project-owned containers, plans, approvals, or run history. ADW provides no backward-compatibility or migration lifecycle: the installed release's project contract is the only accepted contract.

1. Resolve the installed plugin root from this loaded skill:
   - In Claude Code, expand `${CLAUDE_PLUGIN_ROOT}` and use `${CLAUDE_PLUGIN_ROOT}/skills/update/SKILL.md` as this skill's absolute locator.
   - In Codex, use the absolute `SKILL.md` source locator advertised when this skill loaded.
   - Remove `/skills/update/SKILL.md` from that locator. Never derive plugin resources from the current working directory or the target project.
2. Resolve the project root with `git rev-parse --show-toplevel` and run `node <plugin-root>/skills/update/scripts/update.mjs preview --project-root <project-root>`.
3. If project validation fails, stop and report the exact contract errors. Update does not translate or reinterpret configuration. A repository still on a superseded ADW contract belongs in `adw:doctor`, which prints the transition guidance.
4. Review every proposed write. A `provider-sandbox` or `project-devcontainer` project normally has an empty write set, because ADW owns no managed files there. A `managed-devcontainer` project may propose current release bytes for `.devcontainer/` and both agents' project permission files, preserving compatibility with the recorded managed profile, configured allowlist domains, and committed `development.runtime_versions`.
5. If no repair is required, report that the managed files are current and stop. Otherwise present the full path list and obtain plain explicit confirmation. Keep the preview digest internal; do not show, name, or ask the person to copy it.
6. After confirmation, run the same command as `apply --confirmed --preview-digest <internally-retained-preview-digest>`. Any change to HEAD, current managed bytes, generated environment evidence, installed plugin version, or proposed target bytes invalidates the digest. Review the resulting diff; do not commit or push unless separately authorized.

The repair is an atomic, precondition-checked regeneration of release-owned files that rejects absolute paths, traversal, and symlink escapes. Project configuration, historical formats, and workflow evidence are outside this command's scope.
