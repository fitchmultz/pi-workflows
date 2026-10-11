# pi-workflows

Give [Pi](https://github.com/earendil-works/pi) a repeatable way to tackle product work and large batches of tasks. Use recipes to work through design, implementation and review with specialists, or run a JavaScript workflow that coordinates many workers and collects their results.

![A request in Pi branches into recipes with specialist review gates and product deliverables, or an approved script with parallel workers and collected results.](.github/readme/workflow-paths.png)

*Choose a recipe for staged product work; choose a script for repeatable work across many files.*

## Install and try it

Requires **Pi 1.0.0+** and **[Pi Subagents](https://github.com/fitchmultz/pi-subagents) 0.44.4+** for recipe specialists.

```bash
pi install npm:@fitchmultz/pi-subagents
pi install npm:@fitchmultz/pi-workflows
pi
```

In your project, start with:

```text
/workflows
/recipe-design Add account recovery
```

`/workflows` lists the bundled recipes, skills and specialists, and reports missing recipe tools. Recipes also need `todo_list`, `ask_question` and `agent_browser_web_search`; install their providers separately before running a recipe.

Prefer Git? See [Git installation and migration](docs/development.md#git-installation-and-migration).

## Choose your starting point

| You want to… | Start here |
| --- | --- |
| Plan a feature before changing code | `/recipe-design Add account recovery` |
| Take a change through implementation and review | `/recipe-implement Add rate limiting to the public API` |
| Investigate an unexplained bug | `/recipe-diagnose Login returns 500 after deploy` |
| Design frontend screens | `/recipe-front-design Add account recovery screens` |
| Build a full-stack feature | `/recipe-fullstack-implement Add account recovery` |
| Apply the same check to many files | `use a workflow to audit every route handler for missing auth` |
| Cross-check a research question | `/deep-research What changed in Node's permission model between v20 and v22?` |

For a small fix or a quick question, talking to Pi directly is often enough.

## Work through a recipe

Recipes keep the work in your conversation and bring in named specialists for analysis, design, execution and verification. They include approval points so you can inspect the plan before implementation.

Type `/recipe` to find a recipe in command completion, then put your request after the command. For example:

```text
/recipe-implement Add rate limiting to the public API
/recipe-review docs/design/rate-limit.md
```

`/recipe-implement` is the backend/general path. The frontend sequence is `/recipe-front-design` → `/recipe-front-plan` → `/recipe-front-build`; `/recipe-fullstack-implement` covers full-stack work.

The package includes **17 recipes, 31 skills and 25 specialist profiles**. Use `/workflows` to explore them.

## Run a scripted workflow

Scripts are useful when many independent tasks need the same treatment. The orchestration and intermediate results live in JavaScript variables, keeping the main conversation manageable.

Ask Pi to write and run one:

```text
use a workflow to audit every route handler under src/routes/ for missing auth
run a workflow to migrate src/components/ from styled-components to Tailwind
ultracode: keep running tsc until it passes or two rounds make no progress
```

The trigger phrase highlights in the editor. Press **Alt+W / Option+W** to dismiss an unintended trigger.

Before a script runs in the terminal UI, choose:

- **Once** — run it this time.
- **Always** — allow this workflow name in this project on future runs.
- **View** — read or edit the script, then return to the approval card.
- **Deny** — cancel it.

Use `/deep-research <question>` to run the bundled research script without asking Pi to write a new one. Scripted workers use native file and shell tools; they do not inherit the recipe specialists or browser extension tools.

**Approve only scripts you trust.** This is a trusted local-script runtime with file and shell access through its workers. It has no security sandbox or CPU deadline. Scripts restrict direct imports, `require`, `fetch` and `process` access. RPC asks for confirmation; non-UI mode runs without the approval card. Workers make their own model calls, so larger runs use more of your model provider's allowance.

### Watch, pause and reuse

Use `/workflows` to pick a run, then **View**, **Pause**, **Resume**, **Stop** or **Save**. Runs and their resume cache last for the current extension session. Saving keeps the script in `.pi/workflows/<name>.js`; it becomes `/<name>` in the next session.

`/workflow-size` shows the agent-count guideline. Set it with `/workflow-size small`, `medium`, `large` or `unrestricted`. The default is `medium` (fewer than 15 agents). These are planning guidelines; the runtime allows at most 16 workers at once and 1,000 calls per run.

See the [script example and runtime reference](docs/scripted-workflows.md) for `agent()`, `pipeline()`, size settings, approval controls and resume behavior.

## Learn more

- [Scripted workflows](docs/scripted-workflows.md) — write a script and understand worker results and run controls.
- [Development and Git installs](docs/development.md) — repository layout, generated assets and compatibility checks.
- [Pi contracts and qualification](docs/pi-1.0.md) — exact host versions, lifecycle and UI test coverage.
- [Changelog](CHANGELOG.md) — release history.
- [Issues](https://github.com/fitchmultz/pi-workflows/issues) — report a problem or suggest an improvement.

## License

[MIT](LICENSE).
