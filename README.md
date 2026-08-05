# ADW

ADW is a private, dual-provider plugin that gives Codex and Claude Code the same Git-native development workflow:

```text
discover -> plan -> approve -> execute -> validate -> draft PR
```

The plugin contains the skills, schemas, templates, and deterministic helper. Initialized projects contain only project-specific `adw.yaml`, bounded routing blocks, ignored local state, and a `docs` branch checked out at `worktrees/docs`.

## Requirements

- Node.js 20 or newer for the bundled internal helper.
- Git with worktree support.
- A current Codex or Claude Code plugin manager.
- GitHub tooling only when the user explicitly authorizes draft-PR work.

## Private development installation

From the repository root, register the local marketplace and install `adw` in each provider:

```bash
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

Then start a new provider session in a target Git project and invoke `adw:init`. See [private installation](docs/private-installation.md) for tagged private repositories, organization distribution, update, and rollback guidance.

## MVP skills

- Foundation: `adw:init`, `adw:doctor`, `adw:status`, `adw:discover`
- Change loop: `adw:plan`, `adw:approve`, `adw:amend`, `adw:execute`
- Delivery: `adw:quick`, `adw:address-review`
- Maintenance: `adw:sync-docs`, `adw:update`

The first release intentionally excludes the deferred `brainstorm`, `review-plan`, and `add-mcp` skills.

## Development

```bash
npm test
claude plugin validate --strict plugin
claude plugin validate --strict .claude-plugin/marketplace.json
```

ADW never merges, releases, deploys, force-pushes, or applies external writes without explicit authorization.
