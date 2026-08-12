#!/usr/bin/env node
// build.mjs — regenerate .pi/skills, .pi/agents, and .pi/prompts from reference/.
//
// Usage: node scripts/build.mjs [--check]
//   (no flag)  wipe and regenerate those trees
//   --check    verify generated output is present, complete, and consistent
//
// The port mirrors upstream's own sync-plugins.mjs architecture: canonical
// markdown in, mechanically transformed artifacts out. All upstream-harness → pi
// translations live in transformContent() / transformAgent() below.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "reference", "workflows");
const SRC_SKILLS = join(SRC, "skills");
const SRC_AGENTS = join(SRC, "agents");
const DST_SKILLS = join(ROOT, ".pi", "skills");
const DST_AGENTS = join(ROOT, ".pi", "agents");
const DST_PROMPTS = join(ROOT, ".pi", "prompts");
const CHECK = process.argv.includes("--check");

// Plugin namespaces (workflows:, workflows-frontend:, workflows-fullstack:)
// only appear in front of known agent names. Anchor the strip pattern to the
// vendored agent roster so prose like "workflows: do X" is never rewritten.
let agentNameAlternation = null;
function agentNamespacePattern() {
  if (!agentNameAlternation) {
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
export function transformContent(input) {
  let s = input;
  // Plugin namespacing does not exist for pi subagents: agents are flat names.
  s = s.replace(agentNamespacePattern(), (m) => m.slice(m.lastIndexOf(":") + 1));
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
  // Upstream file/shell tools → pi built-in tool names (pi edit covers MultiEdit).
  s = s.replace(/Edit\/Write\/MultiEdit/g, "edit/write");
  s = s.replace(/\bEdit\/Write\b/g, "edit/write");
  s = s.replace(/\bMultiEdit\b/g, "edit");
  s = s.replace(/\bGlob\b/g, "find");
  s = s.replace(/\bGrep\b/g, "grep");
  s = s.replace(/\bLS\b/g, "ls");
  s = s.replace(/\bBash\b/g, "bash");
  s = s.replace(/\b(Read|Write|Edit) tool\b/g, (_m, t) => `${t.toLowerCase()} tool`);
  // Upstream web tools → pi-agent-browser-native tools.
  s = s.replace(/\bWebSearch\b/g, "agent_browser_web_search");
  s = s.replace(/\bWebFetch\b/g, "agent_browser");
  return s;
}

// Recipe skills double as slash commands. In the upstream harness, /recipe-X expands the
// skill markdown into the conversation with $ARGUMENTS substituted. Pi prompt
// templates do exactly this natively (filename → /command, $ARGUMENTS builtin),
// so each recipe skill also generates a flat prompt template.
function toPromptTemplate(content) {
  const { fields, body } = parseFrontmatter(content);
  const description = fields.get("description") ?? "";
  return `---\ndescription: ${description}\nargument-hint: "[input]"\n---\n${body.trim()}\n`;
}

function skillInvocationArgs(content) {
  return content.replaceAll("$ARGUMENTS", "the skill invocation arguments");
}

// Upstream tool names → pi built-in tool names (agent frontmatter `tools:`).
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
function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { fields: new Map(), body: content };
  const fields = new Map();
  let currentListKey = null;
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-zA-Z][a-zA-Z0-9-]*):\s*(.*)$/);
    if (kv) {
      currentListKey = kv[1];
      fields.set(kv[1], kv[2]);
      continue;
    }
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item && currentListKey) {
      const prev = fields.get(currentListKey) ?? "";
      fields.set(currentListKey, prev ? `${prev}, ${item[1]}` : item[1]);
    }
  }
  return { fields, body: m[2] };
}

