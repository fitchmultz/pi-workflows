import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	firstUnfinished,
	parseMeta,
	runWorkflow,
	type RunResult,
} from "./runtime.ts";
import { spawnWorker } from "./spawn.ts";
import {
	decorateInput,
	loadSize,
	parseSize,
	saveSize,
	SIZE_HINT,
	SIZES,
} from "./polish.ts";
import { approvalCard, KeywordEditor } from "./ui.ts";

const here = dirname(fileURLToPath(import.meta.url));
const piDir = join(here, "..", "..");
const skillsDir = join(piDir, "skills");
const agentsDir = join(piDir, "agents");
const promptsDir = join(piDir, "prompts");

const DEEP_RESEARCH = `export const meta = {
  name: 'deep-research',
  description: 'Fan out research angles, cross-check sources, and return a cited report',
}

const question = typeof args === 'string' ? args : args && args.question
if (!question) return 'Need a research question.'

const plan = await agent(
  'Propose 4 distinct research angles for: ' + JSON.stringify(question) + '. Return JSON.',
  { schema: { type: 'object', required: ['angles'], properties: { angles: { type: 'array', items: { type: 'string' } } } } }
)
if (!plan || !Array.isArray(plan.angles)) return null

const findings = await pipeline(plan.angles, (angle) =>
  agent(
    'Research this angle for ' + JSON.stringify(question) + ': ' + angle + '. Use public docs and the repository. Return JSON {angle, sources:[{title,url,claim}], claims:string[]}.',
    { label: angle, schema: { type: 'object', required: ['angle', 'sources', 'claims'], properties: { angle: { type: 'string' }, sources: { type: 'array' }, claims: { type: 'array', items: { type: 'string' } } } } }
  )
)

return await agent(
  'Cross-check these findings and write a cited report for ' + JSON.stringify(question) + '. Drop claims that do not survive. Mark unverifiable claims as unverified.\\n' + JSON.stringify(findings.filter(Boolean)),
  { label: 'synthesize' }
)
`;

type RunStatus = "running" | "paused" | "done" | "failed";

type Run = {
	id: string;
	name: string;
	description: string;
	script: string;
	args?: unknown;
	status: RunStatus;
	error?: string;
	value?: unknown;
	started: number[];
	cache: unknown[];
	replayThrough: number;
	controller: AbortController;
	task?: Promise<void>;
};

const runs = new Map<string, Run>();
let seq = 0;

function listDirNames(dir: string, kind: "dir" | "file"): string[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((e) => (kind === "dir" ? e.isDirectory() : e.isFile() && e.name.endsWith(".md")))
		.map((e) => (kind === "dir" ? e.name : e.name.replace(/\.md$/, "")))
		.sort();
}

function walkWorkflowDirs(cwd: string): string[] {
	const dirs: string[] = [];
	let dir = cwd;
	for (;;) {
		const candidate = join(dir, ".pi", "workflows");
		if (existsSync(candidate)) dirs.push(candidate);
		const parent = dirname(dir);
		if (parent === dir) break;
		if (existsSync(join(dir, ".git"))) break;
		dir = parent;
	}
	return dirs;
}

function discoverSaved(cwd: string): Map<string, { meta: WorkflowMeta; source: string; path: string }> {
	const found = new Map<string, { meta: WorkflowMeta; source: string; path: string }>();
	for (const dir of walkWorkflowDirs(cwd).reverse()) {
		for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
			const path = join(dir, file);
			const source = readFileSync(path, "utf8");
			try {
				const meta = parseMeta(source);
				found.set(meta.name, { meta, source, path });
			} catch {
				// skip invalid scripts
			}
		}
	}
	return found;
}

function newId(): string {
	seq += 1;
	return `wf-${Date.now().toString(36)}-${seq}`;
}

function cacheFrom(result: RunResult): { cache: unknown[]; replayThrough: number } {
	const finished = new Set(result.finished.keys());
	const cut = firstUnfinished(result.started, finished);
	const replayThrough = cut === undefined ? result.started.length - 1 : cut - 1;
	const cache: unknown[] = [];
	for (const id of result.started) {
		if (id > replayThrough) break;
		cache[id] = result.finished.get(id);
	}
	return { cache, replayThrough };
}

