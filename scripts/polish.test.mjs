import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	allow,
	decorateInput,
	findKeyword,
	isAllowed,
	keywordState,
	loadSize,
	parseSize,
	saveSize,
	sizeAdvice,
	STEER,
} from "../.pi/extensions/pi-workflows/polish.ts";

test("findKeyword matches the trigger phrases", () => {
	assert.equal(findKeyword("please use a workflow to audit routes"), "use a workflow");
	assert.equal(findKeyword("run a workflow on these files"), "run a workflow");
	assert.equal(findKeyword("ultracode: check auth"), "ultracode");
	assert.equal(findKeyword("just implement the button"), undefined);
});

test("parseSize and sizeAdvice", () => {
	assert.equal(parseSize("MEDIUM"), "medium");
	assert.equal(parseSize("nope"), undefined);
	assert.match(sizeAdvice("small"), /5/);
	assert.match(sizeAdvice("unrestricted"), /unrestricted/);
});

test("loadSize defaults to medium and honors the project file", t => {
	const root = mkdtempSync(join(tmpdir(), "wf-size-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(loadSize(root), "medium");
	assert.equal(loadSize(root, "small"), "small");
	saveSize(root, "large");
	assert.equal(loadSize(root), "large");
	assert.equal(readFileSync(join(root, ".pi", "workflow-size"), "utf8").trim(), "large");
});

test("allow list is project-local", t => {
	const root = mkdtempSync(join(tmpdir(), "wf-allow-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	assert.equal(isAllowed(root, "audit-routes"), false);
	allow(root, "audit-routes");
	assert.equal(isAllowed(root, "audit-routes"), true);
});

test("decorateInput only steers keyword prompts", () => {
	keywordState.dismissed = false;
	const plain = decorateInput("fix the typo", "medium");
	assert.equal(plain, "fix the typo");
	const steered = decorateInput("use a workflow to audit src/routes", "small");
	assert.match(steered, /workflow tool/);
	assert.match(steered, /small/);
	assert.equal(decorateInput("/recipe-implement foo", "medium"), "/recipe-implement foo");
	assert.equal(decorateInput(`${STEER} already`, "medium").includes(STEER + "\n" + STEER), false);
	keywordState.dismissed = true;
	assert.equal(decorateInput("use a workflow to audit src/routes", "small"), "use a workflow to audit src/routes");
	keywordState.dismissed = false;
});
