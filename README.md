# pi-workflows

pi-workflows adds development recipes and parallel worker scripts to [Pi](https://github.com/earendil-works/pi). Recipes bring in specialists for each stage of a change; scripts handle repeated work across many files.

![A request in Pi branches into recipes with specialist review gates and product deliverables, or an approved script with parallel workers and collected results.](.github/readme/workflow-paths.png)

*A recipe guides one change. A script splits work across workers and brings back their results.*

## Install and try it

You'll need Pi 1.0.0+ and [Pi Subagents](https://github.com/fitchmultz/pi-subagents) 0.44.4+ for the recipe specialists. Run these in your project:

```bash
pi install npm:@fitchmultz/pi-subagents
pi install npm:@fitchmultz/pi-workflows
pi
```

Then, in Pi:

```text
/workflows
/recipe-design Add account recovery
```

`/workflows` shows what's available and tells you which recipe tools are missing. Recipes also need `todo_list`, `ask_question` and `agent_browser_web_search`; install their providers separately before starting a recipe.

Prefer Git? See [Git installation and migration](docs/development.md#git-installation-and-migration).

## Where to start

| You want to… | Try this |
| --- | --- |
| Plan a feature before changing code | `/recipe-design Add account recovery` |
| Build a change with review steps | `/recipe-implement Add rate limiting to the public API` |
| Investigate a bug | `/recipe-diagnose Login returns 500 after deploy` |
| Design frontend screens | `/recipe-front-design Add account recovery screens` |
| Build a full-stack feature | `/recipe-fullstack-implement Add account recovery` |
| Check many files the same way | `use a workflow to audit every route handler for missing auth` |
| Cross-check a research question | `/deep-research What changed in Node's permission model between v20 and v22?` |

For a small fix or a quick question, just ask Pi directly.

## Use a recipe

A recipe tells Pi which specialist to bring in next and when to ask for your approval. You stay in the same conversation while specialists handle the individual steps.

Type `/recipe` to find a recipe in command completion, then put your request after the command:

```text
/recipe-implement Add rate limiting to the public API
/recipe-review docs/design/rate-limit.md
```

`/recipe-implement` handles backend and general development. For frontend work, use `/recipe-front-design` → `/recipe-front-plan` → `/recipe-front-build`. Use `/recipe-fullstack-implement` when the change spans both.

There are 17 recipes, 31 skills and 25 specialist profiles. `/workflows` lists them all.

## Run a script

For a route audit, you can have each worker inspect a different file and collect the answers in one result. Pi writes the JavaScript that coordinates them:

```text
use a workflow to audit every route handler under src/routes/ for missing auth
```

`run a workflow`, `write a workflow` and `ultracode` also trigger scripted work. The phrase highlights in the editor; press Alt+W / Option+W if you didn't mean to trigger it.

Before a script runs in the terminal UI, you get these choices:

| Choice | What happens |
| --- | --- |
| Once | Run this time. |
| Always | Skip future approval for this workflow name in this project. |
| View | Read or edit the script, then return to the approval card. |
| Deny | Cancel without starting. |

You can also run `/deep-research <question>` to use the bundled research script. Scripted workers use native file and shell tools. They don't inherit recipe specialists or browser extension tools.

Workers can read and change files and run shell commands. Only approve scripts you trust: the runtime isn't a security sandbox and has no CPU deadline. RPC uses a confirmation dialog; non-UI runs start without the approval card. Each worker makes model calls, so larger runs use more of your provider's allowance.

### Watch a run or save it for later

Use `/workflows` to pick a run. You can view its result, pause, resume, stop or save it. Runs and their resume cache last for the current extension session. Saving writes `.pi/workflows/<name>.js`; it becomes `/<name>` in the next session.

`/workflow-size` shows the agent-count guideline. Change it with `/workflow-size small`, `medium`, `large` or `unrestricted`. The default is `medium` (fewer than 15 agents). These guide the script's size; the runtime still allows at most 16 workers at once and 1,000 calls per run.

The [scripted workflow guide](docs/scripted-workflows.md) has a complete example and explains worker results, approval and resume behavior.

## More detail

Read the [development guide](docs/development.md) for Git installs, the repository layout and build commands. [Pi contracts and qualification](docs/pi-1.0.md) covers exact host versions and compatibility testing.

Changes are in the [changelog](CHANGELOG.md). If something breaks or you have an idea, [open an issue](https://github.com/fitchmultz/pi-workflows/issues).

## License

[MIT](LICENSE).
