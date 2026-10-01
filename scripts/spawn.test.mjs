import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { spawnWorker } from "../.pi/extensions/pi-workflows/spawn.ts";

// Transport edge cases that the real provider fixture cannot produce: EOF,
// fragmented UTF-8, missing assistant records and exit/cancellation races.
test("worker accepts only the final completed assistant, never raw stdout or partial/error output", async t => {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "workflow-child-")));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const cli = join(cwd, "cli.js");
  const saved = process.argv[1];
  t.after(() => { process.argv[1] = saved; });
  process.argv[1] = cli;
  const message = (text, stopReason = "stop") => JSON.stringify({ type: "message_end", message: { role: "assistant", stopReason, content: [{ type: "text", text }] } });
  for (const [output, code, expected] of [
    ["diagnostic: done", 0, null],
    [message("old") + "\n" + message("日本語 🐎"), 0, "日本語 🐎"],
    ...["length", "error", "aborted", "toolUse"].map(reason => [message("looks successful", reason), 0, null]),
    [message("answer"), 1, null],
    [message("valid") + "\n" + message("truncated", "length"), 0, null],
    [message("old") + '\n{"type":"message_start","message":{"role":"assistant"}}\n{"type":"message_end"', 0, null],
  ]) {
    writeFileSync(cli, `const bytes = Buffer.from(${JSON.stringify(output)}); for (const byte of bytes) process.stdout.write(Buffer.from([byte])); process.exitCode = ${code};`);
    assert.equal(await spawnWorker("fixture", { cwd }), expected);
  }
  const controller = new AbortController();
  writeFileSync(cli, "setInterval(() => {}, 1000);");
  const child = spawnWorker("fixture", { cwd, signal: controller.signal });
  controller.abort();
  assert.equal(await child, null);
  writeFileSync(cli, `require('node:fs').writeFileSync(${JSON.stringify(join(cwd, "unexpected"))}, 'ran');`);
  assert.equal(await spawnWorker("fixture", { cwd, signal: controller.signal }), null);
  const { existsSync } = await import("node:fs");
  assert.equal(existsSync(join(cwd, "unexpected")), false, "A pre-aborted worker must not start");
});
