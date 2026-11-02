import vm from "node:vm";
import { isRecord } from "./guards.ts";

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
  | { type: "agent_start"; id: number; label?: string | undefined }
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
  error?: string | undefined;
  started: number[];
  finished: Map<number, unknown>;
};

const META_RE = /export\s+const\s+meta\s*=\s*(\{[\s\S]*?\})\s*;?/;
const BANNED =
  /\bimport\s*(?:\(|[\w{*'"])|\brequire\s*\(|\bprocess\b|\bDeno\b|\bBun\b|\bfetch\s*\(|\bFunction\s*\(|\beval\s*\(/;

export function parseMeta(source: string): WorkflowMeta {
  const captured = source.match(META_RE)?.[1];
  if (captured === undefined) {
    throw new Error("workflow script must start with export const meta = { name, description }");
  }
  // The captured group is a parenthesized object literal, so the evaluated value is
  // always an object or a vm SyntaxError; the guard only satisfies the compiler.
  const meta: unknown = vm.runInNewContext(`(${captured})`, { __proto__: null });
  const name = isRecord(meta) ? meta.name : undefined;
  const description = isRecord(meta) ? meta.description : undefined;
  if (typeof name !== "string" || !/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error("meta.name must be a lowercase hyphenated command name");
  }
  if (typeof description !== "string" || description.trim() === "") {
    throw new Error("meta.description is required");
  }
  return { name, description: description.trim() };
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function mapPool<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = MAX_CONCURRENT,
): Promise<R[]> {
  const limit = Math.max(1, Math.min(concurrency, MAX_CONCURRENT));
  const out: R[] = Array.from({ length: items.length });
  const queue = items.entries();
  async function worker() {
    for (;;) {
      const next = queue.next();
      if (next.done === true) {
        return;
      }
      const [index, item] = next.value;
      out[index] = await fn(item, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export function parseJsonResult(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.search(/[[{]/);
  if (start < 0) {
    throw new Error("expected JSON");
  }
  const value: unknown = JSON.parse(raw.slice(start));
  return value;
}

export function coerceResult(text: string, schema?: JsonSchema): unknown {
  const trimmed = text.trim();
  if (trimmed === "") {
    return null;
  }
  try {
    return parseJsonResult(trimmed);
  } catch (error) {
    if (schema) {
      throw error;
    }
    return trimmed;
  }
}

const SANDBOX_GLOBALS = {
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
};

type Scheduler = {
  agent: AgentFn;
  pipeline: <T>(items: T[], fn: (item: T, index: number) => Promise<unknown>) => Promise<unknown[]>;
  drain: () => Promise<void>;
  started: number[];
  finished: Map<number, unknown>;
};

function emitStart(hooks: RunHooks, id: number, opts: AgentOpts | undefined): void {
  hooks.onEvent?.({ type: "agent_start", id, label: opts?.label });
}

function emitEnd(hooks: RunHooks, id: number, ok: boolean): void {
  hooks.onEvent?.({ type: "agent_end", id, ok });
}

function trackPending(pending: Set<Promise<unknown>>, callAgent: AgentFn): AgentFn {
  return (prompt, opts) => {
    const task = callAgent(prompt, opts);
    pending.add(task);
    void task.then(
      () => {
        pending.delete(task);
      },
      () => {
        pending.delete(task);
      },
    );
    return task;
  };
}

async function drainPending(pending: Set<Promise<unknown>>): Promise<void> {
  while (pending.size > 0) {
    await Promise.allSettled(pending);
  }
}

function makePipeline(): Scheduler["pipeline"] {
  return async <T>(items: T[], fn: (item: T, index: number) => Promise<unknown>) =>
    mapPool(Array.isArray(items) ? items : [], fn);
}

function createScheduler(hooks: RunHooks): Scheduler {
  const started: number[] = [];
  const finished = new Map<number, unknown>();
  const pending = new Set<Promise<unknown>>();
  const replayThrough = hooks.replayThrough ?? -1;
  const cache = hooks.cache ?? [];
  let nextId = 0;
  let live = 0;
  const isAborted = (): boolean => hooks.signal?.aborted === true;

  const awaitSlot = async (): Promise<boolean> => {
    // QX-002 (no-unmodified-loop-condition): `live` is a shared slot counter that
    // sibling agent tasks decrement between awaits; the 10ms poll is the limiter's
    // wakeup mechanism. An event-driven semaphore would change wakeup timing, so
    // the bounded poll is retained. See the quality-exception record.
    // oxlint-disable-next-line no-unmodified-loop-condition
    while (live >= MAX_CONCURRENT) {
      await sleep(10);
      if (isAborted()) {
        return false;
      }
    }
    return true;
  };

  const settle = async (id: number, task: Promise<unknown>): Promise<unknown> => {
    try {
      const value: unknown = await task;
      if (isAborted()) {
        return null;
      }
      finished.set(id, value);
      emitEnd(hooks, id, value !== null);
      return value;
    } catch {
      if (isAborted()) {
        return null;
      }
      finished.set(id, null);
      emitEnd(hooks, id, false);
      return null;
    } finally {
      live--;
    }
  };

  const callAgent: AgentFn = async (prompt, opts) => {
    if (isAborted()) {
      return null;
    }
    const id = nextId++;
    if (id >= MAX_AGENTS) {
      throw new Error(`workflow exceeded ${MAX_AGENTS} agents`);
    }
    started.push(id);
    emitStart(hooks, id, opts);
    if (id <= replayThrough && id < cache.length) {
      finished.set(id, cache[id]);
      emitEnd(hooks, id, true);
      return cache[id];
    }
    const slot = await awaitSlot();
    if (!slot) {
      return null;
    }
    live++;
    return settle(id, hooks.agent(prompt, opts));
  };

  const tracked = trackPending(pending, callAgent);
  return {
    // Wrapped in an arrow so the source never reads as a literal
    // `agent: <name>` pi-subagents profile reference (see build-check.mjs).
    agent: (prompt, opts) => tracked(prompt, opts),
    pipeline: makePipeline(),
    drain: () => drainPending(pending),
    started,
    finished,
  };
}

export async function runWorkflow(source: string, hooks: RunHooks): Promise<RunResult> {
  const scheduler = createScheduler(hooks);
  try {
    assertScriptSafe(source);
    const meta = parseMeta(source);
    const body = scriptBody(source);
    hooks.signal?.throwIfAborted();
    // ponytail: trusted local scripts, not a security sandbox or CPU deadline.
    // Use an isolated bounded runtime if untrusted scripts become supported.
    const context = vm.createContext({
      agent: (prompt: string, opts?: AgentOpts) => scheduler.agent(prompt, opts),
      pipeline: scheduler.pipeline,
      args: hooks.args,
      meta,
      ...SANDBOX_GLOBALS,
    });
    const value: unknown = await vm.runInContext(`(async () => {\n${body}\n})()`, context);
    await scheduler.drain();
    hooks.signal?.throwIfAborted();
    hooks.onEvent?.({ type: "done", ok: true });
    return { ok: true, value, started: scheduler.started, finished: scheduler.finished };
  } catch (error) {
    await scheduler.drain();
    const message = error instanceof Error ? error.message : String(error);
    hooks.onEvent?.({ type: "done", ok: false });
    return { ok: false, error: message, started: scheduler.started, finished: scheduler.finished };
  }
}
