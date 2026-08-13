# Updating and recovery

## Plugin updates

Plugin managers distribute skill, schema, template, and helper changes. Pin private installations to a semantic-version tag for reproducibility. After updating the marketplace snapshot, reinstall or update the provider plugin and start a new session.

Run `adw:doctor` before resuming active work. Roll back through the provider manager to the previous tag when needed.

## Managed-file repair

ADW does not provide a backward-compatibility or migration lifecycle. The installed release's artifact validators define the accepted configuration. Invalid configuration stops update without writes.

Run `adw:update` to validate the project and preview managed-file repair:

1. It reads the installed plugin version.
2. It parses and validates root `adw.yaml` through the bundled YAML 1.2 and schema validator without rewriting the file, including any initialization-selected `development.runtime_versions` needed to reproduce the managed container. For schema-5 projects initialized before that optional field was persisted, update recovers only explicitly onboarding-sourced versions from consistent `.devcontainer/project-requirements.json` evidence and otherwise stops for a manual configuration correction.
3. For provider-sandbox and project-owned-container profiles it normally reports an empty write set.
4. For a managed container it deterministically regenerates current release `.devcontainer/` and both agents' permission bytes, showing the changed paths for review. After plain approval, the skill passes its internally retained preview digest to `apply`, which atomically repairs exactly those reviewed files.
5. It rejects invalid configuration without modifying project or historical artifacts.

This repairs exact plugin-version marker drift and managed-template drift after ordinary plugin upgrades. If configuration from an older release is invalid, replace it through a separately reviewed initialization or manual configuration change. Preserve application code and repository-owned documentation; historical workflow evidence is not upgraded.

## Docs synchronization recovery

`adw:sync-docs` reports drift without mutation by default. Authorized fix mode stops on dirty state, ambiguous history, or a non-fast-forward docs branch. Resolve or preserve the competing docs work first, refresh the report, and authorize a new update. Never force-push the docs branch or advance `SYNC.yaml` without the corresponding reviewed context update.

## Active-change recovery

Use `adw:status` in a new session. It reconstructs the spec, plan, approval bundle, external bindings and receipts, docs commit, code branch, validation, and draft-PR state from durable artifacts. If local intent or bound requirement content no longer matches approval, amend or reapprove before execution. Provider state is read only when its capability is configured and available.
