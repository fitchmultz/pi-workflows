import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { firstUnfinished, parseMeta, runWorkflow, type RunResult } from "./runtime.ts";
import { spawnWorker } from "./spawn.ts";
import {
  decorateInput,
  loadSize,
  keywordState,
  parseSize,
  saveSize,
  SIZE_HINT,
  SIZES,
  type Size,
} from "./polish.ts";
import { approvalCard, KeywordEditor } from "./ui.ts";
import {
  agentsDir,
  discoverSaved,
  listDirNames,
  promptsDir,
  repoRoot,
  saveScript,
  skillsDir,
} from "./storage.ts";
import { RECIPE_TOOLS, unavailableRecipeTools } from "./recipes.ts";

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
  error?: string | undefined;
  value?: unknown;
  started: number[];
  cache: unknown[];
  replayThrough: number;
  controller: AbortController;
  task?: Promise<void>;
};

let seq = 0;

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
    if (id > replayThrough) {
      break;
    }
    cache[id] = result.finished.get(id);
  }
  return { cache, replayThrough };
}

type StartRunOptions = {
  script: string;
  args: unknown;
  resume?: Run;
};

function startRun(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  runs: Map<string, Run>,
  opts: StartRunOptions,
): Run {
  const meta = parseMeta(opts.script);
  const resume = opts.resume;
  const run: Run = resume ?? {
    id: newId(),
    name: meta.name,
    description: meta.description,
    script: opts.script,
    args: opts.args,
    status: "running",
    started: [],
    cache: [],
    replayThrough: -1,
    controller: new AbortController(),
  };
  if (resume !== undefined) {
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
    if (ctx.mode === "tui") {
      ctx.ui.setWidget("workflows", [line]);
    }
  };
  run.task = (async () => {
    const result = await runWorkflow(opts.script, {
      args: opts.args,
      signal: run.controller.signal,
      replayThrough: run.replayThrough,
      cache: run.cache,
      agent: (prompt, agentOpts) =>
        spawnWorker(prompt, { ...agentOpts, cwd: ctx.cwd, signal: run.controller.signal }),
      onEvent: (event) => {
        if (event.type === "agent_start") {
          startedCount += 1;
        }
        paint();
      },
    });
    const snap = cacheFrom(result);
    run.cache = snap.cache;
    run.replayThrough = snap.replayThrough;
    run.started = result.started;
    if (run.controller.signal.aborted) {
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
  if (run.status === "failed") {
    return `Workflow ${run.name} failed: ${run.error ?? "unknown error"}`;
  }
  if (run.status !== "done") {
    return `Workflow ${run.name} ${run.status}.`;
  }
  if (run.value === undefined) {
    return `Workflow ${run.name} finished.\n\n`;
  }
  const body = typeof run.value === "string" ? run.value : JSON.stringify(run.value, null, 2);
  return `Workflow ${run.name} finished.\n\n${body}`;
}

/** A recipe command this package itself owns (never another package's or a user override). */
function ownedRecipe(pi: ExtensionAPI, recipe: string): SlashCommandInfo | undefined {
  const command = pi.getCommands().find((info) => info.name === recipe);
  if (command === undefined) {
    return undefined;
  }
  let ownedPath: string | undefined;
  if (command.source === "skill") {
    ownedPath = join(skillsDir, recipe, "SKILL.md");
  } else if (command.source === "prompt") {
    ownedPath = join(promptsDir, `${recipe}.md`);
  }
  return ownedPath !== undefined && command.sourceInfo.path === ownedPath ? command : undefined;
}

function denyRecipe(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  recipe: string,
  missing: string[],
): void {
  const text = `Recipe ${recipe} not started. Missing, disabled or incompatible tools: ${missing.join(", ")}. Recipes require a compatible multi-agent executor (Pi Subagents 0.44.4+ with agent/task/label/tasks), pi-todo-list, pi-ask-question and pi-agent-browser-native search. Install or enable these integrations, then retry. Do not replace specialists or approval gates with inline work. Standalone scripted workflows remain available through the workflow tool.`;
  pi.sendMessage(
    {
      customType: "recipe-unavailable",
      content: [{ type: "text", text }],
      display: true,
      details: { recipe, missing },
    },
    { triggerTurn: false },
  );
  if (ctx.hasUI) {
    ctx.ui.notify(text, "error");
  } else {
    console.error(text);
    // ponytail: SDK and print share exitCode; continuing embedders must consume the diagnostic and reset it.
    process.exitCode = 1;
  }
}

function flagSize(pi: ExtensionAPI): string | undefined {
  const value = pi.getFlag("workflow-size");
  return typeof value === "string" ? value : undefined;
}

function sizeFor(pi: ExtensionAPI, cwd: string): Size {
  return loadSize(repoRoot(cwd), flagSize(pi));
}

async function askToRun(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  script: string,
): Promise<{ ok: boolean; script: string }> {
  const meta = parseMeta(script);
  return approvalCard(ctx, {
    name: meta.name,
    description: meta.description,
    script,
    size: sizeFor(pi, ctx.cwd),
    root: repoRoot(ctx.cwd),
  });
}

function listOf(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

function workflowsReport(pi: ExtensionAPI, ctx: ExtensionContext, runs: Map<string, Run>): string {
  const skills = existsSync(skillsDir)
    ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, "SKILL.md")))
    : [];
  const agents = listDirNames(agentsDir, "file");
  const recipes = listDirNames(promptsDir, "file");
  const missing = unavailableRecipeTools(pi, ctx);
  const saved = [...discoverSaved(ctx.cwd).values()].map((s) => s.meta.name);
  const size = sizeFor(pi, ctx.cwd);
  const runLines = [...runs.values()].map((r) => `${r.status} ${r.name} (${r.id})`);
  return [
    `Recipes (${recipes.length}): ${listOf(recipes.map((r) => `/${r}`))}`,
    `Skills (${skills.length}): ${listOf(skills)}`,
    `Agents (${agents.length}): ${listOf(agents)}`,
    `Saved scripts: ${listOf(saved.map((n) => `/${n}`))}`,
    `Size: ${size} (${SIZE_HINT[size]}) — /workflow-size to change`,
    missing.length > 0
      ? `Missing, disabled or incompatible recipe tools: ${missing.join(", ")}. Scripted workflows remain available.`
      : `Recipe tools registered: ${RECIPE_TOOLS.join(", ")}; recipes verify profiles and provider readiness before use.`,
    runLines.length > 0 ? `Runs:\n${runLines.join("\n")}` : "Runs: none",
  ].join("\n");
}

type RunEnv = {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  runs: Map<string, Run>;
};

async function applyRunAction(env: RunEnv, run: Run, action: string | undefined): Promise<void> {
  if (action === "View") {
    env.ctx.ui.notify(formatReport(run), "info");
  }
  if (action === "Pause" || action === "Stop") {
    run.controller.abort();
  }
  if (action === "Resume" && run.status === "paused") {
    startRun(env.pi, env.ctx, env.runs, { script: run.script, args: run.args, resume: run });
  }
  if (action === "Save") {
    env.ctx.ui.notify(`Saved ${saveScript(env.ctx.cwd, run.script)}`, "info");
  }
}

async function manageRuns(env: RunEnv): Promise<void> {
  const labels = [...env.runs.values()].map((r) => `${r.status} ${r.name} (${r.id})`);
  const picked = await env.ctx.ui.select("Workflow runs", labels.length > 0 ? labels : ["(none)"]);
  if (picked === undefined || picked === "(none)") {
    return;
  }
  const id = picked.slice(picked.lastIndexOf("(") + 1, -1);
  const run = env.runs.get(id);
  if (run === undefined) {
    return;
  }
  const action = await env.ctx.ui.select(run.name, ["View", "Pause", "Resume", "Stop", "Save"]);
  await applyRunAction(env, run, action);
}

function registerWorkflows(pi: ExtensionAPI, runs: Map<string, Run>): void {
  pi.registerCommand("workflows", {
    description: "List recipes, saved scripts, and manage runs",
    handler: async (args, ctx) => {
      const report = workflowsReport(pi, ctx, runs);
      const want = args.trim();
      if (!ctx.hasUI) {
        console.log(report);
        return;
      }
      if (want === "status" || (want === "" && runs.size === 0)) {
        ctx.ui.notify(report, "info");
        return;
      }
      await manageRuns({ pi, ctx, runs });
    },
  });
}

function registerSizeCommand(pi: ExtensionAPI): void {
  pi.registerCommand("workflow-size", {
    description: "Show or set the workflow size guideline",
    getArgumentCompletions: (prefix) => {
      const items = SIZES.filter((s) => s.startsWith(prefix)).map((s) => ({
        value: s,
        label: s,
        description: SIZE_HINT[s],
      }));
      return items.length > 0 ? items : null;
    },
    handler: async (args, ctx) => {
      const next = parseSize(args);
      if (next === undefined) {
        const size = sizeFor(pi, ctx.cwd);
        const text = `Size: ${size} (${SIZE_HINT[size]}). Pass small, medium, large, or unrestricted.`;
        if (ctx.hasUI) {
          ctx.ui.notify(text, "info");
        } else {
          console.log(text);
        }
        return;
      }
      const path = saveSize(repoRoot(ctx.cwd), next);
      const text = `Size set to ${next} (${SIZE_HINT[next]}) in ${path}`;
      if (ctx.hasUI) {
        ctx.ui.notify(text, "info");
      } else {
        console.log(text);
      }
    },
  });
}

type Launcher = (script: string) => (args: string, ctx: ExtensionCommandContext) => Promise<void>;

function makeLauncher(pi: ExtensionAPI, runs: Map<string, Run>): Launcher {
  return (script: string) =>
    async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
      const decision = await askToRun(pi, ctx, script);
      if (!decision.ok) {
        return;
      }
      const run = startRun(pi, ctx, runs, { script: decision.script, args });
      ctx.ui.notify(`Started ${run.name} (${run.id})`, "info");
    };
}

