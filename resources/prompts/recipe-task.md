---
description: Execute tasks following appropriate rules with rule-advisor metacognition
argument-hint: "[input]"
---
Execute the llm-friendly-context skill (/skill:llm-friendly-context) before writing subagent prompts, handoffs, or generated artifacts.
Execute the subagents-orchestration-guide skill (/skill:subagents-orchestration-guide) before making workflow decisions, invoking agents, or resolving findings.

# Task Execution with Metacognitive Analysis

Task: $ARGUMENTS

## Mandatory Execution Process

**Step 1: Rule Selection via rule-advisor (REQUIRED)**

Invoke rule-advisor using subagent tool:
- `agent`: "rule-advisor"
- `description`: "Rule selection"
- `prompt`: "Task: $ARGUMENTS. Select appropriate rules and perform metacognitive analysis."

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
