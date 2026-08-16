---
name: doctor
description: Diagnose an ADW installation and initialized project without changing it. Use when checking the project contract, execution isolation, the managed or project devcontainer, permission policy drift, or provider availability.
---

# Diagnose ADW

Every check is read-only. Do not repair files, create caches, refresh tokens, or
run project commands.

Read `<plugin-root>/authorization.md` and resolve the plugin root as described
there.

## 1. Deterministic local checks

```
node <plugin-root>/bin/adw.mjs doctor --project-root <project-root>
```

Add `--details` when a failure needs digests and container wiring to diagnose.
Add `--checks permissions` for the cheap pre-execution gate that inspects only
the permission policy.

Exit code 0 means every check passed; 5 means at least one failed. The report
covers:

- both provider manifests, their shared version, and the shared skill tree;
- the `adw: 1` project contract;
- component paths and unambiguous ownership;
- the configured isolation, and only that one;
- Codex and Claude permission policy presence and byte-currency;
- for a managed container: the marker, pinned agent versions, project-scoped
  credential volumes, absence of host-credential and Docker-socket mounts,
  hardening, the egress allowlist against its recorded digest, generated
  requirement and setup bytes, permission payload digests, and whether the
  container is the active runtime;
- `worktrees/` being ignored, and the optional `origin` remote.

If `adw.yaml` is missing or invalid, the report stops before every check that
assumes a readable configuration. Report the exact errors. Never translate,
rewrite, or reinterpret the file — offer `adw:init` or a deliberate edit as a
separate follow-up.

## 2. Live checks the runtime cannot make

These are yours, not the CLI's.

- **Provider availability.** For each declared provider, follow
  `<plugin-root>/integrations/contracts.md`. Report capability, provider name,
  whether it is required, the selected transport, existing authentication state,
  and which of read, create, update, and link actually work. Do not authenticate,
  refresh tokens, install software, retrieve business content, or mutate
  anything. An unavailable required capability is a failure; an unavailable
  optional one is a warning that never blocks the lightweight path. Never print
  credentials or secret environment values.
- **Provider sandbox strength.** When isolation is `provider-sandbox`, report the
  real active filesystem, network, and approval policy — a script cannot attest
  host policy. Say plainly that this is the lightweight boundary.
- **Project-owned container deviations.** When isolation is
  `project-devcontainer`, report material differences from the managed
  invariants without changing the project-owned container.

## 3. Diagnose

Turn the results into a short, human diagnosis: what works, what is broken, and
the single most useful next action. A configured container that is not the
active runtime is a failure for any workflow that executes project code.

Offer `adw:init`, `adw:update`, or a specific manual edit as a separate
follow-up. Make no repair during doctor.
