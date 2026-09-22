import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { spawnWorker } from "../.pi/extensions/pi-workflows/spawn.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageDir = fileURLToPath(new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")));
const host = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
const cli = process.env.PI_HOST_CLI ?? resolve(packageDir, host.bin.pi);
assert.equal(realpathSync(cli), realpathSync(resolve(packageDir, host.bin.pi)), "Worker CLI must match the selected SDK/types graph");
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR) assert.equal(realpathSync(packageDir), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
if (process.env.PI_COMPAT_EXPECTED_VERSION) assert.equal(host.version, process.env.PI_COMPAT_EXPECTED_VERSION);
if (process.env.PI_HOST_INDEX) assert.equal(realpathSync(process.env.PI_HOST_INDEX), realpathSync(join(packageDir, "dist/index.js")));

// One isolated project resource tree, not a fictitious `pi install` package.
test("native project discovery, command dispatch, optional tool signal and selected child CLI", { timeout: 30_000 }, async (t) => {
  t.diagnostic(JSON.stringify({ host: process.env.PI_COMPAT_HOST ?? "local", version: host.version, packageDir, cli }));
  const temp = mkdtempSync(join(tmpdir(), "pi-workflows-native-"));
  const cwd = join(temp, "project");
  const agentDir = join(temp, "agent");
  const savedEnv = Object.fromEntries(["HOME", "PI_CODING_AGENT_DIR", "PI_OFFLINE", "PI_TELEMETRY"].map((key) => [key, process.env[key]]));
  const savedArgv = process.argv[1];
  mkdirSync(cwd);
  mkdirSync(agentDir);
  cpSync(join(root, ".pi"), join(cwd, ".pi"), { recursive: true });
  process.env.HOME = temp;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_OFFLINE = "1";
  process.env.PI_TELEMETRY = "0";
  let session;
  let server;
  try {
    const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, projectTrusted: true, noContextFiles: true });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    assert.equal(loader.getExtensions().extensions.length, 1);
    const expectedSkills = readdirSync(join(cwd, ".pi/skills")).filter((name) => !name.startsWith(".")).sort();
    assert.deepEqual(loader.getSkills().skills.map(({ name }) => name).sort(), expectedSkills);
    assert.deepEqual(loader.getSkills().diagnostics, []);
    assert.deepEqual(loader.getPrompts().prompts.map(({ name }) => name).sort(), readdirSync(join(cwd, ".pi/prompts")).map((name) => name.replace(/\.md$/, "")).sort());
    assert.deepEqual(loader.getPrompts().diagnostics, []);
    // The native host discovers skills/prompts, not pi-subagents' specialist profiles.
    assert.equal(readdirSync(join(cwd, ".pi/agents")).length, 25);
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null });
    ({ session } = await createAgentSession({ cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) }));
    await session.bindExtensions({ onError(error) { throw new Error(error.error); } });
    assert.ok(session.getActiveToolNames().includes("workflow"));
    await session.prompt("/workflow-size small");
    assert.equal(readFileSync(join(cwd, ".pi/workflow-size"), "utf8"), "small\n");
    // Native context with a legal absent AbortSignal used to report an error AFTER starting a run.
    const workflow = [...loader.getExtensions().extensions[0].tools.values()]
      .find(({ definition }) => definition.name === "workflow" && definition.namespace === undefined)?.definition;
    assert.ok(workflow, "Expected the unnamespaced workflow tool");
    const result = await workflow.execute("no-signal", { script: "export const meta = { name: 'compat', description: 'local' }\nreturn 42" }, undefined, undefined, session.extensionRunner.createContext());
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(result.content[0].text, /^Started compat/);
    assert.ok(session.messages.some((message) => message.customType === "workflow-report" && JSON.stringify(message.content).includes("42")));

    const requests = [];
    server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      requests.push(JSON.parse(body));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const base = { id: "compat", object: "chat.completion.chunk", created: 1, model: "worker" };
      res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: '{"answer":42}' }, finish_reason: null }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { "compat-local": {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "fixture-only",
      models: [{ id: "worker", name: "worker", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 }],
    } } }));
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "compat-local", defaultModel: "worker", compaction: { enabled: false } }));
    // Supply the same argv[1] the real bundled Pi parent exposes. The child itself is never mocked.
    process.argv[1] = cli;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      assert.deepEqual(await spawnWorker("Return the local fixture answer", { cwd, schema: { type: "object" }, signal: controller.signal }), { answer: 42 });
    } finally { clearTimeout(timer); }
    assert.equal(requests.length, 1);
    assert.ok(JSON.stringify(requests[0].messages).includes("Return the local fixture answer"));
    assert.deepEqual(requests[0].tools.map(({ function: tool }) => tool.name).sort(), ["bash", "edit", "find", "grep", "ls", "read", "write"]);
  } finally {
    await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session?.dispose();
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    process.argv[1] = savedArgv;
    for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(temp, { recursive: true, force: true });
  }
});