function startRun(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	script: string,
	args: unknown,
	resume?: Run,
): Run {
	const meta = parseMeta(script);
	const run: Run = resume ?? {
		id: newId(),
		name: meta.name,
		description: meta.description,
		script,
		args,
		status: "running",
		started: [],
		cache: [],
		replayThrough: -1,
		controller: new AbortController(),
	};
	if (resume) {
		run.status = "running";
		run.controller = new AbortController();
		run.error = undefined;
	}
	runs.set(run.id, run);
	let startedCount = 0;
	const paint = () => {
		const done = run.cache.filter((_, i) => i <= run.replayThrough).length;
		const large = startedCount > 25 ? " large" : "";
		const line = `${run.name} ${run.status} ${done} cached, ${startedCount} started${large}`;
		ctx.ui.setStatus("workflows", line);
		if (ctx.mode === "tui") ctx.ui.setWidget("workflows", [line]);
	};
	run.task = (async () => {
		const result = await runWorkflow(script, {
			args,
			signal: run.controller.signal,
			replayThrough: run.replayThrough,
			cache: run.cache,
			agent: (prompt, opts) => spawnWorker(prompt, { ...opts, cwd: ctx.cwd, signal: run.controller.signal }),
			onEvent: (event) => {
				if (event.type === "agent_start") startedCount += 1;
				paint();
			},
		});
		const snap = cacheFrom(result);
		run.cache = snap.cache;
		run.replayThrough = snap.replayThrough;
		run.started = result.started;
		if (run.controller.signal.aborted && !result.ok) {
			run.status = "paused";
		} else if (result.ok) {
			run.status = "done";
			run.value = result.value;
			pi.sendMessage({
				customType: "workflow-report",
				content: [{ type: "text", text: formatReport(run) }],
				display: true,
				details: { name: run.name, id: run.id },
			});
		} else {
			run.status = "failed";
			run.error = result.error;
		}
		paint();
		if (run.status === "done" || run.status === "failed") {
			ctx.ui.setWidget("workflows", undefined);
			ctx.ui.setStatus("workflows", undefined);
		}
	})();
	paint();
	return run;
}

function formatReport(run: Run): string {
	if (run.status === "failed") return `Workflow ${run.name} failed: ${run.error ?? "unknown error"}`;
	const body = typeof run.value === "string" ? run.value : JSON.stringify(run.value, null, 2);
	return `Workflow ${run.name} finished.\n\n${body ?? ""}`;
}

function repoRoot(cwd: string): string {
	let dir = cwd;
	let root = cwd;
	for (;;) {
		if (existsSync(join(dir, ".git"))) return dir;
		const parent = dirname(dir);
		if (parent === dir) return root;
		dir = parent;
	}
}

function saveScript(cwd: string, script: string): string {
	const meta = parseMeta(script);
	const dir = walkWorkflowDirs(cwd)[0] ?? join(repoRoot(cwd), ".pi", "workflows");
	mkdirSync(dir, { recursive: true });
	const path = join(dir, `${meta.name}.js`);
	writeFileSync(path, script.endsWith("\n") ? script : `${script}\n`);
	return path;
}

