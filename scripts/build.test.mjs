import assert from "node:assert/strict";
import { test } from "node:test";
import { transformContent } from "./build.mjs";

test("transformContent maps harness identifiers", () => {
	const out = transformContent(
		"Use the Agent tool with subagent_type: \"workflows:task-executor\". AskUserQuestion, TaskCreate, WebSearch, MultiEdit, Glob, Grep, LS, Bash.",
	);
	assert.match(out, /subagent tool/);
	assert.match(out, /agent: "task-executor"|agent": "task-executor"|task-executor/);
	assert.doesNotMatch(out, /subagent_type/);
	assert.doesNotMatch(out, /AskUserQuestion/);
	assert.doesNotMatch(out, /TaskCreate/);
	assert.doesNotMatch(out, /WebSearch/);
	assert.doesNotMatch(out, /MultiEdit/);
});

test("subagent call fields translate without rewriting metadata, nested input or model fields", () => {
	const input = `---
description: Recipe metadata
---
Use the Agent tool:
\`\`\`yaml
subagent_type: workflows:investigator
description: "Investigate problem"
prompt: |
  description: canonical specialist input
  prompt: literal input field
model: selected-model
\`\`\`

- \`subagent_type\`: "workflows:rule-advisor"
- \`description\`: "Rule selection"
- \`prompt\`: "Task: keep prompt: and description: verbatim"

  - \`subagent_type: "workflows-frontend:quality-fixer-frontend"\`
  - \`description: "Quality verification"\`

Invoke the same layer's task-executor:
- \`description\`: "Fix review findings"
- Reuse the canonical inputs.
- \`prompt\`: "Apply fixes"

Invoke a generic model:
- \`description\`: "Business metadata"
- \`prompt\`: "Business input"

Unrelated schema:
\`\`\`yaml
description: business field
prompt: business input
model: another-model
\`\`\`
`;
	const expected = input
		.replace("Agent tool", "subagent tool")
		.replace("subagent_type: workflows:investigator", "agent: investigator")
		.replace('description: "Investigate problem"', 'label: "Investigate problem"')
		.replace("prompt: |", "task: |")
		.replace('`subagent_type`: "workflows:rule-advisor"', '`agent`: "rule-advisor"')
		.replace('`description`: "Rule selection"', '`label`: "Rule selection"')
		.replace('`prompt`: "Task:', '`task`: "Task:')
		.replace('`subagent_type: "workflows-frontend:quality-fixer-frontend"`', '`agent: "quality-fixer-frontend"`')
		.replace('`description: "Quality verification"`', '`label: "Quality verification"`')
		.replace('`description`: "Fix review findings"', '`label`: "Fix review findings"')
		.replace('`prompt`: "Apply fixes"', '`task`: "Apply fixes"');
	assert.equal(transformContent(input), expected);
});
