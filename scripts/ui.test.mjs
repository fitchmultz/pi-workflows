import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";
import xterm from "@xterm/headless";
import {
  CURSOR_MARKER,
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
  TuiAltScreen,
  TuiMainScreen,
  visibleWidth,
} from "@earendil-works/pi-tui";
// CustomEditor routes app keys through the SDK's app KeybindingsManager
// subclass, which the package root exports only as a type, so editor
// fixtures construct that exact class rather than the pi-tui base class.
import { KeybindingsManager as SdkKeybindingsManager } from "../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js";
import { approvalCard, KeywordEditor } from "../.pi/extensions/pi-workflows/ui.ts";
import { isAllowed, keywordState } from "../.pi/extensions/pi-workflows/polish.ts";

/** @param {string} text @returns {string} */
const identity = (text) => text;

/** The result of a dialog that was never opened or never resolved a choice. */
const noChoice = /** @type {string | undefined} */ (undefined);

const identityTheme = () => ({
  borderColor: identity,
  selectList: {
    selectedPrefix: identity,
    selectedText: identity,
    description: identity,
    scrollInfo: identity,
    noMatch: identity,
  },
});

/** @param {(data: string) => void} write */
const fakeTerminal = (write) => ({
  columns: 40,
  rows: 12,
  kittyProtocolActive: true,
  start() {
    // fixture: no real terminal to start
  },
  stop() {
    // fixture: no real terminal to stop
  },
  async drainInput() {
    // fixture: no input to drain
  },
  write,
  moveBy: (/** @type {number} */ lines) => {
    if (lines !== 0) {
      write(`\x1b[${Math.abs(lines)}${lines > 0 ? "B" : "A"}`);
    }
  },
  hideCursor: () => write("\x1b[?25l"),
  showCursor: () => write("\x1b[?25h"),
  clearLine: () => write("\x1b[K"),
  clearFromCursor: () => write("\x1b[J"),
  clearScreen: () => write("\x1b[2J\x1b[H"),
  setTitle() {
    // fixture: titles are not observed
  },
  setProgress() {
    // fixture: progress is not observed
  },
  setProgramStatus() {
    // fixture: program status is not observed
  },
});

/**
 * A custom() implementation that ignores the factory and resolves from a queue.
 * @template T
 * @param {() => T | undefined} next
 * @returns {(factory: unknown) => Promise<T | undefined>}
 */
const queuedCustom =
  (next) =>
  /** @param {unknown} _factory */
  async (_factory) =>
    next();

/**
 * Drives the approval card factory directly, recording the done result.
 * @template T
 * @param {(tui: { requestRender: (force?: boolean) => void }, theme: { fg: (color: "accent" | "dim", text: string) => string }, keybindings: unknown, done: (result: T) => void) => (import("@earendil-works/pi-tui").Component & { dispose?: () => void }) | Promise<import("@earendil-works/pi-tui").Component & { dispose?: () => void }>} factory
 * @param {string[]} keys
 * @returns {Promise<T | undefined>}
 */
async function driveCard(factory, keys) {
  /** @type {T | undefined} */
  let choice;
  let completions = 0;
  const card = await factory(
    {
      requestRender() {
        // fixture: rendering is driven manually below
      },
    },
    { fg: (_color, text) => text },
    null,
    (value) => {
      choice = value;
      completions++;
    },
  );
  try {
    for (const width of [42, 100, 140]) {
      assert(card.render(width).every((line) => visibleWidth(line) <= width));
    }
    for (const key of keys) {
      card.handleInput?.(key);
    }
    assert.equal(completions, 1, "The actual card must finish exactly once");
    return choice;
  } finally {
    card.dispose?.();
  }
}