export default function (pi: ExtensionAPI) {
	pi.registerFlag("workflow-size", {
		description: "Workflow size guideline: small, medium, large, unrestricted",
		type: "string",
	});

	const flagSize = () => {
		const value = pi.getFlag("workflow-size");
		return typeof value === "string" ? value : undefined;
	};
	const sizeFor = (cwd: string) => loadSize(repoRoot(cwd), flagSize());

	const askToRun = async (ctx: ExtensionContext, script: string) => {
		const meta = parseMeta(script);
		return approvalCard(ctx, {
			name: meta.name,
			description: meta.description,
			script,
			size: sizeFor(ctx.cwd),
			root: repoRoot(ctx.cwd),
		});
	};

	pi.registerCommand("workflows", {
		description: "List recipes, saved scripts, and manage runs",
		handler: async (args, ctx) => {
			const skills = existsSync(skillsDir)
				? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, "SKILL.md")))
				: [];
			const agents = listDirNames(agentsDir, "file");
			const recipes = listDirNames(promptsDir, "file");
			const tools = new Set(pi.getAllTools().map((t) => t.name));
			const required = ["subagent", "todo_list", "ask_question", "agent_browser_web_search"];
			const missing = required.filter((t) => !tools.has(t));
			const saved = [...discoverSaved(ctx.cwd).values()].map((s) => s.meta.name);
			const size = sizeFor(ctx.cwd);
			const runLines = [...runs.values()].map((r) => `${r.status} ${r.name} (${r.id})`);
			const header = [
				`Recipes (${recipes.length}): ${recipes.map((r) => `/${r}`).join(", ") || "none"}`,
				`Skills (${skills.length}): ${skills.join(", ") || "none"}`,
				`Agents (${agents.length}): ${agents.join(", ") || "none"}`,
				`Saved scripts: ${saved.map((n) => `/${n}`).join(", ") || "none"}`,
				`Size: ${size} (${SIZE_HINT[size]}) — /workflow-size to change`,
				missing.length
					? `Missing recipe tools: ${missing.join(", ")}`
					: `Recipe tools present: ${required.join(", ")}`,
				runLines.length ? `Runs:\n${runLines.join("\n")}` : "Runs: none",
			].join("\n");

			const want = args.trim();
			if (!ctx.hasUI) {
				console.log(header);
				return;
			}
			if (want === "status" || (!want && runs.size === 0)) {
				ctx.ui.notify(header, "info");
				return;
			}

			const labels = [...runs.values()].map((r) => `${r.status} ${r.name} (${r.id})`);
			const picked = await ctx.ui.select("Workflow runs", labels.length ? labels : ["(none)"]);
			if (!picked || picked === "(none)") return;
			const id = picked.slice(picked.lastIndexOf("(") + 1, -1);
			const run = runs.get(id);
			if (!run) return;
			const action = await ctx.ui.select(run.name, ["View", "Pause", "Resume", "Stop", "Save"]);
			if (action === "View") ctx.ui.notify(formatReport(run), "info");
			if (action === "Pause" || action === "Stop") run.controller.abort();
			if (action === "Resume" && run.status === "paused") startRun(pi, ctx, run.script, run.args, run);
			if (action === "Save") ctx.ui.notify(`Saved ${saveScript(ctx.cwd, run.script)}`, "info");
		},
	});

	pi.registerCommand("workflow-size", {
		description: "Show or set the workflow size guideline",
		getArgumentCompletions: (prefix) => {
			const items = SIZES.filter((s) => s.startsWith(prefix)).map((s) => ({
				value: s,
				label: s,
				description: SIZE_HINT[s],
			}));
			return items.length ? items : null;
		},
		handler: async (args, ctx) => {
			const next = parseSize(args);
			if (!next) {
				const size = sizeFor(ctx.cwd);
				const text = `Size: ${size} (${SIZE_HINT[size]}). Pass small, medium, large, or unrestricted.`;
				if (ctx.hasUI) ctx.ui.notify(text, "info");
				else console.log(text);
				return;
			}
			const path = saveSize(repoRoot(ctx.cwd), next);
			const text = `Size set to ${next} (${SIZE_HINT[next]}) in ${path}`;
			if (ctx.hasUI) ctx.ui.notify(text, "info");
			else console.log(text);
		},
	});

	const launch = (script: string) => async (args: string, ctx: ExtensionCommandContext) => {
		const decision = await askToRun(ctx, script);
		if (!decision.ok) return;
		const run = startRun(pi, ctx, decision.script, args);
		ctx.ui.notify(`Started ${run.name} (${run.id})`, "info");
	};

	pi.registerCommand("deep-research", {
		description: "Research a question across several angles and return a cited report",
		handler: launch(DEEP_RESEARCH),
	});

	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode === "tui") {
			ctx.ui.setEditorComponent((tui, theme, kb) => new KeywordEditor(tui, theme, kb));
		}
		for (const saved of discoverSaved(ctx.cwd).values()) {
			if (saved.meta.name === "deep-research" || saved.meta.name === "workflows") continue;
			pi.registerCommand(saved.meta.name, {
				description: saved.meta.description,
				handler: launch(saved.source),
			});
		}
	});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "interactive") return { action: "continue" as const };
		return { action: "transform" as const, text: decorateInput(event.text, sizeFor(ctx.cwd)) };
	});

	pi.on("session_shutdown", async () => {
		for (const run of runs.values()) {
			if (run.status === "running") run.controller.abort();
		}
	});

	pi.registerTool({
		name: "workflow",
		label: "Workflow",
		description:
			"Run a JavaScript workflow that orchestrates many worker agents via agent() and pipeline(). Use when the user asks to run a workflow, types use a workflow / run a workflow / ultracode, or the task needs more agents than one conversation can coordinate. Honor /workflow-size. Script is plain JavaScript with top-level await and export const meta = { name, description }. No import, require, fetch, or process. args is a global.",
		parameters: Type.Object({
			script: Type.String({ description: "Full workflow script including export const meta" }),
			args: Type.Optional(Type.Unknown()),
		}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			try {
				const decision = await askToRun(ctx, params.script);
				if (!decision.ok) return { content: [{ type: "text", text: "User declined the workflow." }] };
				const run = startRun(pi, ctx, decision.script, params.args);
				if (signal.aborted) run.controller.abort();
				else signal.addEventListener("abort", () => run.controller.abort(), { once: true });
				return { content: [{ type: "text", text: `Started ${run.name} (${run.id}). Use /workflows to watch.` }] };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return { content: [{ type: "text", text: message }], details: { error: message } };
			}
		},
	});
}
