# ADW

ADW is a private, dual-provider plugin that gives Codex and Claude Code the same Git-native development workflow:

```text
discover -> plan -> approve -> execute -> validate -> draft PR
```

The plugin contains the skills, schemas, templates, and deterministic helper. During project initialization, ADW builds one evidence-backed model from manifests, dependencies, component roots, entry points, bounded source signatures, configuration, tests, CI, and existing documentation. That model generates both the docs-branch architecture/component context and the development container, including supported project runtimes, dependency setup, native packages, ports, and registry domains. ADW asks about setup-blocking ambiguity before approval so the initializing person can open the container and work without another configuration pass. Managed Codex and Claude Code sessions can both search the web. Codex can open result pages through its hosted tool; Claude page opening is available through an explicit `public-pages` policy because its local WebFetch necessarily weakens the container's exact-domain egress boundary. Projects with an existing Dev Container keep it unchanged. Initialized projects contain project-specific `adw.yaml`, bounded routing blocks, ignored local state, the selected execution profile, provider-native `managed-development` permission rules, and a `docs` branch checked out at `worktrees/docs`. Later contributors use `adw:onboard` to apply personal non-secret preferences, attach the existing docs branch in a fresh clone, and receive doctor/status-backed readiness guidance without changing shared policy.

Projects may also opt into provider-neutral integrations for work tracking, code hosting, observability, and knowledge. ADW targets Azure DevOps, GitHub, Datadog, and Notion first, but workflows depend on capabilities rather than provider-specific tools. A project with no integrations keeps the lightweight local workflow.

Projects can specialize the shared workflow without copying skills: affected paths resolve to project-owned components and additive validation, while optional `workflows.work_tracker` policy references a validated committed payload profile. Plans snapshot and digest only the effective policy so approval and execution detect relevant drift without reacting to unrelated configuration changes. ADW does not provide backward compatibility or artifact migrations; the installed release's validators define its accepted contract.

## Requirements

- Node.js 20 or newer for the bundled internal helper.
- Git 2.42 or newer (`adw:init` uses orphan worktree creation introduced in Git 2.42).
- Docker plus a Dev Containers client for the default managed execution profile.
- A current Codex or Claude Code plugin manager.
- Provider tooling only when an integration or external delivery is requested. Credentials remain in the provider, MCP client, CLI, or external credential store.

## Private development installation

From the repository root, register the local marketplace and install `adw` in each provider:

```bash
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

Then start a new provider session in a target Git project and invoke `adw:init`. Answer only the project choices and setup ambiguities ADW cannot safely infer, review the normalized preview, and explicitly approve before ADW writes. Commit the generated files, make the docs branch available through the project's approved delivery path, rebuild/reopen the repository in its container, and authenticate the selected agents and provider tools when first used. Project runtimes and manifest-backed dependencies install automatically. Later contributors clone and reopen the initialized project, install ADW in that environment, and run `adw:onboard`; they do not rerun `adw:init`. See [private installation](docs/private-installation.md) for tagged private repositories, organization distribution, update, and rollback guidance.

## Skills

- Foundation: `adw:init`, `adw:onboard`, `adw:doctor`, `adw:status`, `adw:discover`
- Operations: `adw:investigate`
- Change loop: `adw:plan`, `adw:approve`, `adw:amend`, `adw:execute`
- Delivery: `adw:quick`, `adw:address-review`
- Maintenance: `adw:sync-docs`, `adw:update`

The optional integration layer is configured per project; it is not a requirement for the core plan/approve/execute loop. `adw:investigate` uses configured read-only observability plus repository evidence to assess an alert without changing code or external systems. The `brainstorm`, `review-plan`, and `add-mcp` skills remain deferred, and ADW uses only transports already configured by the user. See [integration architecture](docs/integrations.md) for capabilities, provider and transport resolution, external-action safety, and Azure DevOps transport limitations.

## Development

```bash
npm test
npm run test:security
claude plugin validate --strict plugin
claude plugin validate --strict .claude-plugin/marketplace.json
```

ADW never merges, releases, deploys, force-pushes, or applies external writes without explicit authorization. Every authorized external mutation is idempotent where the provider permits it, read back for verification, and recorded as a redacted receipt.
