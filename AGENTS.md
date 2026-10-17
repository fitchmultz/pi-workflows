# Dependency maintenance

- Frequently review and proactively update maintained packages and all runtime,
  development, build, test, and tooling dependencies. Routine in-scope updates are
  authorized; do not wait for breakage. Prioritize the latest stable official Pi
  release and intended `fitchmultz/pi` revision, qualifying them separately.
- Review release, changelog, migration, and security notes across the upgrade
  range and check actual supported contracts, not version numbers alone.
  Preserve support floors, standalone scripted workflows, recipe prerequisites,
  approval/cancellation behavior, and optional integration boundaries. Use npm,
  Node 24, and compatible manifest/committed-lockfile cohorts.
- Adopt beneficial current APIs, conventions, patterns, and functionality instead
  of extending deprecated or outdated approaches. Align callers, documentation,
  fixtures, and generated resources. Use the canonical `scripts/build.mjs` and
  `npm run build` for both shipped layouts; do not hand-edit generated copies or
  replace repository policy with vendor/reference instructions.
- Carry updates through existing `npm run check:compat`, package, exact-host
  native, required review, and CI gates. Report exact target identities, failures,
  skips, and limits; neither content checks nor loader admission prove complete
  recipe execution. Never weaken checkers, safety, or support floors to pass an
  update.
- Roll out through existing approval, release, and installation gates with a
  recoverable prior version and rollback plan; honor explicit holds. This
  authorization does not itself permit publication, active-runtime
  installation/restarts, private-data disclosure, or global model/auth changes.
