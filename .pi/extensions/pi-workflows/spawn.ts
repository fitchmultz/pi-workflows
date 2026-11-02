import { spawn, type ChildProcess } from "node:child_process";
import { coerceResult, type AgentOpts, type JsonSchema } from "./runtime.ts";
import { isRecord } from "./guards.ts";

const TOOLS = "read,write,edit,bash,grep,find,ls";

type AssistantMessage = {
  stopReason?: string | undefined;
  content?: unknown[] | undefined;
};

function piInvocation(): { cmd: string; prefix: string[] } {
  const entry = process.argv[1] ?? "";
  if (entry.endsWith("cli.js") || entry.endsWith("cli.ts")) {
    return { cmd: process.execPath, prefix: [entry] };
  }
  return { cmd: "pi", prefix: [] };
}

function isAssistantMessage(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value.role === "assistant";
}

function toAssistantMessage(message: Record<string, unknown>): AssistantMessage {
  const stopReason = typeof message.stopReason === "string" ? message.stopReason : undefined;
  const content = Array.isArray(message.content) ? message.content : undefined;
  return { stopReason, content };
}

type TextPart = { type: unknown; text: string };

function isTextPart(part: unknown): part is TextPart {
  return isRecord(part) && part.type === "text" && typeof part.text === "string";
}

function textOf(message: AssistantMessage | undefined): string {
  return (
    message?.content
      ?.filter((part): part is TextPart => isTextPart(part))
      .map((part) => part.text)
      .join("") ?? ""
  );
}

export function spawnWorker(
  prompt: string,
  opts: AgentOpts & { cwd: string; signal?: AbortSignal },
): Promise<unknown> {
  if (opts.signal?.aborted === true) {
    return Promise.resolve(null);
  }
  const schemaNote = opts.schema
    ? `\nReturn ONLY JSON matching this schema:\n${JSON.stringify(opts.schema)}`
    : "";
  const { cmd, prefix } = piInvocation();
  const args = [
    ...prefix,
    "--no-session",
    "--no-approve",
    "--no-extensions",
    "--no-prompt-templates",
    "--no-skills",
    "--mode",
    "json",
    "--tools",
    TOOLS,
    "-p",
    `${prompt}${schemaNote}`,
  ];
  const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
  return trackWorker(child, opts.signal, opts.schema);
}

function trackWorker(
  child: ChildProcess,
  signal: AbortSignal | undefined,
  schema: JsonSchema | undefined,
): Promise<unknown> {
  return new Promise((resolve) => {
    const stdout = child.stdout;
    const stderr = child.stderr;
    if (stdout === null || stderr === null) {
      child.kill("SIGTERM");
      throw new Error("worker pipes unavailable");
    }
    let final: AssistantMessage | undefined;
    const record = (line: string): void => {
      try {
        const event: unknown = JSON.parse(line);
        if (!isRecord(event)) {
          return;
        }
        if (event.type === "message_start" && isAssistantMessage(event.message)) {
          final = undefined;
        }
        if (event.type === "message_end" && isAssistantMessage(event.message)) {
          final = toAssistantMessage(event.message);
        }
      } catch {
        // Non-JSON diagnostics are not assistant output.
      }
    };
    // Native UTF-8 decoding handles split code points; only the current JSONL record
    // and final assistant are retained, not every tool result from a long worker.
    let pending = "";
    stdout.setEncoding("utf8");
    stdout.on("data", (chunk: string) => {
      pending += chunk;
      let end: number;
      while ((end = pending.indexOf("\n")) >= 0) {
        record(pending.slice(0, end));
        pending = pending.slice(end + 1);
      }
    });
    stderr.resume();
    const onAbort = () => child.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });
    child.on("error", () => {
      resolve(null);
    });
    child.on("close", (code) => {
      if (pending !== "") {
        record(pending);
      }
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted === true || code !== 0 || final?.stopReason !== "stop") {
        resolve(null);
        return;
      }
      try {
        resolve(coerceResult(textOf(final), schema));
      } catch {
        resolve(null);
      }
    });
  });
}
