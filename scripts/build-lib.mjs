// build-lib.mjs — shared paths and the upstream-harness → pi translation layer.
// Canonical markdown in, mechanically transformed markdown out; the generation
// entry point is build.mjs and the consistency checks live in build-check.mjs.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SRC = join(ROOT, "reference", "workflows");
export const SRC_SKILLS = join(SRC, "skills");
export const SRC_AGENTS = join(SRC, "agents");
export const DST_SKILLS = join(ROOT, ".pi", "skills");
export const DST_AGENTS = join(ROOT, ".pi", "agents");
export const DST_PROMPTS = join(ROOT, ".pi", "prompts");
export const PACKAGE_RESOURCES = join(ROOT, "resources");
export const RESOURCE_DIRS = ["skills", "agents", "prompts", "extensions"];

// Plugin namespaces (workflows:, workflows-frontend:, workflows-fullstack:)
// only appear in front of known agent names. Anchor the strip pattern to the
// vendored agent roster so prose like "workflows: do X" is never rewritten.
/** @type {string | null} */
let agentNameAlternation = null;

/** @returns {RegExp} */
export function agentNamespacePattern() {
  if (agentNameAlternation === null) {
    const names = readdirSync(SRC_AGENTS)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
    agentNameAlternation = names.join("|");
  }
  return new RegExp(`workflows(?:-frontend|-fullstack)?:(?:${agentNameAlternation})\\b`, "g");
}

// ---------------------------------------------------------------------------
// Content translation: upstream-harness identifiers → pi-native equivalents.
// Applied to every markdown body (skills and agent system prompts).
// ---------------------------------------------------------------------------

/** @type {Record<string, string>} */
const SUBAGENT_FIELDS = { description: "label", prompt: "task" };

/** @param {string} input @returns {string} */
function translateSubagentFields(input) {
  // Only invocation blocks carry these aliases. Metadata and the specialist's
  // nested input contract may legitimately contain description/prompt/model.
  const s = input.replace(
    /```[^\n]*\n([\s\S]*?)```/g,
    /** @param {string} block @param {string} body @returns {string} */
    (block, body) => {
      const indent = body.match(/^([ \t]*)subagent_type\s*:/m)?.[1];
      if (indent === undefined) {
        return block;
      }
      return block.replace(
        new RegExp(`^(${indent})(description|prompt)(\\s*:)`, "gm"),
        /** @param {string} _match @param {string} prefix @param {string} field @param {string} colon @returns {string} */
        (_match, prefix, field, colon) => `${prefix}${SUBAGENT_FIELDS[field] ?? ""}${colon}`,
      );
    },
  );
  const namedInvocation = new RegExp(
    `\\b[Ii]nvoke\\b[^\\n]*(?:Agent tool|\\b(?:${agentNameAlternation ?? ""})\\b)[^\\n]*:\\n`,
  );
  return s
    .split(/(\n[ \t]*\n)/)
    .map(
      /** @param {string} block @returns {string} */
      (block) => {
        const invocation = block.match(/^([ \t]*)- [^\n]*\bsubagent_type`?\s*:/m);
        if (invocation === null && !namedInvocation.test(block)) {
          return block;
        }
        const indent = invocation?.[1] ?? block.match(/^([ \t]*)- `/m)?.[1];
        if (indent === undefined) {
          return block;
        }
        return block.replace(
          new RegExp(`^(${indent}- \`)(description|prompt)(\`?\\s*:)`, "gm"),
          /** @param {string} _match @param {string} prefix @param {string} field @param {string} colon @returns {string} */
          (_match, prefix, field, colon) => `${prefix}${SUBAGENT_FIELDS[field] ?? ""}${colon}`,
        );
      },
    )
    .join("");
}

