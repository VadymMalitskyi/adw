# Changelog

All notable changes to this private plugin are documented here.

## Unreleased

- Add read-only `adw:investigate` with bounded observability queries, deployed-code inspection, deterministic severity guidance, and schema-validated incident reports.
- Keep webhook receipt, agent supervision, and notification delivery outside ADW while defining exact JSON output for an authorized external runner.
- Derive managed Dev Container runtimes, dependency setup, native packages, forwarded ports, and package-registry domains from supported project manifests and lockfiles.
- Record evidence and unresolved requirements in a reviewable project requirements artifact, run only curated setup commands after firewall activation, and verify generated-file digests in `adw:doctor`.

## 0.3.0 - 2026-08-05

- Add a schema-3 execution contract with managed-devcontainer, project-devcontainer, and provider-sandbox profiles.
- Make a pinned, non-root, egress-filtered managed devcontainer the default for newly initialized repositories.
- Preserve project-owned devcontainers byte-for-byte and require an explicit active-runtime marker before executing project commands.
- Install pinned Codex and Claude Code CLIs in the managed image while keeping each agent's own inner permission and sandbox controls enabled.
- Add doctor and status evidence for configured and active isolation, conservative schema migration, and security-focused container tests.

## 0.2.0 - 2026-08-05

- Add provider-neutral integration contracts for work trackers, code hosts, observability systems, and knowledge systems.
- Add optional, required, and disabled integration behavior so lightweight projects remain unchanged.
- Add Azure DevOps-first work tracking, GitHub code hosting, Datadog read-only observability, and Notion knowledge-provider profiles.
- Add explicit authorization, idempotency, post-write readback, drift detection, and durable redacted receipts for external actions.
- Keep credentials outside committed ADW artifacts and allow native connector, MCP, CLI, or API transports without coupling workflows to one transport.

## 0.1.0 release candidate - 2026-08-05

- Add one shared ADW skill tree for Codex and Claude Code.
- Add private marketplace manifests for both providers.
- Add schema-validated project, planning, approval, and validation artifacts.
- Add the plan, approval, execution, maintenance, and migration workflows.
