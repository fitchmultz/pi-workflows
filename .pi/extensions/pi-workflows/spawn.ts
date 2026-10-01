import { spawn } from "node:child_process";
import { coerceResult, type AgentOpts } from "./runtime.ts";

const TOOLS = "read,write,edit,bash,grep,find,ls";

function piInvocation(): { cmd: string; prefix: string[] } {
	const entry = process.argv[1] ?? "";
	if (entry.endsWith("cli.js") || entry.endsWith("cli.ts")) {
		return { cmd: process.execPath, prefix: [entry] };
	}
	return { cmd: "pi", prefix: [] };
}

export function spawnWorker(prompt: string, opts: AgentOpts & { cwd: string; signal?: AbortSignal }): Promise<unknown> {
	if (opts.signal?.aborted) return Promise.resolve(null);
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
		let pending = "";
		let final: { stopReason?: string; content?: Array<{ type?: string; text?: string }> } | undefined;
		const record = (line: string) => {
			try {
				const event = JSON.parse(line);
				if (event.type === "message_start" && event.message?.role === "assistant") final = undefined;
				if (event.type === "message_end" && event.message?.role === "assistant") final = event.message;
			} catch {
				// Non-JSON diagnostics are not assistant output.
			}
		};
		// Native UTF-8 decoding handles split code points; only the current JSONL record
		// and final assistant are retained, not every tool result from a long worker.
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			pending += chunk;
			let end: number;
			while ((end = pending.indexOf("\n")) >= 0) {
				record(pending.slice(0, end));
				pending = pending.slice(end + 1);
			}
		});
		child.stderr.resume();
		const onAbort = () => child.kill("SIGTERM");
		opts.signal?.addEventListener("abort", onAbort, { once: true });
		child.on("error", () => resolve(null));
		child.on("close", (code) => {
			opts.signal?.removeEventListener("abort", onAbort);
			if (pending) record(pending);
			if (opts.signal?.aborted || code !== 0 || final?.stopReason !== "stop") {
				resolve(null);
				return;
			}
			try {
				const text = final.content?.filter(part => part.type === "text").map(part => part.text ?? "").join("") ?? "";
				resolve(coerceResult(text, opts.schema));
			} catch {
				resolve(null);
			}
		});
	});
}
