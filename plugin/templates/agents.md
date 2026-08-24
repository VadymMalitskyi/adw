# {{project}}

This project uses ADW. `adw.yaml` at the repository root is its shared contract:
it records the base branch, the documentation branch, execution isolation,
components, and validation commands. Read it with `adw config` rather than
transcribing it yourself.

Generated component documentation and plans live on the documentation branch
named in that contract, not on the base branch, so reading the working tree you
are standing in will not find them.

Start from a skill rather than working ad hoc:

- `adw:onboard` to get oriented in this repository.
- `adw:plan` for a change that needs a plan, then `adw:execute` to carry out one
  confirmed phase.
- `adw:quick` for a genuinely small, low-risk change that needs no plan.
- `adw:doctor` when readiness or generated-file drift is uncertain.

Commit on a branch; never push, merge, release, or deploy without being asked to.

ADW wrote this file once, when it had no conventions to record. It never rewrites
or repairs it, so everything added below belongs to the project.
