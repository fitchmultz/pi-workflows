# pi-workflows

pi-workflows adds development recipes and scripted workflows to [Pi](https://github.com/earendil-works/pi). Recipes use specialist agents; scripted workflows coordinate parallel workers.

![A request in Pi branches into recipes with specialist review gates and product deliverables, or an approved script with parallel workers and collected results.](.github/readme/workflow-paths.png)

## Install and start

pi-workflows requires Pi; see the [compatibility requirements](https://github.com/fitchmultz/pi-workflows/blob/main/docs/development.md#compatibility). The scripted `workflow` / `agent()` / `pipeline()` runtime works independently, without other extensions.

Run these commands from your project directory:

```bash
pi install npm:@fitchmultz/pi-workflows
pi
```

Then run this command in Pi:

```text
/workflows
```

`/workflows` lists 17 recipes, 31 skills and 25 agents. It reports unavailable recipe integrations without disabling scripted workflows.

### Optional recipe integrations

Recipes inherently use isolated specialists, parallel reviews, progress tools and explicit approval gates. They require a [supported Pi Subagents version](https://github.com/fitchmultz/pi-workflows/blob/main/docs/development.md#compatibility) (or a compatible `subagent` executor with `agent`/`task`/`label`/`tasks`), [`todo_list`](https://github.com/fitchmultz/pi-todo-list), [`ask_question`](https://github.com/fitchmultz/pi-ask-question), and [`agent_browser_web_search`](https://github.com/fitchmultz/pi-agent-browser-native#optional-search-and-settings). All four are hard runtime prerequisites for every recipe, even recipes without external research. These are extension integrations, not native Pi tools.

```bash
pi install npm:@fitchmultz/pi-subagents
pi install git:github.com/fitchmultz/pi-todo-list
pi install npm:@fitchmultz/pi-ask-question
pi install npm:pi-agent-browser-native
```

Configure `EXA_API_KEY` for Exa or `BRAVE_API_KEY` for Brave when using recipe research. Provider charges apply.

Owned `/recipe-*` and `/skill:recipe-*` invocations stop before model work when required tools are missing, disabled or incompatible. Cold Subagents is supported through its advertised `load_subagent` loader; native discovery can restore selected, instruction-group-deferred tools. A denied recipe reports the exact tools and does not steer an unrelated running turn. Text/JSON print mode also writes the diagnostic to stderr and exits nonzero.

Recipe instructions then verify specialist profiles and provider/dialog readiness before use; a missing capability is reported, not replaced with inline specialists, serialized reviews or assumed approval. The same instructions apply when a model reads a recipe skill directly. That model-read path is guidance, not a deterministic runtime guard.

## Choose a recipe

Recipes use named agents and include approval points. Type `/recipe` to see recipe commands.

| Task | Command |
| --- | --- |
| Plan a feature | `/recipe-design Add account recovery` |
| Build a backend or general change | `/recipe-implement Add rate limiting to the public API` |
| Investigate a bug | `/recipe-diagnose Login returns 500 after deploy` |
| Design frontend screens | `/recipe-front-design Add account recovery screens` |
| Build a full-stack feature | `/recipe-fullstack-implement Add account recovery` |
| Review a design | `/recipe-review docs/design/rate-limit.md` |

For frontend work, run `/recipe-front-design`. Next, run `/recipe-front-plan`. Then run `/recipe-front-build`.

## Run a scripted workflow

Use a scripted workflow for repeated tasks across many files. Ask Pi to write one:

```text
use a workflow to audit every route handler under src/routes/ for missing auth
```

The editor highlights the trigger phrase. Press Alt+W / Option+W to dismiss the highlight.

The terminal UI shows these choices before the script runs:

| Choice | Action |
| --- | --- |
| Once | Run the script once. |
| Always | Skip future approval for this workflow name in this project. |
| View | Read or edit the script. Then return to the approval card. |
| Deny | Cancel the script before it runs. |

Run `/deep-research <question>` to use the bundled research script.

Scripted workers use native file and shell tools. They do not inherit recipe agents or browser tools.

Workers can change files and run shell commands. Approve only scripts you trust. The runtime has no security sandbox or CPU deadline.

RPC requests confirmation for names without Always approval. Non-UI mode runs scripts without confirmation.

Each worker makes model calls. Large runs use more of your model allowance.

## Control a run

Use `/workflows` to view, pause, resume, stop or save a run. Runs and the resume cache last for the current extension session.

Save writes the script to `.pi/workflows/<name>.js`. Pi adds the `/<name>` command in the next session.

`/workflow-size` shows the agent-count guideline. Set it with `/workflow-size small`, `medium`, `large` or `unrestricted`. The default is `medium`: fewer than 15 agents.

The runtime permits at most 16 workers at once and 1,000 calls per run. Size guidelines do not change these limits.

## More detail

Read [Scripted workflows](https://github.com/fitchmultz/pi-workflows/blob/main/docs/scripted-workflows.md) for script examples, worker results and resume behavior.

Read [Development](https://github.com/fitchmultz/pi-workflows/blob/main/docs/development.md) for compatibility requirements, Git installs, the repository layout, build commands and host qualification.

Read the [changelog](CHANGELOG.md) for changes. Report problems or suggestions in [issues](https://github.com/fitchmultz/pi-workflows/issues).

## License

[MIT](LICENSE).