// Policy coverage lives here; native selector layout/input is inspected in an isolated CLI.
nodeTest(
  "approval preserves edited scripts, denial, cancellation and project-local Always",
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "workflow-ui-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const opts = {
      root,
      name: "audit",
      description: "Audit 日本語 routes",
      script: "original",
      size: /** @type {import("../.pi/extensions/pi-workflows/polish.ts").Size} */ ("medium"),
    };
    /** @type {Array<[Array<string | undefined>, string | undefined, boolean, string]>} */
    const cases = [
      [["Once"], undefined, true, "original"],
      [["Deny"], undefined, false, "original"],
      [[undefined], undefined, false, "original"],
      [["View", "Once"], "edited", true, "edited"],
      [["View", "Deny"], "edited", false, "edited"],
      [["View", "Once"], undefined, true, "original"],
    ];
    for (const [choices, edited, ok, expected] of cases) {
      const ctx = {
        mode: "tui",
        hasUI: true,
        ui: {
          custom: queuedCustom(() => choices.shift()),
          editor: async () => edited,
          confirm: async () => false,
        },
      };
      assert.deepEqual(await approvalCard(ctx, opts), { ok, script: expected });
      assert.equal(isAllowed(root, "audit"), false);
    }
    assert.deepEqual(
      await approvalCard(
        {
          mode: "tui",
          hasUI: true,
          ui: {
            custom: queuedCustom(() => "Always"),
            editor: async () => noChoice,
            confirm: async () => false,
          },
        },
        opts,
      ),
      { ok: true, script: "original" },
    );
    assert.equal(isAllowed(root, "audit"), true);
    assert.deepEqual(
      await approvalCard(
        {
          mode: "tui",
          hasUI: true,
          ui: {
            custom: queuedCustom(() => noChoice),
            editor: async () => noChoice,
            confirm: async () => false,
          },
        },
        opts,
      ),
      { ok: true, script: "original" },
    );
    assert.deepEqual(
      await approvalCard(
        {
          mode: "print",
          hasUI: false,
          ui: {
            custom: queuedCustom(() => noChoice),
            editor: async () => noChoice,
            confirm: async () => false,
          },
        },
        { ...opts, name: "other" },
      ),
      { ok: true, script: "original" },
    );
    assert.deepEqual(
      await approvalCard(
        {
          mode: "rpc",
          hasUI: true,
          ui: {
            custom: queuedCustom(() => noChoice),
            editor: async () => noChoice,
            confirm: async () => false,
          },
        },
        { ...opts, name: "other" },
      ),
      { ok: false, script: "original" },
    );
  },
);

nodeTest(
  "approval gives native configured actions precedence over legacy navigation",
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "workflow-ui-"));
    const previous = getKeybindings();
    t.after(() => {
      setKeybindings(previous);
      rmSync(root, { recursive: true, force: true });
    });
    /** @type {Array<[string, import("@earendil-works/pi-tui").KeybindingsConfig, string[], boolean, boolean]>} */
    const cases = [
      ["cancel-left", { "tui.select.cancel": "left" }, ["\x1b[D"], false, false],
      ["confirm-tab", { "tui.select.confirm": "tab" }, ["\t"], true, false],
      ["up-right", { "tui.select.up": "right" }, ["\x1b[C", "\r"], false, false],
      ["down-left", { "tui.select.down": "left" }, ["\x1b[D", "\r"], true, true],
      ["legacy-left", {}, ["\x1b[D", "\r"], false, false],
      ["legacy-right", {}, ["\x1b[C", "\r"], true, true],
      ["legacy-tab", {}, ["\t", "\r"], true, true],
      ["legacy-shift-tab", {}, ["\x1b[Z", "\r"], false, false],
    ];
    for (const [name, bindings, keys, ok, allowed] of cases) {
      await t.test(name, async () => {
        // The extension reads the top-level pi-tui keybindings global.
        setKeybindings(new KeybindingsManager(TUI_KEYBINDINGS, bindings));
        const ctx = {
          mode: "tui",
          hasUI: true,
          ui: {
            custom: (
              /** @type {Parameters<import("../.pi/extensions/pi-workflows/ui.ts").ApprovalContext["ui"]["custom"]>[0]} */ factory,
            ) => driveCard(factory, keys),
            editor: async () => noChoice,
            confirm: async () => false,
          },
        };
        assert.deepEqual(
          await approvalCard(ctx, {
            root,
            name,
            description: "日本語 audit 🐎",
            script: "original",
            size: "medium",
          }),
          { ok, script: "original" },
        );
        assert.equal(isAllowed(root, name), allowed);
      });
    }
  },
);

