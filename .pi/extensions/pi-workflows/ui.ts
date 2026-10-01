import { CustomEditor, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, getKeybindings, matchesKey, SelectList, Spacer, Text } from "@earendil-works/pi-tui";
import { allow, findKeyword, isAllowed, keywordState, SIZE_HINT, type Size } from "./polish.ts";

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

export async function approvalCard(
	ctx: ExtensionContext,
	opts: { name: string; description: string; script: string; size: Size; root: string },
): Promise<{ ok: boolean; script: string }> {
	if (!ctx.hasUI || isAllowed(opts.root, opts.name)) return { ok: true, script: opts.script };
	if (ctx.mode !== "tui") {
		const ok = await ctx.ui.confirm("Run workflow", `${opts.name}\n${opts.description}`);
		return { ok, script: opts.script };
	}

	let script = opts.script;
	for (;;) {
		const choice = await ctx.ui.custom<string | undefined>((tui, theme, _kb, done) => {
			const card = new Container();
			card.addChild(new Text(theme.fg("accent", `Run workflow: ${opts.name}`), 1, 0));
			card.addChild(new Text(`${opts.description}\nSize: ${opts.size} (${SIZE_HINT[opts.size]})`, 1, 0));
			card.addChild(new Spacer(1));
			const actions = ["Once", "Always", "View", "Deny"];
			const list = new SelectList(actions.map(value => ({ value, label: value })), 4, {
				selectedPrefix: text => theme.fg("accent", text),
				selectedText: text => theme.fg("accent", text),
				description: text => theme.fg("dim", text),
				scrollInfo: text => theme.fg("dim", text),
				noMatch: text => theme.fg("dim", text),
			});
			list.onSelect = item => done(item.value);
			list.onCancel = () => done(undefined);
			let selected = 0;
			list.onSelectionChange = item => { selected = actions.indexOf(item.value); };
			card.addChild(list);
			return {
				render: width => card.render(width),
				handleMouse: event => card.handleMouse(event),
				handleInput(data) {
					const kb = getKeybindings();
					// Native actions win; legacy navigation is only a fallback.
					if (kb.matches(data, "tui.select.up") || kb.matches(data, "tui.select.down")
						|| kb.matches(data, "tui.select.confirm") || kb.matches(data, "tui.select.cancel")) {
						list.handleInput(data);
						tui.requestRender();
						return;
					}
					if (matchesKey(data, "left") || matchesKey(data, "shift+tab")) selected = (selected + 3) % 4;
					else if (matchesKey(data, "right") || matchesKey(data, "tab")) selected = (selected + 1) % 4;
					else { list.handleInput(data); tui.requestRender(); return; }
					list.setSelectedIndex(selected);
					tui.requestRender();
				},
				invalidate: () => card.invalidate(),
				dispose: () => card.clear(),
			};
		}, { overlay: true });
		if (!choice || choice === "Deny") return { ok: false, script };
		if (choice === "View") {
			const edited = await ctx.ui.editor(`Script: ${opts.name}`, script);
			if (edited !== undefined) script = edited;
			continue;
		}
		if (choice === "Always") allow(opts.root, opts.name);
		return { ok: true, script };
	}
}
