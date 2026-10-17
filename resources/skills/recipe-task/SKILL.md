---
name: recipe-task
description: Execute tasks following appropriate rules with rule-advisor metacognition
disable-model-invocation: true
---

## Pi recipe prerequisites

This optional recipe requires a compatible multi-agent executor and extension tools; native Pi does not supply them. All four tools in step 1 are hard runtime prerequisites for every recipe, including recipes without external research. Before any recipe phase or artifact production:

1. Inspect available tools and any advertised discovery catalog. Require `subagent` with `agent`, `task`, `label` and parallel `tasks` support, `todo_list`, `ask_question` and `agent_browser_web_search`. If advanced `subagent` is inactive, call `load_subagent({advanced:true})` only when that loader is available, then inspect its instructions before delegation. Pi Subagents 0.44.4+, pi-todo-list, pi-ask-question and pi-agent-browser-native provide these integrations; they are not dependencies of the standalone scripted runtime.
2. Use `subagent({action:"list"})` to verify the named specialists required by this recipe resolve from its bundled profiles or intentional user/project overrides. Serialize each specialist's canonical input fields inside the `task` string; they are not top-level tool parameters. Use `label` for the short call description. If the executor, loader, profile or required tool is missing, excluded or incompatible, stop and report the exact prerequisite and phase. Do not imitate specialists inline, silently serialize parallel reviews, skip required steps or assume a loader is installed.
3. Preserve every approval stop with an explicit user answer. If `ask_question` has no working TUI/RPC dialog, stop at that gate rather than assuming approval. Before required external research, verify the search provider is configured; when a public URL requires `agent_browser`, discover that tool too. A failed or unavailable provider blocks dependent research: report the verification limitation, never claim completed research. Pass this capability boundary to specialists that require those tools.

The `workflow` tool and scripted `agent()/pipeline()` remain independently usable with native Pi tools and do not require these recipe integrations.

Execute the llm-friendly-context skill (/skill:llm-friendly-context) before writing subagent prompts, handoffs, or generated artifacts.
Execute the subagents-orchestration-guide skill (/skill:subagents-orchestration-guide) before making workflow decisions, invoking agents, or resolving findings.

# Task Execution with Metacognitive Analysis

Task: the skill invocation arguments

## Mandatory Execution Process

**Step 1: Rule Selection via rule-advisor (REQUIRED)**

Invoke rule-advisor using subagent tool:
- `agent`: "rule-advisor"
- `label`: "Rule selection"
- `task`: "Task: the skill invocation arguments. Select appropriate rules and perform metacognitive analysis."

**Step 2: Utilize rule-advisor Output**

After receiving rule-advisor's JSON response, proceed with:

1. **Understand Task Essence** (from `taskAnalysis.essence`)
   - Focus on fundamental purpose, not surface-level work
   - Distinguish between "quick fix" vs "proper solution"

2. **Follow Selected Rules** (from `selectedRules`)
   - Execute each selected skill by its `skill` name and read it completely
   - Apply the named sections in the context of the complete skill

3. **Recognize Past Failures** (from `metaCognitiveGuidance.pastFailures`)
   - Apply countermeasures for known failure patterns
   - Use suggested alternative approaches

4. **Execute First Action** (from `metaCognitiveGuidance.firstStep`)
   - Start with recommended action
   - Use suggested tools first

**Step 3: Create Task List with todo_list**

Register work steps using todo_list. Use "Select and map applicable rules" as the first task and "Verify selected rules and report completion" as the final task.

Break down the task based on rule-advisor's guidance:
- Reflect `taskAnalysis.essence` in task descriptions
- Apply `metaCognitiveGuidance.firstStep` to first task
- Restructure tasks considering `warningPatterns`
- Set priorities based on dependency order and warningPatterns severity
- Update each task with todo_list as execution progresses

**Step 4: Execute Implementation**

Proceed with task execution following:
- Start with `metaCognitiveGuidance.firstStep` action from rule-advisor
- Update task structure with todo_list to reflect rule-advisor insights
- Selected rules from rule-advisor
- Task structure (managed via todo_list)
- Quality standards from the selected skills and sections named by rule-advisor
- Monitor warningPatterns flags throughout execution and adjust approach when triggered
