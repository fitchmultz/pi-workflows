# Development and Git installs

[Back to the README](../README.md)

## Git installation and migration

The Git package source remains supported:

```bash
pi install git:github.com/fitchmultz/pi-workflows
```

Existing tag/branch installs and project-kit use remain supported. For a checkout, run `npm ci --ignore-scripts`, then start `pi` inside the repository to use its `.pi` assets after granting project trust.

To move an installed Git package to the scoped npm package, remove only its package declaration and install the scoped source:

```bash
pi remove git:github.com/fitchmultz/pi-workflows
pi install npm:@fitchmultz/pi-subagents
pi install npm:@fitchmultz/pi-workflows
```

If the Git package was installed with `--local`, also use `--local` when removing it. Preserve project scripts and other settings. The installed recipe profiles require Subagents 0.44.4+; Pi 1.0.0+ is the supported floor.

## Repository layout

```text
.pi/extensions/pi-workflows/   # commands, tool, runtime, highlight, approval card
.pi/prompts/recipe-*.md        # 17 recipe slash commands
.pi/skills/                    # 31 skills
.pi/agents/                    # 25 specialist agents
.pi/workflows/                 # saved scripts (optional)
.pi/workflow-size              # size guideline (optional)
.pi/workflow-allow             # Always names (optional)
resources/                     # generated public runtime/skills/prompts/profiles
reference/workflows/           # canonical recipe source (MIT)
.github/readme/                # editable README diagram and rendered image
```

Edit recipe sources under `reference/workflows` and their translation in `scripts/build.mjs`. Edit the runtime under `.pi/extensions/pi-workflows`. Regenerate both `.pi` recipe assets and public `resources/` with the build command; do not hand-edit generated assets.

The generator preserves the project kit and produces the public package layout. Only source-owned runtime, skills, prompts and profiles ship. Private `.pi` scripts, size/Always state and user data never enter the tarball. README diagram assets stay in `.github/readme/`, outside the package's `files` list.

The explicit Pi manifest loads the public runtime, skills and recipe prompts. Subagents 0.44.4+ reads the separate `subagents.agents` manifest through configured installed-package discovery. Profiles are read-only fallbacks below user and trusted-project overrides. No copying into user directories or live activation is needed.

## Build and check

```bash
npm ci --ignore-scripts
npm run build          # regenerate vendored recipe assets and public resources
npm run check:compat
npm pack --dry-run --ignore-scripts
```

Inspect the diff after regeneration. `npm run check` verifies generated assets without rewriting them. `check:compat` runs that check, type-checks the project extension, and runs the Node tests, native project/packed-package discovery and a real child-CLI test.

The packed consumer installs the documented scoped Subagents prerequisite. Offline qualification can supply a reviewed tarball with `PI_WORKFLOWS_SUBAGENTS_TARBALL=/absolute/package.tgz`. `PI_WORKFLOWS_TARBALL=/absolute/workflows.tgz` reuses one exact artifact across host checks.

The supported/development baseline is official Pi 1.0.0, its exact eight-package 1.0 cohort, TypeBox 1.3.27 and physical Node 24.21.0 used for qualification. The shared compatibility runner installs the selected official or fork cohort in this checkout's `node_modules`. Tests verify SDK/types/manifest-bin identity rather than finding `pi` on PATH. This development baseline does not raise the Node/platform floor.

The child runs JSON print mode against a credential-free loopback provider, proving completed/length-limited results and awaited shutdown without paid calls. Tests select the exact `PI_PACKAGE_DIR`/SDK/manifest-bin identity in an isolated environment instead of an inherited live fork override.

Native project tests retain trusted `.pi` discovery and the actual child CLI contracts. `scripts/package.test.mjs` checks a packed artifact in an unrelated clean consumer with real Subagents profile-tool calls, native recipe/skill discovery, runtime commands and project-local state. Generic resource loading alone does not prove profile composition or recipe execution.

UI qualification covers native-control approval/edit/cancel and keyword-editor flow in fullscreen and regular mode, narrow/wide/CJK, focus, resize and disposal. See [Pi contracts and qualification](pi-1.0.md) for exact sources, lifecycle boundaries, the trusted-script runtime ceiling and repeatable checks.