/** @param {string} input @returns {string} */
export function transformContent(input) {
  const namespaces = agentNamespacePattern();
  let s = translateSubagentFields(input);
  // Plugin namespacing does not exist for pi subagents: agents are flat names.
  s = s.replace(namespaces, (m) => m.slice(m.lastIndexOf(":") + 1));
  // The upstream Agent tool parameter `subagent_type` is pi-subagents' `agent`.
  s = s.replace(/subagent_type/g, "agent");
  // The upstream Agent tool → pi's subagent tool.
  s = s.replace(/\bAgent tool\b/g, "subagent tool");
  s = s.replace(/\bAgent prompts\b/g, "subagent prompts");
  s = s.replace(/\bAgent prompt\b/g, "subagent prompt");
  s = s.replace(/\bAgent routing\b/g, "Subagent routing");
  s = s.replace(/\bAgent name\b/g, "Subagent name");
  s = s.replace(/\[Update Agent from\b/g, "[Update agent from");
  s = s.replace(/\bAgent invocation\b/g, "subagent invocation");
  s = s.replace(/\bAgent calls\b/g, "subagent calls");
  s = s.replace(/\bAgent call\b/g, "subagent call");
  // The upstream AskUserQuestion tool → pi-ask-question's ask_question tool.
  s = s.replace(/\bAskUserQuestion\b/g, "ask_question");
  // The upstream TaskCreate/TaskUpdate → pi-todo-list's todo_list tool.
  s = s.replace(/\bTaskCreate\b/g, "todo_list");
  s = s.replace(/\bTaskUpdate\b/g, "todo_list");
  s = s.replace(/todo_list\/todo_list/g, "todo_list");
  s = s.replace(/todo_list and todo_list/g, "todo_list");
  // Skill invocation: pi loads skills via /skill:name (or the model reads SKILL.md).
  s = s.replace(/Execute Skill: ([a-z0-9-]+)/g, "Execute the $1 skill (/skill:$1)");
  // Upstream file/shell tools → Pi built-ins (edit covers MultiEdit).
  s = s.replace(/Edit\/Write\/MultiEdit/g, "edit/write");
  s = s.replace(/\bEdit\/Write\b/g, "edit/write");
  s = s.replace(/\bMultiEdit\b/g, "edit");
  s = s.replace(/\bGlob\b/g, "find");
  s = s.replace(/\bGrep\b/g, "grep");
  s = s.replace(/\bLS\b/g, "ls");
  s = s.replace(/\bBash\b/g, "bash");
  s = s.replace(
    /\b(Read|Write|Edit) tool\b/g,
    /** @param {string} _m @param {string} t @returns {string} */
    (_m, t) => `${t.toLowerCase()} tool`,
  );
  // Upstream web tools → pi-agent-browser-native tools.
  s = s.replace(/\bWebSearch\b/g, "agent_browser_web_search");
  s = s.replace(/\bWebFetch\b/g, "agent_browser");
  return s;
}

const RECIPE_PREFLIGHT = `## Pi recipe prerequisites

This optional recipe requires a compatible multi-agent executor and extension tools; native Pi does not supply them. All four tools in step 1 are hard runtime prerequisites for every recipe, including recipes without external research. Before any recipe phase or artifact production:

1. Inspect available tools and any advertised discovery catalog. Require \`subagent\` with \`agent\`, \`task\`, \`label\` and parallel \`tasks\` support, \`todo_list\`, \`ask_question\` and \`agent_browser_web_search\`. If advanced \`subagent\` is inactive, call \`load_subagent({advanced:true})\` only when that loader is available, then inspect its instructions before delegation. Pi Subagents 0.44.4+, pi-todo-list, pi-ask-question and pi-agent-browser-native provide these integrations; they are not dependencies of the standalone scripted runtime.
2. Use \`subagent({action:"list"})\` to verify the named specialists required by this recipe resolve from its bundled profiles or intentional user/project overrides. Serialize each specialist's canonical input fields inside the \`task\` string; they are not top-level tool parameters. Use \`label\` for the short call description. If the executor, loader, profile or required tool is missing, excluded or incompatible, stop and report the exact prerequisite and phase. Do not imitate specialists inline, silently serialize parallel reviews, skip required steps or assume a loader is installed.
3. Preserve every approval stop with an explicit user answer. If \`ask_question\` has no working TUI/RPC dialog, stop at that gate rather than assuming approval. Before required external research, verify the search provider is configured; when a public URL requires \`agent_browser\`, discover that tool too. A failed or unavailable provider blocks dependent research: report the verification limitation, never claim completed research. Pass this capability boundary to specialists that require those tools.

The \`workflow\` tool and scripted \`agent()/pipeline()\` remain independently usable with native Pi tools and do not require these recipe integrations.

`;

/** @param {string} content @returns {string} */
export function recipeContent(content) {
  return transformContent(content).replace(
    /^(---\r?\n[\s\S]*?\r?\n---\r?\n)\s*/,
    `$1\n${RECIPE_PREFLIGHT}`,
  );
}

// Recipe skills double as slash commands. In the upstream harness, /recipe-X expands the
// skill markdown into the conversation with $ARGUMENTS substituted. Pi prompt
// templates do exactly this natively (filename → /command, $ARGUMENTS builtin),
// so each recipe skill also generates a flat prompt template.

/** @param {string} content @returns {string} */
export function toPromptTemplate(content) {
  const { fields, body } = parseFrontmatter(content);
  const description = fields.get("description") ?? "";
  return `---\ndescription: ${description}\nargument-hint: "[input]"\n---\n${body.trim()}\n`;
}

/** @param {string} content @returns {string} */
export function skillInvocationArgs(content) {
  return content.replaceAll("$ARGUMENTS", "the skill invocation arguments");
}

// Upstream tool names → Pi built-ins or explicitly optional extension tools.
const TOOL_MAP = new Map([
  ["Read", "read"],
  ["Write", "write"],
  ["Edit", "edit"],
  ["MultiEdit", "edit"],
  ["Bash", "bash"],
  ["Grep", "grep"],
  ["Glob", "find"],
  ["LS", "ls"],
  ["TaskCreate", "todo_list"],
  ["TaskUpdate", "todo_list"],
  ["WebSearch", "agent_browser_web_search"],
  ["WebFetch", "agent_browser"],
  ["AskUserQuestion", "ask_question"],
  ["NotebookEdit", "edit"],
]);

const READ_TOOLS = "read, grep, find, ls, bash, todo_list, agent_browser_web_search";

// ---------------------------------------------------------------------------
// Frontmatter helpers (line-oriented; upstream files use simple YAML subset)
// ---------------------------------------------------------------------------

/** @param {string} content @returns {{ fields: Map<string, string>, body: string }} */
export function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (m === null) {
    return { fields: new Map(), body: content };
  }
  /** @type {Map<string, string>} */
  const fields = new Map();
  /** @type {string | null} */
  let currentListKey = null;
  for (const line of (m[1] ?? "").split("\n")) {
    currentListKey = absorbLine(fields, currentListKey, line);
  }
  return { fields, body: m[2] ?? "" };
}

