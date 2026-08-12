import assert from "node:assert/strict";
import { test } from "node:test";
import {
	assertScriptSafe,
	coerceResult,
	firstUnfinished,
	mapPool,
	parseMeta,
	runWorkflow,
} from "../.pi/extensions/pi-workflows/runtime.ts";

const SCRIPT = `
export const meta = {
  name: 'audit-routes',
  description: 'Audit route handlers',
}

const found = await agent('list', { schema: { type: 'object' } })
const audits = await pipeline(found.files, (file) => agent('audit ' + file, { label: file }))
return audits.filter(Boolean)
`;

test("parseMeta reads name and description", () => {
	const meta = parseMeta(SCRIPT);
	assert.equal(meta.name, "audit-routes");
	assert.equal(meta.description, "Audit route handlers");
});

test("assertScriptSafe rejects import and process", () => {
	assert.throws(() => assertScriptSafe("export const meta = { name: 'x', description: 'd' }\nimport('fs')"));
	assert.throws(() => assertScriptSafe("export const meta = { name: 'x', description: 'd' }\nprocess.exit(1)"));
});

test("runWorkflow calls agent and pipeline", async () => {
	const prompts = [];
	const result = await runWorkflow(SCRIPT, {
		args: { root: "src" },
		async agent(prompt) {
			prompts.push(prompt);
			if (prompt === "list") return { files: ["a.ts", "b.ts"] };
			return { file: prompt.replace("audit ", "") };
		},
	});
	assert.equal(result.ok, true);
	assert.deepEqual(result.value, [{ file: "a.ts" }, { file: "b.ts" }]);
	assert.deepEqual(prompts, ["list", "audit a.ts", "audit b.ts"]);
});

test("runWorkflow returns null from a failed agent", async () => {
	const result = await runWorkflow(
		`export const meta = { name: 'x', description: 'd' }\nreturn await agent('boom')`,
		{
			async agent() {
				throw new Error("nope");
			},
		},
	);
	assert.equal(result.ok, true);
	assert.equal(result.value, null);
});

test("resume replays cached agents then continues", async () => {
	const prompts = [];
	const result = await runWorkflow(
		`export const meta = { name: 'x', description: 'd' }
const a = await agent('one')
const b = await agent('two')
return [a, b]`,
		{
			replayThrough: 0,
			cache: ["cached-one"],
			async agent(prompt) {
				prompts.push(prompt);
				return prompt;
			},
		},
	);
	assert.equal(JSON.stringify(result.value), JSON.stringify(["cached-one", "two"]));
	assert.deepEqual(prompts, ["two"]);
});

test("firstUnfinished is the first started id without a result", () => {
	assert.equal(firstUnfinished([0, 1, 2], new Set([0])), 1);
	assert.equal(firstUnfinished([0, 1], new Set([0, 1])), undefined);
});

test("mapPool preserves order", async () => {
	const out = await mapPool([3, 2, 1], async (n) => {
		await new Promise((r) => setTimeout(r, n));
		return n * 10;
	}, 2);
	assert.deepEqual(out, [30, 20, 10]);
});

test("coerceResult parses JSON or keeps text", () => {
	assert.deepEqual(coerceResult('```json\n{"a":1}\n```'), { a: 1 });
	assert.equal(coerceResult("hello"), "hello");
	assert.throws(() => coerceResult("hello", { type: "object" }));
});

test("aborted agent is unfinished so resume reruns it", async () => {
	const controller = new AbortController();
	const result = await runWorkflow(
		`export const meta = { name: 'x', description: 'd' }\nreturn await agent('one')`,
		{
			signal: controller.signal,
			async agent() {
				controller.abort();
				return "should-not-cache";
			},
		},
	);
	assert.equal(result.finished.size, 0);
	assert.deepEqual(result.started, [0]);
});