function registerDeepResearch(pi: ExtensionAPI, runs: Map<string, Run>): void {
  pi.registerCommand("deep-research", {
    description: "Research a question across several angles and return a cited report",
    handler: makeLauncher(pi, runs)(DEEP_RESEARCH),
  });
}

function registerSessionHandlers(pi: ExtensionAPI, runs: Map<string, Run>): void {
  const launch = makeLauncher(pi, runs);
  pi.on("session_start", async (_event, ctx) => {
    keywordState.dismissed = false;
    if (ctx.mode === "tui") {
      ctx.ui.setEditorComponent((tui, theme, kb) => new KeywordEditor(tui, theme, kb));
    }
    for (const saved of discoverSaved(ctx.cwd).values()) {
      if (saved.meta.name === "deep-research" || saved.meta.name === "workflows") {
        continue;
      }
      pi.registerCommand(saved.meta.name, {
        description: saved.meta.description,
        handler: launch(saved.source),
      });
    }
  });

  pi.on("input", async (event, ctx) => {
    const invocation = event.text.match(/^\/((?:skill:)?recipe-[a-z0-9-]+)(?:\s|$)/)?.[1];
    if (invocation !== undefined) {
      const recipe = invocation.replace(/^skill:/, "");
      if (ownedRecipe(pi, recipe) !== undefined) {
        const missing = unavailableRecipeTools(pi, ctx);
        if (missing.length > 0) {
          denyRecipe(pi, ctx, recipe, missing);
          return { action: "handled" as const };
        }
      }
    }
    if (event.source !== "interactive") {
      return { action: "continue" as const };
    }
    return { action: "transform" as const, text: decorateInput(event.text, sizeFor(pi, ctx.cwd)) };
  });

  pi.on("session_shutdown", async () => {
    for (const run of runs.values()) {
      run.controller.abort();
    }
    // Shutdown is awaited before contexts become stale; finish owned child cleanup
    // while paint/report callbacks still belong to this session.
    await Promise.allSettled(
      [...runs.values()].flatMap((run) => (run.task !== undefined ? [run.task] : [])),
    );
  });
}

