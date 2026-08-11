# pi-workflows

A pi-native port of shinpr's **workflows** project (the recipe workflows, specialist subagents, and
supporting skills, by Shinsuke Kagawa, `github.com/shinpr`), recreated for
[pi](https://github.com/earendil-works/pi-mono) using pi's own extension, skill, prompt-template,
and subagent mechanisms.

Upstream source is vendored in `reference/workflows` (MIT, pinned at commit
`416af890969891658619fafcf794aeab5b26a366`, 2026-08-09, with harness-specific naming scrubbed).
All pi artifacts are generated from it by `scripts/build.mjs`; do not edit `.pi/skills`,
`.pi/agents`, or `.pi/prompts` by hand.

## Quick start

Everything is project-local. Run pi from this repository root and all resources load automatically
(the repo is covered by pi's normal project-trust flow; nothing is installed globally):

```bash
cd pi-workflows
pi
```

Then, inside pi:

```
/workflows                              # status: recipes, skills, agents, required tools
/recipe-implement "Add rate limiting"   # full-cycle orchestrated implementation
/recipe-design "..."                    # design only
/recipe-diagnose "..."                  # investigate a problem
/skill:coding-principles                # individual skills, like upstream
```

Recipe commands are pi prompt templates (`.pi/prompts/recipe-*.md`), so they autocomplete and
substitute `$ARGUMENTS` exactly like the upstream plugin's skill commands. Each recipe skill also
remains available as `/skill:recipe-<name>`.

### Required pi packages

The workflows orchestrate through these tools; on a stock pi install they are provided by:

| Tool | Provided by |
|---|---|
| `subagent` | [pi-subagents](https://github.com/fitchmultz/pi-subagents) |
| `todo_list` | pi-todo-list |
| `ask_question` | pi-ask-question |
| `agent_browser_web_search` | pi-agent-browser-native |

Run `/workflows` to verify they are active. Without them the skills and recipe commands still load,
but orchestration steps that call those tools cannot execute.

## What was ported

The upstream marketplace ships three workflow plugins (backend, frontend, fullstack) generated from
one canonical `agents/` + `skills/` tree. This port carries the canonical superset — identical to the
fullstack plugin: **17 recipe workflows, 14 supporting skills, 25 specialist agents**.
Pi loads skills progressively (only descriptions enter context), so the superset costs nothing over
the individual plugins. The marketplace's external URL plugins (metronome, discover, linear-prism,
pr-review) are separate repos and were not part of this port.

## How the upstream harness maps to pi

| Upstream harness | pi |
|---|---|
| Plugin (`workflows-*`) | This project-local extension + resources under `.pi/` |
| `/recipe-*` skill commands | Prompt templates `.pi/prompts/recipe-*.md` (native expansion, `$ARGUMENTS`) |
| `agents/*.md` subagents | pi-subagents definitions `.pi/agents/*.md` (fresh context, own system prompt, no nested delegation) |
| `skills/` (SKILL.md) | pi skills `.pi/skills/` — same Agent Skills standard, loaded verbatim |
| Agent tool (`subagent_type: "plugin:name"`) | `subagent` tool (`agent: "name"`) |
| `TaskCreate` / `TaskUpdate` | `todo_list` |
| `AskUserQuestion` | `ask_question` |
| `Read/Write/Edit/MultiEdit/Bash/Grep/Glob/LS` | `read/write/edit/bash/grep/find/ls` (pi `edit` covers MultiEdit) |
| `WebSearch` / `WebFetch` | `agent_browser_web_search` / `agent_browser` |
| task-executor's recommendation result field | renamed to `executor_recommendation` |

Skill bodies, agent prompts, flow logic, stopping points, and review gates are upstream text with
only the identifier translations above — the workflow behavior is the real thing, not a rewrite.

## Layout

```
.pi/
  extensions/pi-workflows/index.ts   # /workflows status command
  prompts/recipe-*.md                # 17 recipe slash commands (generated)
  skills/<name>/                     # 31 skills, translated (generated)
  agents/<name>.md                   # 25 pi-subagents agent definitions (generated)
reference/workflows/                 # pinned upstream source (MIT)
scripts/build.mjs                    # codemod: reference/ → .pi/{skills,agents,prompts}
```

## Regenerating after an upstream update

```bash
# refresh the vendored copy under reference/workflows (re-clone from the upstream repo), then:
node scripts/build.mjs        # regenerate
node scripts/build.mjs --check            # validate without regenerating
```

The build fails loudly on unmapped tools, unresolved agent/skill references, count mismatches,
or any upstream-only identifier surviving translation.

## License

Upstream content: MIT, © Shinsuke Kagawa (see `reference/workflows/LICENSE`).
The porting script and extension in this repo are MIT as well.
