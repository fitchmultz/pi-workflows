import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import xterm from "@xterm/headless";
import * as nativeTui from "@earendil-works/pi-tui";
import { CURSOR_MARKER, getKeybindings, KeybindingsManager, setKeybindings, TUI_KEYBINDINGS, TuiAltScreen, TuiMainScreen, visibleWidth } from "@earendil-works/pi-tui";
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

for (const Screen of [TuiMainScreen, TuiAltScreen]) test(`keyword editor preserves highlight and native cursor in ${Screen.name}`, async t => {
  const display = new xterm.Terminal({ cols: 40, rows: 12, allowProposedApi: true });
  const writes = [];
  const write = data => { writes.push(data); display.write(data); };
  // The same xterm backend as pi-tui's VirtualTerminal; only terminal I/O is substituted.
  const terminal = {
    columns: 40, rows: 12, kittyProtocolActive: true,
    start() {}, stop() {}, async drainInput() {},
    write,
    moveBy: lines => { if (lines) write(`\x1b[${Math.abs(lines)}${lines > 0 ? "B" : "A"}`); },
    hideCursor: () => write("\x1b[?25l"), showCursor: () => write("\x1b[?25h"),
    clearLine: () => write("\x1b[K"), clearFromCursor: () => write("\x1b[J"),
    clearScreen: () => write("\x1b[2J\x1b[H"),
    setTitle() {}, setProgress() {}, setProgramStatus() {},
  };
  const tui = new Screen(terminal);
  const identity = text => text;
  const theme = { borderColor: identity, selectList: { selectedPrefix: identity, selectedText: identity, description: identity, scrollInfo: identity, noMatch: identity } };
  const editor = new KeywordEditor(tui, theme, new KeybindingsManager(TUI_KEYBINDINGS));
  const dismissed = keywordState.dismissed;
  t.after(() => { tui.stop(); display.dispose(); keywordState.dismissed = dismissed; });
  keywordState.dismissed = false;
  editor.setText("use a workflow 日本語 x");
  editor.handleInput("\x1b[D"); // The cursor is on x, after three two-column CJK characters.
  tui.addChild(editor);
  tui.setFocus(editor);
  assert.equal(editor.focused, true, "Native focus must reach the actual CustomEditor");
  assert.equal(editor.render(40).join("").split(CURSOR_MARKER).length - 1, 1);
  tui.start();

  for (const hardware of [false, true, false]) {
    writes.length = 0;
    tui.setShowHardwareCursor(hardware);
    tui.renderNow(true);
    await new Promise(resolve => display.write("", resolve));
    const buffer = display.buffer.active;
    const line = buffer.getLine(buffer.viewportY + 1);
    assert.equal(line.translateToString(true).trimEnd(), "use a workflow 日本語 x");
    for (let col = 0; col < 14; col++) assert.ok(line.getCell(col).isInverse(), "The workflow phrase must stay highlighted");
    for (const col of [14, 21, 23]) assert.equal(Boolean(line.getCell(col).isInverse()), false, "Highlight must not bleed into adjacent cells");
    // Older supported hosts draw both cursors; marker-aware hosts suppress only the focused fake cursor.
    const fakeCursor = !hardware || typeof nativeTui.renderFakeCursor !== "function";
    assert.equal(Boolean(line.getCell(22).isInverse()), fakeCursor);
    assert.deepEqual({ x: buffer.cursorX, y: buffer.cursorY }, { x: 22, y: 1 }, "IME cursor must use terminal columns, not string offsets");
    const output = writes.join("");
    assert.ok(!output.includes("\x1b_pi:"), "Internal cursor markers must never reach the terminal");
    assert.equal([...output.matchAll(/\x1b\[\?25([hl])/g)].at(-1)?.[1], hardware ? "h" : "l");
  }

  tui.setFocus(null);
  assert.equal(editor.focused, false);
  assert.ok(!editor.render(40).join("").includes(CURSOR_MARKER), "An unfocused editor must not own the hardware cursor");
});
