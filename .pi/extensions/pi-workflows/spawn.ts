import { spawn } from "node:child_process";
import { coerceResult, type AgentOpts } from "./runtime.ts";

const TOOLS = "read,write,edit,bash,grep,find,ls";

function piInvocation(): { cmd: string; prefix: string[] } {
	const entry = process.argv[1] ?? "";
	if (entry.endsWith("cli.js") || entry.endsWith("cli.ts") || entry.includes("coding-agent")) {
		return { cmd: process.execPath, prefix: [entry] };
	}
	return { cmd: "pi", prefix: [] };
}

function lastAssistantText(stdout: string): string {
	let text = "";
	for (const line of stdout.split(/\r?\n/)) {
		if (!line.startsWith("{")) continue;
		try {
			const event = JSON.parse(line) as { type?: string; message?: { role?: string; content?: unknown } };
			if (event.type !== "message_end" || event.message?.role !== "assistant") continue;
			text = contentText(event.message.content);
		} catch {
			// ignore a torn JSON line
		}
	}
	return text;
}

function contentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (typeof part === "string") return part;
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") return part.text;
			return "";
		})
		.join("");
}

export function spawnWorker(prompt: string, opts: AgentOpts & { cwd: string; signal?: AbortSignal }): Promise<unknown> {
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
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		const onAbort = () => child.kill("SIGTERM");
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			opts.signal?.removeEventListener("abort", onAbort);
			if (opts.signal?.aborted || code !== 0) {
				resolve(null);
				return;
			}
			try {
				resolve(coerceResult(lastAssistantText(stdout), opts.schema));
			} catch {
				resolve(null);
			}
		});
	});
}
