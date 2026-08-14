# Updating and recovery

## Plugin updates

Plugin managers distribute skill, template, and helper changes. Pin private installations to a semantic-version tag for reproducibility. After updating the marketplace snapshot, reinstall or update the provider plugin and start a new session.

Run `adw:doctor` before resuming active work. Roll back through the provider manager to the previous tag when needed.

ADW 1.0 breaks the 0.6 artifact contract. Do not run 1.0 skills against an in-flight 0.6 change; see [migrating from 0.6](migrating-from-0.6.md) for the two supported paths.

## Managed-file repair

ADW does not provide a backward-compatibility or migration lifecycle. The installed release's contract validation defines the accepted configuration. Invalid configuration stops update without writes.

Run `adw:update` to validate the project and preview managed-file repair:

1. It reads the installed plugin version.
2. It parses and validates root `adw.yaml` through the bundled YAML 1.2 parser and the handwritten `adw: 1` contract check without rewriting the file, including any initialization-selected `development.runtime_versions` needed to reproduce the managed container.
3. For provider-sandbox and project-owned-container profiles it normally reports an empty write set.
4. For a managed container it deterministically regenerates current release `.devcontainer/` and both agents' permission bytes, showing the changed paths for review. After plain approval, the skill passes its internally retained preview digest to `apply`, which atomically repairs exactly those reviewed files.
5. It rejects invalid configuration without modifying project or historical artifacts.

This repairs exact plugin-version marker drift and managed-template drift after ordinary plugin upgrades. If configuration from an older release is invalid, replace it through a separately reviewed initialization or manual configuration change. Preserve application code and repository-owned documentation; historical workflow evidence is not upgraded.

## Docs synchronization recovery

`adw:sync-docs` reports drift without mutation by default. Authorized fix mode stops on dirty state, ambiguous history, or a non-fast-forward docs branch. Resolve or preserve the competing docs work first, refresh the report, and authorize a new update. Never force-push the docs branch or advance `SYNC.yaml` without the corresponding reviewed context update.

## Active-change recovery

Use `adw:status` in a new session. It reconstructs the plan, approval, phase run records, group branches and worktrees, docs commit, code branch, validation, and draft-PR state from durable artifacts and Git — never from chat history. An interrupted phase resumes from the same evidence: the orchestrator reuses a group branch only when its marker commit still records the same base, plan digest, and interpreted packet. If the plan bytes no longer match approval, amend or reapprove before execution. Provider state is read only when its capability is configured and available.