/**
 * Absorb one frontmatter line: a `key: value` scalar resets the list context;
 * a `- item` line appends to the current key, if any.
 *
 * @param {Map<string, string>} fields
 * @param {string | null} currentListKey
 * @param {string} line
 * @returns {string | null}
 */
function absorbLine(fields, currentListKey, line) {
  const kv = line.match(/^([a-zA-Z][a-zA-Z0-9-]*):\s*(.*)$/);
  if (kv !== null) {
    const key = kv[1] ?? "";
    fields.set(key, kv[2] ?? "");
    return key;
  }
  const item = line.match(/^\s+-\s+(.+)$/);
  if (item !== null && currentListKey !== null) {
    const prev = fields.get(currentListKey) ?? "";
    const value = item[1] ?? "";
    fields.set(currentListKey, prev !== "" ? `${prev}, ${value}` : value);
  }
  return currentListKey;
}

/**
 * @param {string} toolsRaw
 * @param {Set<string>} disallowed
 * @param {string} name
 * @returns {string[]}
 */
function mapAgentTools(toolsRaw, disallowed, name) {
  /** @type {string[]} */
  const mapped = [];
  for (const t of toolsRaw
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (disallowed.has(t)) {
      continue;
    }
    const piTool = TOOL_MAP.get(t);
    if (piTool === undefined) {
      throw new Error(`unmapped upstream tool '${t}' in agent ${name}`);
    }
    if (!mapped.includes(piTool)) {
      mapped.push(piTool);
    }
  }
  return mapped;
}

/**
 * One or zero `tools:` lines for a generated agent, matching upstream's
 * disallowed-tools fallback semantics.
 *
 * @param {Map<string, string>} fields
 * @param {string} name
 * @returns {string[]}
 */
function agentToolLines(fields, name) {
  const toolsRaw = fields.get("tools");
  const disallowed = new Set(
    (fields.get("disallowedTools") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
  );
  if (toolsRaw !== undefined && toolsRaw !== "") {
    return [`tools: ${mapAgentTools(toolsRaw, disallowed, name).join(", ")}`];
  }
  if (disallowed.size > 0) {
    return [`tools: ${READ_TOOLS}`];
  }
  return [];
}

/** @param {string} content @returns {string} */
export function transformAgent(content) {
  const { fields, body } = parseFrontmatter(content);
  const name = fields.get("name");
  const description = fields.get("description");
  if (name === undefined || name === "" || description === undefined || description === "") {
    throw new Error(`agent missing name/description: ${content.slice(0, 80)}`);
  }

  const lines = [`name: ${name}`, `description: ${description}`];
  lines.push(...agentToolLines(fields, name));

  const skills = fields.get("skills");
  if (skills !== undefined && skills !== "") {
    lines.push(`skills: ${skills}`);
  }

  // pi-subagents child configuration matching upstream plugin subagent semantics:
  // isolated context, own system prompt, no nested delegation.
  lines.push("systemPromptMode: replace");
  lines.push("inheritProjectContext: true");
  lines.push("defaultContext: fresh");
  lines.push("allowSubagents: false");
  lines.push("maxSubagentDepth: 0");

  return `---\n${lines.join("\n")}\n---\n${transformContent(body)}`;
}