function registerWorkflowTool(pi: ExtensionAPI, runs: Map<string, Run>): void {
  pi.registerTool({
    name: "workflow",
    label: "Workflow",
    description:
      "Run a JavaScript workflow that orchestrates many worker agents via agent() and pipeline(). Use when the user asks to run a workflow, types use a workflow / run a workflow / ultracode, or the task needs more agents than one conversation can coordinate. Honor /workflow-size. Script is plain JavaScript with top-level await and export const meta = { name, description }. No import, require, fetch, or process. args is a global.",
    parameters: Type.Object({
      script: Type.String({ description: "Full workflow script including export const meta" }),
      args: Type.Optional(Type.Unknown()),
    }),
    // QX-001 (eslint/max-params): the SDK mandates this exact five-parameter execute
    // signature; there is no compliant alternative. See the quality-exception record.
    // oxlint-disable-next-line eslint/max-params
    async execute(_id, params, signal, _onUpdate, ctx) {
      try {
        const decision = await askToRun(pi, ctx, params.script);
        if (!decision.ok) {
          return {
            content: [{ type: "text", text: "User declined the workflow." }],
            details: undefined,
          };
        }
        const run = startRun(pi, ctx, runs, { script: decision.script, args: params.args });
        if (signal?.aborted === true) {
          run.controller.abort();
        } else if (signal) {
          const abort = () => run.controller.abort();
          signal.addEventListener("abort", abort, { once: true });
          void run.task?.then(
            () => {
              signal.removeEventListener("abort", abort);
            },
            () => {
              signal.removeEventListener("abort", abort);
            },
          );
        }
        return {
          content: [
            { type: "text", text: `Started ${run.name} (${run.id}). Use /workflows to watch.` },
          ],
          details: undefined,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: message }],
          isError: true,
          details: { error: message },
        };
      }
    },
  });
}

export default function (pi: ExtensionAPI): void {
  const runs = new Map<string, Run>();
  pi.registerFlag("workflow-size", {
    description: "Workflow size guideline: small, medium, large, unrestricted",
    type: "string",
  });
  registerWorkflows(pi, runs);
  registerSizeCommand(pi);
  registerDeepResearch(pi, runs);
  registerSessionHandlers(pi, runs);
  registerWorkflowTool(pi, runs);
}
