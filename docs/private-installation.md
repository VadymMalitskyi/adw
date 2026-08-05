# Private installation

## Local personal development

Use absolute paths so provider configuration does not depend on the current directory:

```bash
codex plugin marketplace add /absolute/path/to/adw
codex plugin add adw@adw-local

claude plugin marketplace add /absolute/path/to/adw
claude plugin install adw@adw-local --scope user
```

Start a new session after installation or update so the provider reloads skill metadata. The plugin is installed into provider-managed storage; do not copy `plugin/` into a target project.

## Tagged private repository

Push and tag only through the repository owner's normal release process. Users with read access can register the private Git source at a pinned tag or commit using each provider's marketplace command, then install `adw@adw-local`. Provider authentication must use existing Git credential mechanisms; never paste tokens into ADW configuration.

For rollback, point the marketplace at the last-known-good tag, update the marketplace snapshot, reinstall the plugin, and start a new session. Do not run `adw:update` for a plugin-only rollback.

## Organization-private distribution

Mirror or transfer this repository into the private organization, grant the intended users read access, and register the same marketplace with approved users or groups. Claude installations may use project or managed settings when organization policy requires them. Codex workspace sharing should keep the plugin restricted to the selected workspace users/groups.

Organization policy and marketplace allowlists override these instructions. ADW does not start authentication, widen repository access, or publish itself.

## Verification

After install, invoke `adw:doctor`. It should report provider namespace `adw`, plugin version, project-schema compatibility, bundled resource resolution, routing blocks, ignore rules, docs worktree state, and optional integrations without writing anything.
