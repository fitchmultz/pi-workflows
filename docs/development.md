# Development and Git installs

[Back to the README](../README.md)

## Compatibility

Pi 1.0.0 or later is the supported floor. Scripted workflows have no sibling prerequisite. Installed recipe profiles require Pi Subagents 0.44.4 or later and its `subagents.agents` manifest; a compatible `subagent` executor must support `agent`, `task`, `label` and `tasks`.

## Git installation and migration

The Git package source remains supported:

```bash
pi install git:github.com/fitchmultz/pi-workflows
```

For a checkout, run `npm ci --ignore-scripts`, then start `pi` inside the repository to use its `.pi` assets after granting project trust.

To move an installed Git package to the scoped npm package, remove only its package declaration and install the scoped source:

```bash
pi remove git:github.com/fitchmultz/pi-workflows
pi install npm:@fitchmultz/pi-workflows
```

If the Git package was installed with `--local`, also use `--local` when removing it. Preserve project scripts and other settings. The optional recipe integrations are listed in the README.

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

The explicit Pi manifest loads the public runtime, skills and recipe prompts. Pi Subagents reads the separate `subagents.agents` manifest through configured installed-package discovery. Profiles are read-only fallbacks below user and trusted-project overrides. No copying into user directories or live activation is needed.

## Recipe admission boundary

All four documented tools, including search, are hard prerequisites for all 17 recipes. Admission matches exact registered callable names; namespace metadata groups tools without changing those names or authenticating their provider, and namespace aliases do not substitute for a required tool name. Admission accepts active tools, native codemode/tool-search reachability, the compatible cold Subagents loader, or native instruction-group deferral. The latter requires active `discover_tools`, a still-admitted nonhidden registration, and membership in the latest array-valued `inactive` record of `pi:instruction-groups` on the current raw `sessionManager.getBranch()`. Each array replaces earlier arrays and only strings count. Reads are uncached; abandoned branches and compacted context are not substitutes for the raw branch. Exclusions and ordinary user-inactive tools are not widened.

The group journal is a documented fork contract, not an official-host API requirement. A replacement discovery mechanism without that journal is not recognized and fails closed. Recorded deferrals can outlive discoverability after selection changes or removal of a group's registration while its tool stays registered. Input precedes native pre-run retirement, and group-registration removal can leave stale admission across runs. Registry exclusions are still rejected, but the generated model preflight remains the final stop whenever native discovery cannot restore a tool. It also verifies actual profiles, provider configuration and approval dialogs; admission alone does not prove their readiness.

Denial persists a displayed `recipe-unavailable` message with `triggerTurn:false`, so it does not steer an in-flight turn. UI clients also receive an error notification. Non-UI SDK and print callers share stderr and `process.exitCode = 1`; continuing embedders must consume the diagnostic and reset that process-wide status after handling the failed invocation.

## Build and check

```bash
npm ci --ignore-scripts
npm run build          # regenerate vendored recipe assets and public resources
npm run check:compat
npm pack --dry-run --ignore-scripts
```

Inspect the diff after regeneration. `npm run check` verifies generated assets without rewriting them. `check:compat` runs that check, type-checks the project extension, and runs the Node tests, native project/packed-package discovery and a real child-CLI test.

The packed consumer first installs workflows alone and exercises its native runtime and missing-recipe path, then adds the minimum supported Subagents release. Without an override, it also checks an unpinned native Git install and its prepare step separately. Offline qualification can supply a reviewed minimum-version tarball with `PI_WORKFLOWS_SUBAGENTS_TARBALL=/absolute/package.tgz`. `PI_WORKFLOWS_TARBALL=/absolute/workflows.tgz` reuses one exact artifact across host checks.

The supported/development baseline is official Pi 1.0.0, its exact eight-package 1.0 cohort, TypeBox 1.3.27 and physical Node 24.21.0 used for qualification. The shared compatibility runner installs the selected official or fork cohort in this checkout's `node_modules`. Tests verify SDK/types/manifest-bin identity rather than finding `pi` on PATH. This development baseline does not raise the Node/platform floor.

The child runs JSON print mode against a credential-free loopback provider, proving completed/length-limited results and awaited shutdown without paid calls. Tests select the exact `PI_PACKAGE_DIR`/SDK/manifest-bin identity in an isolated environment instead of an inherited live fork override.

Native project tests retain trusted `.pi` discovery, actual child CLI contracts and successful standalone worker fan-out. `scripts/recipes.test.mjs` exercises native owned prompt/skill admission, missing/disabled/incompatible capabilities, real tool-search/codemode factories, cold lazy loading and unrelated namesakes. On fork hosts exporting `instructionGroupsExtension`, one real loopback turn produces the group deferral before branch/selection controls run; official hosts explicitly skip those fork-only cases. A held loopback turn checks non-steering denial. `scripts/package.test.mjs` checks text/JSON CLI failure and real cold Subagents admission in an unrelated packed consumer, then real profile-tool calls and generated task/label payload delivery to a native specialist child through a credential-free loopback fixture. For that child probe, it temporarily routes Subagents' bare `pi` lookup through a private executable shim pinned to the selected Node/manifest CLI and requires exactly one invocation receipt; PATH is restored afterwards. Identity records hash the JavaScript bundle, including executable payloads and chunks, rather than just the launcher stub. The POSIX child probe explicitly reports a skipped step on Windows because Subagents 0.44.4 spawns without a shell; the other packed checks still run. The test clears inherited child/Intercom/session routing and requires an explicitly selected fixture model. Generic resource loading alone does not prove profile composition or recipe execution; these checks do not claim model obedience to an entire recipe or live provider/dialog readiness.

UI qualification covers native-control approval/edit/cancel and keyword-editor flow in fullscreen and regular mode, narrow/wide/CJK, focus, resize and disposal. See [Pi contracts and qualification](pi-1.0.md) for exact sources, lifecycle boundaries, the trusted-script runtime ceiling and repeatable checks.
