import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const SIZES = ["small", "medium", "large", "unrestricted"] as const;
export type Size = (typeof SIZES)[number];

export const SIZE_HINT: Record<Size, string> = {
	small: "fewer than 5 agents",
	medium: "fewer than 15 agents",
	large: "fewer than 50 agents",
	unrestricted: "no agent-count guideline",
};

const KEYWORD_SOURCE = String.raw`use a workflow|run a workflow|write a workflow|ultracode`;
export const KEYWORD_RE = new RegExp(`\\b(?:${KEYWORD_SOURCE})\\b`, "i");

export const STEER =
	"Write a workflow script and call the workflow tool. Do not work the task turn by turn in this session.";

export const keywordState = { dismissed: false };

export type Paint = { fg: (key: "accent" | "dim", text: string) => string };

export function parseSize(raw: string | undefined): Size | undefined {
	const value = raw?.trim().toLowerCase();
	return SIZES.includes(value as Size) ? (value as Size) : undefined;
}

export function sizeAdvice(size: Size): string {
	if (size === "unrestricted") return "Size guideline: unrestricted. Size the workflow to the task.";
	return `Size guideline: ${size} (${SIZE_HINT[size]}).`;
}

export function findKeyword(text: string): string | undefined {
	return text.match(KEYWORD_RE)?.[0];
}

export function loadSize(root: string, flag?: string): Size {
	const fromFlag = parseSize(flag);
	if (fromFlag) return fromFlag;
	const file = join(root, ".pi", "workflow-size");
	if (!existsSync(file)) return "medium";
	return parseSize(readFileSync(file, "utf8")) ?? "medium";
}

export function saveSize(root: string, size: Size): string {
	const dir = join(root, ".pi");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "workflow-size");
	writeFileSync(file, `${size}\n`);
	return file;
}

export function isAllowed(root: string, name: string): boolean {
	const file = join(root, ".pi", "workflow-allow");
	if (!existsSync(file)) return false;
	return readFileSync(file, "utf8")
		.split(/\r?\n/)
		.map((line) => line.trim())
		.includes(name);
}

export function allow(root: string, name: string): void {
	if (isAllowed(root, name)) return;
	const dir = join(root, ".pi");
	mkdirSync(dir, { recursive: true });
	const file = join(dir, "workflow-allow");
	const prev = existsSync(file) ? readFileSync(file, "utf8") : "";
	writeFileSync(file, `${prev}${prev.endsWith("\n") || prev === "" ? "" : "\n"}${name}\n`);
}

export function decorateInput(text: string, size: Size): string {
	if (keywordState.dismissed) return text;
	if (!findKeyword(text) || text.trimStart().startsWith("/")) return text;
	if (text.includes(STEER)) return text;
	return `${text}\n\n${STEER}\n${sizeAdvice(size)}`;
}

export function renderCard(
	theme: Paint,
	opts: { name: string; description: string; size: Size; selected: number },
): string[] {
	const actions = ["Once", "Always", "View", "Deny"];
	const actionLine = actions
		.map((label, i) => (i === opts.selected ? theme.fg("accent", `[ ${label} ]`) : `  ${label}  `))
		.join("");
	return [
		theme.fg("accent", "Run workflow"),
		opts.name,
		opts.description,
		`Size: ${opts.size} (${SIZE_HINT[opts.size]})`,
		"",
		actionLine,
		theme.fg("dim", "Once = this run. Always = skip this card for this name. View = read/edit the script. Deny = cancel."),
	];
}
