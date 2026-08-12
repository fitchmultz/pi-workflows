import vm from "node:vm";

export const MAX_CONCURRENT = 16;
export const MAX_AGENTS = 1000;

export type JsonSchema = Record<string, unknown>;

export type AgentOpts = {
	schema?: JsonSchema;
	label?: string;
};

export type AgentFn = (prompt: string, opts?: AgentOpts) => Promise<unknown>;

export type WorkflowMeta = {
	name: string;
	description: string;
};

export type RunEvent =
	| { type: "agent_start"; id: number; label?: string }
	| { type: "agent_end"; id: number; ok: boolean }
	| { type: "done"; ok: boolean };

export type RunHooks = {
	agent: AgentFn;
	args?: unknown;
	signal?: AbortSignal;
	onEvent?: (event: RunEvent) => void;
	replayThrough?: number;
	cache?: unknown[];
};

export type RunResult = {
	ok: boolean;
	value?: unknown;
	error?: string;
	started: number[];
	finished: Map<number, unknown>;
};

const META_RE = /export\s+const\s+meta\s*=\s*(\{[\s\S]*?\})\s*;?/;
const BANNED = /\bimport\s*(?:\(|[\w{*'"])|\brequire\s*\(|\bprocess\b|\bDeno\b|\bBun\b|\bfetch\s*\(|\bFunction\s*\(|\beval\s*\(/;

export function parseMeta(source: string): WorkflowMeta {
	const match = source.match(META_RE);
	if (!match) throw new Error("workflow script must start with export const meta = { name, description }");
	const meta = vm.runInNewContext(`(${match[1]})`, Object.create(null)) as Partial<WorkflowMeta>;
	if (typeof meta.name !== "string" || !/^[a-z][a-z0-9-]*$/.test(meta.name)) {
		throw new Error("meta.name must be a lowercase hyphenated command name");
	}
	if (typeof meta.description !== "string" || !meta.description.trim()) {
		throw new Error("meta.description is required");
	}
	return { name: meta.name, description: meta.description.trim() };
}

export function scriptBody(source: string): string {
	return source.replace(META_RE, "").trim();
}

export function assertScriptSafe(source: string): void {
	if (BANNED.test(source)) {
		throw new Error("workflow script cannot import, require, eval, fetch, or touch process");
	}
}

export function firstUnfinished(started: number[], finished: Set<number>): number | undefined {
	return started.find((id) => !finished.has(id));
}

export async function mapPool<T, R>(
	items: T[],
	fn: (item: T, index: number) => Promise<R>,
	concurrency = MAX_CONCURRENT,
): Promise<R[]> {
	const limit = Math.max(1, Math.min(concurrency, MAX_CONCURRENT));
	const out: R[] = Array.from({ length: items.length });
	let next = 0;
	async function worker() {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			out[i] = await fn(items[i], i);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
	return out;
}

export function parseJsonResult(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const raw = (fenced?.[1] ?? text).trim();
	const start = raw.search(/[\[{]/);
	if (start < 0) throw new Error("expected JSON");
	return JSON.parse(raw.slice(start));
}

export function coerceResult(text: string, schema?: JsonSchema): unknown {
	const trimmed = text.trim();
	if (!trimmed) return null;
	try {
		return parseJsonResult(trimmed);
	} catch (error) {
		if (schema) throw error;
		return trimmed;
	}
}

export async function runWorkflow(source: string, hooks: RunHooks): Promise<RunResult> {
	assertScriptSafe(source);
	const meta = parseMeta(source);
	const body = scriptBody(source);
	const started: number[] = [];
	const finished = new Map<number, unknown>();
	let nextId = 0;
	let live = 0;
	const replayThrough = hooks.replayThrough ?? -1;
	const cache = hooks.cache ?? [];

	const agent: AgentFn = async (prompt, opts) => {
		if (hooks.signal?.aborted) return null;
		const id = nextId++;
		if (id >= MAX_AGENTS) throw new Error(`workflow exceeded ${MAX_AGENTS} agents`);
		started.push(id);
		hooks.onEvent?.({ type: "agent_start", id, label: opts?.label });
		if (id <= replayThrough && id < cache.length) {
			finished.set(id, cache[id]);
			hooks.onEvent?.({ type: "agent_end", id, ok: true });
			return cache[id];
		}
		while (live >= MAX_CONCURRENT) {
			await new Promise((r) => setTimeout(r, 10));
			if (hooks.signal?.aborted) return null;
		}
		live++;
		try {
			const value = await hooks.agent(prompt, opts);
			if (hooks.signal?.aborted) return null;
			finished.set(id, value);
			hooks.onEvent?.({ type: "agent_end", id, ok: value !== null });
			return value;
		} catch {
			if (hooks.signal?.aborted) return null;
			finished.set(id, null);
			hooks.onEvent?.({ type: "agent_end", id, ok: false });
			return null;
		} finally {
			live--;
		}
	};

	const pipeline = async <T>(items: T[], fn: (item: T, index: number) => Promise<unknown>) =>
		mapPool(Array.isArray(items) ? items : [], fn);

	try {
		const context = vm.createContext({
			agent,
			pipeline,
			args: hooks.args,
			meta,
			JSON,
			Math,
			Date,
			Array,
			Object,
			Map,
			Set,
			Promise,
			Number,
			String,
			Boolean,
			RegExp,
			Error,
			TypeError,
			RangeError,
			parseInt,
			parseFloat,
			isNaN,
			isFinite,
			undefined,
			Infinity,
			NaN,
			Intl,
			URL,
			URLSearchParams,
		});
		const value = await vm.runInContext(`(async () => {\n${body}\n})()`, context);
		hooks.onEvent?.({ type: "done", ok: true });
		return { ok: true, value, started, finished };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		hooks.onEvent?.({ type: "done", ok: false });
		return { ok: false, error: message, started, finished };
	}
}
