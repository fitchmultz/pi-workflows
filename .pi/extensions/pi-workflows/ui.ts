import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, type TUI } from "@earendil-works/pi-tui";
import {
	allow,
	findKeyword,
	isAllowed,
	keywordState,
	renderCard,
	type Size,
} from "./polish.ts";

export class KeywordEditor extends CustomEditor {
	handleInput(data: string): void {
		if (matchesKey(data, "alt+w") && findKeyword(this.getText()) && !keywordState.dismissed) {
			keywordState.dismissed = true;
			this.tui.requestRender();
			return;
		}
		super.handleInput(data);
		if (keywordState.dismissed && !findKeyword(this.getText())) keywordState.dismissed = false;
	}

	render(width: number): string[] {
		const lines = super.render(width);
		if (keywordState.dismissed) return lines;
		const hit = findKeyword(this.getText());
		if (!hit) return lines;
		const painted = `\x1b[7m${hit}\x1b[27m`;
		const re = new RegExp(hit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
		return lines.map((line) => line.replace(re, painted));
	}
}

export type CardChoice = "once" | "always" | "deny" | "view";

export async function approvalCard(
	ctx: ExtensionContext,
	opts: { name: string; description: string; script: string; size: Size; root: string },
): Promise<{ ok: boolean; script: string }> {
	if (!ctx.hasUI) return { ok: true, script: opts.script };
	if (isAllowed(opts.root, opts.name)) return { ok: true, script: opts.script };
	if (ctx.mode !== "tui") {
		const ok = await ctx.ui.confirm("Run workflow", `${opts.name}\n${opts.description}`);
		return { ok, script: opts.script };
	}

	let script = opts.script;
	for (;;) {
		const choice = await ctx.ui.custom<CardChoice | undefined>(
			(tui: TUI, theme, _kb, done) => {
				let selected = 0;
				const actions: CardChoice[] = ["once", "always", "view", "deny"];
				return {
					render: () => renderCard(theme, { ...opts, selected }),
					handleInput(data: string) {
						if (matchesKey(data, "escape")) return done("deny");
						if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) selected = (selected + 3) % 4;
						else if (matchesKey(data, "right") || matchesKey(data, "tab")) selected = (selected + 1) % 4;
						else if (matchesKey(data, "return")) return done(actions[selected]);
						tui.requestRender();
					},
					invalidate() {},
				};
			},
			{ overlay: true },
		);
		if (!choice || choice === "deny") return { ok: false, script };
		if (choice === "view") {
			const edited = await ctx.ui.editor(`Script: ${opts.name}`, script);
			if (edited !== undefined) script = edited;
			continue;
		}
		if (choice === "always") allow(opts.root, opts.name);
		return { ok: true, script };
	}
}
