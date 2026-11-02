import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isRecord } from "./guards.ts";

export const RECIPE_TOOLS = ["subagent", "todo_list", "ask_question", "agent_browser_web_search"];

function collectInactive(data: unknown, deferred: Set<string>): void {
  if (!isRecord(data) || !Array.isArray(data.inactive)) {
    return;
  }
  for (const name of data.inactive) {
    if (typeof name === "string") {
      deferred.add(name);
    }
  }
}

function deferredRecipeTools(pi: ExtensionAPI, ctx: ExtensionContext): Set<string> {
  const deferred = new Set<string>();
  if (!pi.getActiveTools().includes("discover_tools")) {
    return deferred;
  }
  // ponytail: input precedes native deferral retirement; recipe preflight is the final capability check.
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "custom" && entry.customType === "pi:instruction-groups") {
      collectInactive(entry.data, deferred);
    }
  }
  return deferred;
}

export function unavailableRecipeTools(pi: ExtensionAPI, ctx: ExtensionContext): string[] {
  const tools = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
  const active = new Set(pi.getActiveTools());
  const groupDeferred = deferredRecipeTools(pi, ctx);
  const available = (name: string): boolean => {
    const tool = tools.get(name);
    if (tool === undefined || tool.exposure === "hidden") {
      return false;
    }
    if (active.has(name) || groupDeferred.has(name)) {
      return true;
    }
    const discoverable = active.has("codemode") || active.has("tool_search");
    return discoverable && (tool.exposure === "codemode" || tool.exposure === "deferred");
  };
  const subagentUsable = (): boolean => {
    const tool = tools.get("subagent");
    const schema = tool?.parameters;
    const candidate =
      schema !== undefined && "properties" in schema ? schema.properties : undefined;
    const properties = isRecord(candidate) ? candidate : undefined;
    return (
      tool !== undefined &&
      tool.exposure !== "hidden" &&
      properties !== undefined &&
      ["agent", "task", "label", "tasks"].every((key) => key in properties) &&
      (available("subagent") || available("load_subagent"))
    );
  };
  return RECIPE_TOOLS.filter((name) => {
    if (name === "subagent") {
      return !subagentUsable();
    }
    return !available(name);
  });
}
