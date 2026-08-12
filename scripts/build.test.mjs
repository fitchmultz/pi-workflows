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
