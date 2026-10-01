import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { approvalCard, KeywordEditor } from "../.pi/extensions/pi-workflows/ui.ts";
import { isAllowed, keywordState } from "../.pi/extensions/pi-workflows/polish.ts";

// Policy coverage lives here; native selector layout/input is inspected in an isolated CLI.
test("approval preserves edited scripts, denial, cancellation and project-local Always", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-ui-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const opts = { root, name: "audit", description: "Audit 日本語 routes", script: "original", size: "medium" };
  for (const [choices, edited, ok, expected] of [
    [["Once"], undefined, true, "original"],
    [["Deny"], undefined, false, "original"],
    [[undefined], undefined, false, "original"],
    [["View", "Once"], "edited", true, "edited"],
    [["View", "Deny"], "edited", false, "edited"],
    [["View", "Once"], undefined, true, "original"],
  ]) {
    const ctx = { mode: "tui", hasUI: true, ui: {
      custom: async () => choices.shift(), editor: async () => edited,
    } };
    assert.deepEqual(await approvalCard(ctx, opts), { ok, script: expected });
    assert.equal(isAllowed(root, "audit"), false);
  }
  assert.deepEqual(await approvalCard({ mode: "tui", hasUI: true, ui: { custom: async () => "Always" } }, opts), { ok: true, script: "original" });
  assert.equal(isAllowed(root, "audit"), true);
  assert.deepEqual(await approvalCard({ mode: "tui", hasUI: true, ui: {} }, opts), { ok: true, script: "original" });
  assert.deepEqual(await approvalCard({ mode: "print", hasUI: false, ui: {} }, { ...opts, name: "other" }), { ok: true, script: "original" });
  assert.deepEqual(await approvalCard({ mode: "rpc", hasUI: true, ui: { confirm: async () => false } }, { ...opts, name: "other" }), { ok: false, script: "original" });
});

test("approval gives native configured actions precedence over legacy navigation", async t => {
  const root = mkdtempSync(join(tmpdir(), "workflow-keys-"));
  const previous = getKeybindings();
  t.after(() => { setKeybindings(previous); rmSync(root, { recursive: true, force: true }); });
  for (const [name, bindings, keys, ok, allowed] of [
    ["cancel-left", { "tui.select.cancel": "left" }, ["\x1b[D"], false, false],
    ["confirm-tab", { "tui.select.confirm": "tab" }, ["\t"], true, false],
    ["up-right", { "tui.select.up": "right" }, ["\x1b[C", "\r"], false, false],
    ["down-left", { "tui.select.down": "left" }, ["\x1b[D", "\r"], true, true],
    ["legacy-left", {}, ["\x1b[D", "\r"], false, false],
    ["legacy-right", {}, ["\x1b[C", "\r"], true, true],
    ["legacy-tab", {}, ["\t", "\r"], true, true],
    ["legacy-shift-tab", {}, ["\x1b[Z", "\r"], false, false],
  ]) await t.test(name, async () => {
    const kb = new KeybindingsManager(TUI_KEYBINDINGS, bindings);
    setKeybindings(kb);
    const ctx = { mode: "tui", hasUI: true, ui: {
      custom: async factory => {
        let choice;
        let completions = 0;
        const card = await factory({ requestRender() {} }, { fg: (_color, text) => text }, kb,
          value => { choice = value; completions++; });
        try {
          for (const width of [42, 100, 140]) assert(card.render(width).every(line => visibleWidth(line) <= width));
          for (const key of keys) card.handleInput(key);
          assert.equal(completions, 1, "The actual card must finish exactly once");
          return choice;
        } finally { card.dispose(); }
      },
    } };
    assert.deepEqual(await approvalCard(ctx, { root, name, description: "日本語 audit 🐎", script: "original", size: "medium" }), { ok, script: "original" });
    assert.equal(isAllowed(root, name), allowed);
  });
});

test("keyword editor keeps native keys, focus, width and CJK while dismissing only the trigger", () => {
  const identity = text => text;
  const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
  const kb = new KeybindingsManager({ ...TUI_KEYBINDINGS, "app.interrupt": { defaultKeys: "ctrl+x", description: "Configured app interrupt" } });
  const editor = new KeywordEditor({ terminal: { rows: 24, columns: 80 }, requestRender() {} }, theme, kb);
  editor.focused = true;
  editor.setText("use a workflow to audit 日本語 routes 🐎");
  keywordState.dismissed = false;
  for (const width of [32, 80, 140, 48]) assert(editor.render(width).every(line => visibleWidth(line) <= width));
  editor.handleInput("\x1bw");
  assert.equal(keywordState.dismissed, true);
  assert.equal(editor.getText(), "use a workflow to audit 日本語 routes 🐎");
  let escaped = false;
  editor.onEscape = () => { escaped = true; };
  editor.handleInput("\x18");
  assert.equal(escaped, true, "Unhandled app keys still go through CustomEditor");
  editor.setText("");
  editor.handleInput("x");
  assert.equal(keywordState.dismissed, false);
  assert.equal(editor.getText(), "x");
});
