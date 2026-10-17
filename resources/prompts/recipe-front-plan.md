---
description: Create frontend work plan from design document and obtain plan approval
argument-hint: "[input]"
---
## Pi recipe prerequisites

This optional recipe requires a compatible multi-agent executor and extension tools; native Pi does not supply them. All four tools in step 1 are hard runtime prerequisites for every recipe, including recipes without external research. Before any recipe phase or artifact production:

1. Inspect available tools and any advertised discovery catalog. Require `subagent` with `agent`, `task`, `label` and parallel `tasks` support, `todo_list`, `ask_question` and `agent_browser_web_search`. If advanced `subagent` is inactive, call `load_subagent({advanced:true})` only when that loader is available, then inspect its instructions before delegation. Pi Subagents 0.44.4+, pi-todo-list, pi-ask-question and pi-agent-browser-native provide these integrations; they are not dependencies of the standalone scripted runtime.
2. Use `subagent({action:"list"})` to verify the named specialists required by this recipe resolve from its bundled profiles or intentional user/project overrides. Serialize each specialist's canonical input fields inside the `task` string; they are not top-level tool parameters. Use `label` for the short call description. If the executor, loader, profile or required tool is missing, excluded or incompatible, stop and report the exact prerequisite and phase. Do not imitate specialists inline, silently serialize parallel reviews, skip required steps or assume a loader is installed.
3. Preserve every approval stop with an explicit user answer. If `ask_question` has no working TUI/RPC dialog, stop at that gate rather than assuming approval. Before required external research, verify the search provider is configured; when a public URL requires `agent_browser`, discover that tool too. A failed or unavailable provider blocks dependent research: report the verification limitation, never claim completed research. Pass this capability boundary to specialists that require those tools.

The `workflow` tool and scripted `agent()/pipeline()` remain independently usable with native Pi tools and do not require these recipe integrations.

Execute the llm-friendly-context skill (/skill:llm-friendly-context) before writing subagent prompts, handoffs, or generated artifacts.
Execute the subagents-orchestration-guide skill (/skill:subagents-orchestration-guide) before making workflow decisions, invoking agents, or resolving findings.

**Context**: Dedicated to the frontend planning phase.

## Orchestrator Definition

**Core Identity**: "I am an orchestrator." (see subagents-orchestration-guide skill)

**Local authority gate**: Make this recipe's workflow decisions and validate each returned result directly; delegate semantic deliverable production to the named specialist.

**Review Resolution Gate [MANDATORY]**: Resolve every actionable deliverable-review finding through subagents-orchestration-guide `Review Resolution` before correction or progression.
Before the first finding disposition, read `references/review-resolution.md` from the loaded subagents-orchestration-guide skill.

**Execution Protocol**:
1. **Invoke named specialists for deliverable production** — pass data between them and validate their results
2. **Follow subagents-orchestration-guide skill planning flow**:
   - Execute steps defined below
   - **Stop and obtain approval** for plan content before completion
3. **Scope**: See Scope Boundaries below

At each subagent invocation below, build the prompt as a mechanical extraction: copy the named source values into the exact fields, apply only the declared serialization, then invoke immediately.

Acceptance-test-generator is part of this planning flow and may return no selected lanes when the Design Doc has no justified integration/E2E proof boundary.

## Scope Boundaries

**Included in this skill**:
- Design document selection
- Test skeleton generation with acceptance-test-generator
- Work plan creation with work-planner
- Work plan review with document-reviewer
- Plan approval obtainment

**Responsibility Boundary**: This skill completes with work plan approval.

Follow the planning process below:

## Execution Process

### Step 1: Design Document Selection
   - Use the Design Doc explicitly supplied in `$ARGUMENTS` when present
   - Otherwise use the only Design Doc under `docs/design/` when exactly one exists
   - Resolve the UI Spec only from the selected Design Doc's `Referenced UI Spec` path
   - Report when no Design Doc exists; when multiple Design Docs exist, present them for selection

### Step 2: Test Skeleton Generation
   - Invoke acceptance-test-generator across all applicable lanes using subagent tool:
     - `agent`: "acceptance-test-generator"
     - `label`: "Test skeleton generation"
     - `design_docs: [Design Doc path]`
     - `ui_spec: [UI Spec path]` when one exists
     - `confirmed_requirement_context`: approved PRD path named by the Design Doc, or its unchanged Requirement Convergence record when no PRD exists
     - Follow subagents-orchestration-guide HC-06 for `value_input_required` and its unknown-value continuation
   - Pass every non-null generated skeleton path to work-planner; treat an evidence-backed empty lane as complete for that lane and continue to work-planner

### Step 3: Work Plan Creation
Invoke work-planner using subagent tool:
- `agent`: "work-planner"
- `label`: "Work plan creation"
- `mode: create`
- `designDoc: [selected Design Doc path]`
- `uiSpec: [UI Spec path]` when one exists
- `prd: [approved PRD path]` when one exists
- `testSkeletons: [non-null generatedFiles paths]`

### Step 4: Work Plan Review
Invoke document-reviewer to review the work plan:
- `agent`: "document-reviewer"
- `label`: "Work plan review"
- `task`: "doc_type: WorkPlan target: docs/plans/[plan-name].md. Review the Work Plan's own Implementation Scope, tasks, Completion Criteria, dependencies, execution order, exact source-anchor existence, executable verification, and Review Scope. Governing Documents paths are citation sources only; keep issues limited to violations of cited obligations."
- Run the Review Resolution Gate through its correction re-review, escalation, and convergence transitions, using work-planner in update mode for rerouted corrections. Present the plan for approval only at its convergence condition.

### Step 5: Present for Approval
- Present the reviewed work plan to the user for batch approval. If the user requests changes, re-invoke work-planner with the user's requested changes verbatim and re-run Step 4.
- Highlight steps with unclear scope or external dependencies and ask the user to confirm

## Response at Completion
**Recommended**: End with the following standard response after plan content approval
```
Frontend planning phase completed.
- Work plan: docs/plans/[plan-name].md
- Status: Approved

Please provide separate instructions for implementation.
```

When findings were declined during Work Plan review, append their IDs, governing reasons, and evidence to this completion response.
