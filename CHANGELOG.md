# Changelog

## [0.2.1] - 2026-10-04

- Deliver the complete kit as public `@fitchmultz/pi-workflows`: generator-owned nonhidden runtime, all 31 skills, 25 specialist profiles and 17 recipe prompts. The unscoped npm package is unrelated.
- Compose installed profiles through `@fitchmultz/pi-subagents` 0.44.4 or later and its `subagents.agents` package discovery; user/trusted-project overrides remain authoritative.
- Keep the project Git `.pi` layout, saved scripts, size/Always policies and generic scripted workers intact. Resolve latest official/fork hosts once for repository qualification and pipeline release checks.

## [0.2.0] - 2026-10-01

- Require Pi 1.0.0 and align development SDK/TUI pins and documentation with its public contracts. Keep the project-local recipes, skills, specialist profiles and fresh child contexts; nothing is installed globally.
- Parse worker JSONL incrementally with native UTF-8 decoding and EOF handling. Return only a completed final assistant after successful exit; never treat logs, partial output, length limits, errors or cancellation as successful results.
- Wait for started workers before workflow completion, keep cancelled workers unfinished for resume, and abort/await owned work during session shutdown. Scope runs to the extension instance and report paused/running status truthfully.
- Build approval from native controls with width, mouse and disposal support. Configured navigation/confirmation/cancellation takes precedence over legacy shortcut fallbacks; preserve script editing, project-local Always, RPC confirmation, non-UI policy and the keyword editor.
- Preserve all 31 skills, 25 specialist profiles and 17 recipe prompts through canonical generation. Document the existing trusted-script VM ceiling: not an untrusted security sandbox or CPU deadline.

Historical 0.2.0 delivery was Git/GitHub-only. This repository never publishes the unrelated unscoped npm package name. Earlier releases are recorded in [GitHub Releases](https://github.com/fitchmultz/pi-workflows/releases).