nodeTest(
  "keyword editor keeps native keys, focus, width and CJK while dismissing only the trigger",
  () => {
    /** @type {string[]} */
    const writes = [];
    const tui = new TuiMainScreen(fakeTerminal((data) => writes.push(data)));
    // The SDK manager takes user bindings over its own app+tui defaults.
    const kb = new SdkKeybindingsManager({ "app.interrupt": "ctrl+x" });
    const editor = new KeywordEditor(tui, identityTheme(), kb);
    editor.focused = true;
    editor.setText("use a workflow to audit 日本語 routes 🐎");
    keywordState.dismissed = false;
    for (const width of [32, 80, 140, 48]) {
      assert(editor.render(width).every((line) => visibleWidth(line) <= width));
    }
    editor.handleInput("\x1bw");
    assert.equal(keywordState.dismissed, true);
    assert.equal(editor.getText(), "use a workflow to audit 日本語 routes 🐎");
    let escaped = false;
    editor.onEscape = () => {
      escaped = true;
    };
    editor.handleInput("\x18");
    assert.equal(escaped, true, "Unhandled app keys still go through CustomEditor");
    editor.setText("");
    editor.handleInput("x");
    assert.equal(keywordState.dismissed, false);
    assert.equal(editor.getText(), "x");
  },
);

for (const Screen of [TuiMainScreen, TuiAltScreen]) {
  nodeTest(`keyword editor preserves highlight and native cursor in ${Screen.name}`, async (t) => {
    const display = new xterm.Terminal({ cols: 40, rows: 12, allowProposedApi: true });
    /** @type {string[]} */
    const writes = [];
    const write = (/** @type {string} */ data) => {
      writes.push(data);
      display.write(data);
    };
    // The same xterm backend as pi-tui's VirtualTerminal; only terminal I/O is substituted.
    const tui = new Screen(fakeTerminal(write));
    const editor = new KeywordEditor(tui, identityTheme(), new SdkKeybindingsManager());
    const dismissed = keywordState.dismissed;
    t.after(() => {
      tui.stop();
      display.dispose();
      keywordState.dismissed = dismissed;
    });
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
      await new Promise(
        /** @param {(value?: void) => void} resolve */ (resolve) => {
          display.write("", () => resolve());
        },
      );
      const buffer = display.buffer.active;
      const line = buffer.getLine(buffer.viewportY + 1);
      assert.ok(line !== undefined, "fixture row must exist");
      assert.equal(line.translateToString(true).trimEnd(), "use a workflow 日本語 x");
      for (let col = 0; col < 14; col++) {
        const cell = line.getCell(col);
        assert.ok(cell !== undefined, "fixture cell must exist");
        assert.ok(Boolean(cell.isInverse()), "The workflow phrase must stay highlighted");
      }
      for (const col of [14, 21, 23]) {
        const cell = line.getCell(col);
        assert.ok(cell !== undefined, "fixture cell must exist");
        assert.equal(
          Boolean(cell.isInverse()),
          false,
          "Highlight must not bleed into adjacent cells",
        );
      }
      // Pi suppresses only the focused fake cursor while the hardware cursor is visible.
      const fakeCursor = !hardware;
      const cursorCell = line.getCell(22);
      assert.ok(cursorCell !== undefined, "fixture cell must exist");
      assert.equal(Boolean(cursorCell.isInverse()), fakeCursor);
      assert.deepEqual(
        { x: buffer.cursorX, y: buffer.cursorY },
        { x: 22, y: 1 },
        "IME cursor must use terminal columns, not string offsets",
      );
      const output = writes.join("");
      assert.ok(
        !output.includes("\x1b_pi:"),
        "Internal cursor markers must never reach the terminal",
      );
      assert.equal([...output.matchAll(/\x1b\[\?25([hl])/g)].at(-1)?.[1], hardware ? "h" : "l");
    }

    tui.setFocus(null);
    assert.equal(editor.focused, false);
    assert.ok(
      !editor.render(40).join("").includes(CURSOR_MARKER),
      "An unfocused editor must not own the hardware cursor",
    );
  });
}