function transformAgent(content) {
  const { fields, body } = parseFrontmatter(content);
  const name = fields.get("name");
  const description = fields.get("description");
  if (!name || !description) throw new Error(`agent missing name/description: ${content.slice(0, 80)}`);

  const lines = [`name: ${name}`, `description: ${description}`];

  const toolsRaw = fields.get("tools");
  const disallowed = new Set(
    (fields.get("disallowedTools") ?? "").split(",").map((x) => x.trim()).filter(Boolean),
  );
  if (toolsRaw) {
    const mapped = [];
    for (const t of toolsRaw.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (disallowed.has(t)) continue;
      const piTool = TOOL_MAP.get(t);
      if (!piTool) throw new Error(`unmapped upstream tool '${t}' in agent ${name}`);
      if (!mapped.includes(piTool)) mapped.push(piTool);
    }
    lines.push(`tools: ${mapped.join(", ")}`);
  } else if (disallowed.size) {
    lines.push(`tools: ${READ_TOOLS}`);
  }

  const skills = fields.get("skills");
  if (skills) lines.push(`skills: ${skills}`);

  // pi-subagents child configuration matching upstream plugin subagent semantics:
  // isolated context, own system prompt, no nested delegation.
  lines.push("systemPromptMode: replace");
  lines.push("inheritProjectContext: true");
  lines.push("defaultContext: fresh");
  lines.push("allowSubagents: false");
  lines.push("maxSubagentDepth: 0");

  return `---\n${lines.join("\n")}\n---\n${transformContent(body)}`;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d);
    } else if (entry.name.endsWith(".md")) {
      writeFileSync(d, transformContent(readFileSync(s, "utf8")));
    } else {
      cpSync(s, d);
    }
  }
}

function generate() {
  if (!existsSync(SRC_SKILLS) || !existsSync(SRC_AGENTS)) {
    throw new Error(`upstream source missing under ${SRC} — clone it into reference/ first`);
  }
  rmSync(DST_SKILLS, { recursive: true, force: true });
  rmSync(DST_AGENTS, { recursive: true, force: true });
  rmSync(DST_PROMPTS, { recursive: true, force: true });
  mkdirSync(DST_SKILLS, { recursive: true });
  mkdirSync(DST_AGENTS, { recursive: true });
  mkdirSync(DST_PROMPTS, { recursive: true });

  for (const dir of readdirSync(SRC_SKILLS)) {
    copyTree(join(SRC_SKILLS, dir), join(DST_SKILLS, dir));
    if (dir.startsWith("recipe-")) {
      const skillFile = join(SRC_SKILLS, dir, "SKILL.md");
      if (existsSync(skillFile)) {
        const translated = transformContent(readFileSync(skillFile, "utf8"));
        writeFileSync(join(DST_SKILLS, dir, "SKILL.md"), skillInvocationArgs(translated));
        writeFileSync(join(DST_PROMPTS, `${dir}.md`), toPromptTemplate(translated));
      }
    }
  }
  for (const file of readdirSync(SRC_AGENTS)) {
    if (!file.endsWith(".md")) continue;
    writeFileSync(join(DST_AGENTS, file), transformAgent(readFileSync(join(SRC_AGENTS, file), "utf8")));
  }
}

