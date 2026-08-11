// pi-workflows — pi-native port of shinpr's workflows plugins.
//
// Recipe slash commands (/recipe-implement, /recipe-design, ...) are pi prompt
// templates generated into .pi/prompts by scripts/build.mjs — pi expands them
// natively with $ARGUMENTS substitution, mirroring the upstream plugin's skill
// invocation. Skills and agents are auto-discovered by pi and pi-subagents
// from .pi/skills and .pi/agents. This extension only adds the /workflows
// status command.

import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const piDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const skillsDir = join(piDir, "skills");
const agentsDir = join(piDir, "agents");
const promptsDir = join(piDir, "prompts");

export default function (pi: ExtensionAPI) {
  pi.registerCommand("workflows", {
    description: "Show pi-workflows status: recipes, skills, agents, required tools",
    handler: async (_args, ctx) => {
      const skills = existsSync(skillsDir)
        ? readdirSync(skillsDir).filter((d) => existsSync(join(skillsDir, d, "SKILL.md")))
        : [];
      const agents = existsSync(agentsDir)
        ? readdirSync(agentsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
        : [];
      const recipes = existsSync(promptsDir)
        ? readdirSync(promptsDir).filter((f) => f.endsWith(".md")).map((f) => f.replace(/\.md$/, ""))
        : [];
      const tools = new Set(pi.getAllTools().map((t) => t.name));
      const required = ["subagent", "todo_list", "ask_question", "agent_browser_web_search"];
      const missing = required.filter((t) => !tools.has(t));
      const lines = [
        "pi-workflows (port of shinpr's workflows)",
        `Recipes (${recipes.length}): ${recipes.map((r) => `/${r}`).join(", ") || "none"}`,
        `Skills (${skills.length}): ${skills.join(", ") || "none"}`,
        `Agents (${agents.length}): ${agents.join(", ") || "none"}`,
        missing.length
          ? `Missing required tools: ${missing.join(", ")} — install pi-subagents, pi-todo-list, pi-ask-question, pi-agent-browser-native`
          : `Required tools present: ${required.join(", ")}`,
      ];
      const text = lines.join("\n");
      if (ctx.hasUI) ctx.ui.notify(text, "info");
      else console.log(text);
    },
  });
}
