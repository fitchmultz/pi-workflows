# pi-workflows

Version **0.2.0** provides two ways to run work in [Pi](https://github.com/earendil-works/pi), requiring **Pi 1.0.0 or later**. Both stay in this repo. Nothing is installed globally. Delivery is Git/GitHub-only; the similarly named npm package is unrelated and must not be published by this repository.

```bash
cd pi-workflows
pi
```

## Which one do I use?

| You want… | Use | Example |
|---|---|---|
| One change, with design / review gates | a **recipe** | `/recipe-implement "Add rate limiting"` |
| Design only, no code yet | a **recipe** | `/recipe-design "Account recovery"` |
| A bug you do not understand yet | a **recipe** | `/recipe-diagnose "login 500s after deploy"` |
| The same step on many files, or more agents than one chat can hold | a **scripted workflow** | type `use a workflow to audit every route for missing auth` |
| Cross-check a question across sources | **bundled script** | `/deep-research What changed in Node's permission model between v20 and v22?` |
| Repeat a fan-out you already liked | a **saved script** | `/workflows` → Save, then `/audit-routes` |

Recipes keep you in one conversation with specialist agents. Scripted workflows move the plan into JavaScript so intermediate results stay in variables, not in the chat.

## Recipes — staged product work

Type `/recipe` and pick one. Pass the request after the command.

```
/recipe-implement "Add rate limiting to the public API"
/recipe-front-design "Add account recovery screens"
/recipe-review docs/design/rate-limit.md
```

**When a recipe is the right tool**

- The outcome is still being agreed, or you need a PRD / Design Doc / Work Plan.
- You want stop-points before implementation.
- You want named specialists (reviewer, executor, verifier) with a handoff you can inspect.

`/recipe-implement` is the full backend/general path. Frontend is `/recipe-front-design` → `/recipe-front-plan` → `/recipe-front-build`. Full-stack is `/recipe-fullstack-implement`.

Recipe commands expand `$ARGUMENTS`. `/workflows` lists all 17 recipes, 31 skills, and 25 agents.

Recipes need these tools: `subagent`, `todo_list`, `ask_question`, `agent_browser_web_search`. `/workflows` says if they are missing.

## Scripted workflows — large fan-out

Type a trigger in the prompt. It highlights. Alt+W (Option+W) dismisses the highlight if you did not mean it.

```
use a workflow to audit every route handler under src/routes/ for missing auth
run a workflow to migrate src/components/ from styled-components to Tailwind
ultracode: keep running tsc until it passes or two rounds make no progress
```

The model writes a script and calls the `workflow` tool. In TUI you get a card built from native SelectList/Text controls (configured navigation/confirm/cancel keys take precedence; left/right/Tab remain fallback shortcuts; fullscreen also supports mouse):

- **Once** — run this time
- **Always** — run and skip the card for this name in this repo
- **View** — read or edit the script, then you return to the card
- **Deny** — do not run

Or skip the model and run the bundled one:

```
/deep-research How do our three competitors document rate limiting?
```

**When a script is the right tool**

- Dozens of files, one check each, then a merge step.
- Independent agents should review each other's findings.
- You want to pause, resume, or save the orchestration and rerun it.

**When it is the wrong tool**

- A one-file fix, a question, or anything that still needs a product decision. Use a recipe, or just talk.

### Size

Advice to the model when it writes a script. Not a hard cap. Runtime still limits 16 at a time, 1000 per run.

```
/workflow-size              # show (default medium, fewer than 15 agents)
/workflow-size small        # fewer than 5
/workflow-size large        # fewer than 50
/workflow-size unrestricted
```

Stored in `.pi/workflow-size` in this repo. `--workflow-size medium` overrides for one process.

### Watch and save

```
/workflows        # status, then pick a run: View / Pause / Resume / Stop / Save
```

Save writes `.pi/workflows/<name>.js`. That name becomes `/<name>` next session.

A script looks like this:

```js
export const meta = {
  name: 'audit-routes',
  description: 'Audit every route handler for missing auth checks',
}

const found = await agent('List every .ts file under src/routes/.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})

const audits = await pipeline(found.files, file =>
  agent(`Audit ${file} for missing authentication checks.`, { label: file }),
)

return audits.filter(Boolean)
```

`agent()` returns `null` if that worker is stopped, fails, reaches its output limit, or never produces a completed final assistant. JSONL parsing retains the current record and last assistant rather than whole worker stdout, handles fragmented UTF-8/EOF, and never substitutes logs for an answer. A queued/handled input receipt is not a finished worker: child print mode must actually finish and exit successfully.

Started workers settle before a workflow reports completion. Pause/Stop/shutdown abort owned children; shutdown waits before session-bound UI/report callbacks become stale. Runs belong to the extension instance, not a module-global pool shared across replacement sessions. Resume replays completed results and retries unfinished workers.

Scripts cannot directly import, require, fetch, or touch `process`. This is a **trusted local-script runtime**, not a security sandbox or CPU deadline; approve only scripts you trust and await orchestration. Non-UI mode intentionally runs without the selector; RPC asks for confirmation; project-local Always skips future approval for that name. Native CLI tools retain their existing authority.

## Layout

```
.pi/extensions/pi-workflows/   # commands, tool, runtime, highlight, card
.pi/prompts/recipe-*.md        # 17 recipe slash commands
.pi/skills/                    # 31 skills
.pi/agents/                    # 25 specialist agents
.pi/workflows/                 # saved scripts (optional)
.pi/workflow-size              # size guideline (optional)
.pi/workflow-allow             # Always names (optional)
reference/workflows/           # upstream recipe source (MIT)
```

```bash
npm ci --ignore-scripts
npm run build          # only when regenerating the vendored recipe assets
npm run check:compat
```

`check:compat` verifies generated assets without rewriting them, type-checks the project extension, and runs the existing Node tests plus native project discovery and a real child-CLI test. The supported/development baseline is official Pi 1.0.0, with its exact eight-package 1.0 cohort, TypeBox 1.3.27 and physical Node 24.21.0 used for qualification. The shared compatibility runner installs the selected official or fork cohort in this checkout's `node_modules`; the test verifies SDK/types/manifest-bin identity rather than finding `pi` on PATH. The child executes JSON print mode against a credential-free loopback provider, proving completed/length-limited result and awaited shutdown behavior without paid calls. Tests select the exact PI_PACKAGE_DIR/SDK/manifest-bin identity in an isolated environment, not an inherited live fork override.

This remains a **project kit**, not a globally installable Pi package. Native tests copy `.pi` into an isolated trusted project, discover the skills and recipe prompts, dispatch a real command, and check the `workflow` tool. Agent profiles and missing recipe tools still belong to the separately documented pi-subagents/extension composition; clean Pi discovery is not proof those separately installed integrations were exercised. UI qualification covers native-control approval/edit/cancel and keyword-editor flow in default fullscreen and regular mode, narrow/wide/CJK, focus, resize and disposal. No Node/platform floor is raised by the development baseline.

See [Pi 1.0 contracts and qualification](docs/pi-1.0.md) for the exact source, lifecycle boundaries, known script-runtime ceiling and repeatable checks, and the [changelog](CHANGELOG.md) for release changes.

Upstream recipe content: MIT, © Shinsuke Kagawa (`reference/workflows/LICENSE`).
This repo's port and extension: MIT.