// ---------------------------------------------------------------------------
// Validation: the generated port must be complete and self-consistent.
// ---------------------------------------------------------------------------
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function check() {
  const problems = [];

  const srcSkillDirs = readdirSync(SRC_SKILLS).filter((d) => existsSync(join(SRC_SKILLS, d, "SKILL.md")));
  const dstSkillDirs = existsSync(DST_SKILLS)
    ? readdirSync(DST_SKILLS).filter((d) => existsSync(join(DST_SKILLS, d, "SKILL.md")))
    : [];
  const srcAgents = readdirSync(SRC_AGENTS).filter((f) => f.endsWith(".md"));
  const dstAgents = existsSync(DST_AGENTS) ? readdirSync(DST_AGENTS).filter((f) => f.endsWith(".md")) : [];
  const srcRecipes = srcSkillDirs.filter((d) => d.startsWith("recipe-"));
  const dstPrompts = existsSync(DST_PROMPTS) ? readdirSync(DST_PROMPTS).filter((f) => f.endsWith(".md")) : [];
  if (srcRecipes.length !== dstPrompts.length)
    problems.push(`recipe prompt count: upstream ${srcRecipes.length} vs generated ${dstPrompts.length}`);
  for (const r of srcRecipes) {
    if (!dstPrompts.includes(`${r}.md`)) {
      problems.push(`missing recipe prompt: ${r}.md`);
      continue;
    }
    // The template pi expands must equal the translated upstream skill body.
    const expected = toPromptTemplate(transformContent(readFileSync(join(SRC_SKILLS, r, "SKILL.md"), "utf8")));
    const actual = readFileSync(join(DST_PROMPTS, `${r}.md`), "utf8");
    if (actual !== expected) problems.push(`${r}.md: template body differs from translated skill`);
  }

  if (srcSkillDirs.length !== dstSkillDirs.length)
    problems.push(`skill count: upstream ${srcSkillDirs.length} vs generated ${dstSkillDirs.length}`);
  if (srcAgents.length !== dstAgents.length)
    problems.push(`agent count: upstream ${srcAgents.length} vs generated ${dstAgents.length}`);
  for (const d of srcSkillDirs) if (!dstSkillDirs.includes(d)) problems.push(`missing skill: ${d}`);
  for (const f of srcAgents) if (!dstAgents.includes(f)) problems.push(`missing agent: ${f}`);

  const skillNames = new Set(dstSkillDirs);
  const agentNames = new Set(dstAgents.map((f) => f.replace(/\.md$/, "")));

  // No upstream-only identifiers may survive translation.
  const residualPatterns = [
    [agentNamespacePattern(), "plugin-namespaced agent ref"],
    [/subagent_type/g, "subagent_type"],
    [/\bTaskCreate\b|\bTaskUpdate\b|\bTodoWrite\b/g, "upstream task tool"],
    [/\bAskUserQuestion\b/g, "AskUserQuestion"],
    [/\bMultiEdit\b/g, "MultiEdit"],
    [/\bGlob\b/g, "Glob"],
    [/\bGrep\b/g, "Grep"],
    [/\bLS\b/g, "LS"],
    [/\bBash\b/g, "Bash"],
    [/\bAgent (?:tool|prompts?|invocation|calls?|routing)\b/g, "upstream Agent tool ref"],
    [/\bWebSearch\b|\bWebFetch\b/g, "upstream web tool"],
    [/Execute Skill:/g, "Execute Skill:"],
    [/\$ARGUMENTS/g, "$ARGUMENTS outside prompts"],
    [new RegExp(["cla", "ude"].join(""), "i"), "forbidden name"],
  ];
  for (const dir of [DST_SKILLS, DST_AGENTS, DST_PROMPTS, join(ROOT, ".pi", "extensions")]) {
    if (!existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const text = readFileSync(file, "utf8");
      for (const [re, label] of residualPatterns) {
        if (label.startsWith("$ARGUMENTS") && file.includes(`${sep}prompts${sep}`)) continue;
        const hits = text.match(re);
        if (hits) problems.push(`${file}: residual ${label} x${hits.length}`);
      }
      // Every pi-subagents agent reference must resolve to a generated agent.
      for (const m of text.matchAll(/\bagent`?\s*:\s*`?"?([a-z0-9][a-z0-9-]*)"?`?\)?/g)) {
        const ref = m[1];
        if (!agentNames.has(ref) && !["name", "the", "a", "an", "tool"].includes(ref)) {
          problems.push(`${file}: unresolved agent ref '${ref}'`);
        }
      }
    }
  }

  // Every skill attached to an agent must exist in .pi/skills.
  for (const f of dstAgents) {
    const { fields } = parseFrontmatter(readFileSync(join(DST_AGENTS, f), "utf8"));
    for (const s of (fields.get("skills") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!skillNames.has(s)) problems.push(`${f}: attached skill '${s}' not in .pi/skills`);
    }
    // Agent tools must be pi tool names.
    for (const t of (fields.get("tools") ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!/^[a-z_][a-z_0-9]*$/.test(t)) problems.push(`${f}: suspicious tool name '${t}'`);
    }
  }

  return problems;
}

export { generate, check, toPromptTemplate, transformAgent, skillInvocationArgs };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!CHECK) generate();
  const problems = check();
  const skillCount = existsSync(DST_SKILLS) ? readdirSync(DST_SKILLS).length : 0;
  const agentCount = existsSync(DST_AGENTS) ? readdirSync(DST_AGENTS).length : 0;
  if (problems.length) {
    console.error(`pi-workflows build: ${problems.length} problem(s)`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log(`pi-workflows build OK: ${skillCount} skills, ${agentCount} agents (${CHECK ? "check only" : "regenerated"})`);
}
