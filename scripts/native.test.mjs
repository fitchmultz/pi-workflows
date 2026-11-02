import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { spawnWorker } from "../.pi/extensions/pi-workflows/spawn.ts";
import {
  asArray,
  asRecord,
  asString,
  customMessages,
  firstText,
  loopbackAddress,
  restoreEnv,
} from "./test-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageDir = fileURLToPath(
  new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")),
);
const host = asRecord(JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")));
const cli = process.env.PI_HOST_CLI ?? resolve(packageDir, asString(asRecord(host.bin).pi));
assert.equal(
  realpathSync(cli),
  realpathSync(resolve(packageDir, asString(asRecord(host.bin).pi))),
  "Worker CLI must match the selected SDK/types graph",
);
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR !== undefined) {
  assert.equal(realpathSync(packageDir), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}
if (process.env.PI_COMPAT_EXPECTED_VERSION !== undefined) {
  assert.equal(asString(host.version), process.env.PI_COMPAT_EXPECTED_VERSION);
}
if (process.env.PI_HOST_INDEX !== undefined) {
  assert.equal(
    realpathSync(process.env.PI_HOST_INDEX),
    realpathSync(join(packageDir, "dist/index.js")),
  );
}

/** @param {Array<Record<string, unknown>>} requests @param {number} index @returns {string[]} */
const toolNamesAt = (requests, index) => {
  const request = requests[index];
  assert.ok(request !== undefined, "worker request must be recorded");
  return asArray(request.tools)
    .map((entry) => asString(asRecord(asRecord(entry).function).name))
    .sort();
};

// One isolated project resource tree, not a fictitious `pi install` package.
nodeTest(
  "native project discovery, command dispatch, optional tool signal and selected child CLI",
  { timeout: 30_000 },
  async (t) => {
    t.diagnostic(
      JSON.stringify({
        host: process.env.PI_COMPAT_HOST ?? "local",
        version: asString(host.version),
        packageDir,
        cli,
      }),
    );
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "pi-workflows-native-")));
    const cwd = join(temp, "project");
    const agentDir = join(temp, "agent");
    const savedEnv = Object.fromEntries(
      ["HOME", "PI_CODING_AGENT_DIR", "PI_PACKAGE_DIR", "PI_OFFLINE", "PI_TELEMETRY"].map((key) => [
        key,
        process.env[key],
      ]),
    );
    const savedArgv = process.argv[1];
    mkdirSync(cwd);
    mkdirSync(agentDir);
    cpSync(join(root, ".pi"), join(cwd, ".pi"), { recursive: true });
    process.env.HOME = temp;
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.PI_PACKAGE_DIR = packageDir;
    process.env.PI_OFFLINE = "1";
    process.env.PI_TELEMETRY = "0";
    /** @type {import("@earendil-works/pi-coding-agent").AgentSession | undefined} */
    let session;
    /** @type {import("node:http").Server | undefined} */
    let server;
    try {
      const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false } });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noContextFiles: true,
      });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      assert.equal(loader.getExtensions().extensions.length, 1);
      const expectedSkills = readdirSync(join(cwd, ".pi/skills"))
        .filter((name) => !name.startsWith("."))
        .sort();
      assert.deepEqual(
        loader
          .getSkills()
          .skills.map(({ name }) => name)
          .sort(),
        expectedSkills,
      );
      assert.deepEqual(loader.getSkills().diagnostics, []);
      assert.deepEqual(
        loader
          .getPrompts()
          .prompts.map(({ name }) => name)
          .sort(),
        readdirSync(join(cwd, ".pi/prompts"))
          .map((name) => name.replace(/\.md$/, ""))
          .sort(),
      );
      assert.deepEqual(loader.getPrompts().diagnostics, []);
      // The native host discovers skills/prompts, not pi-subagents' specialist profiles.
      assert.equal(readdirSync(join(cwd, ".pi/agents")).length, 25);
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
      });
      ({ session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        settingsManager,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
      }));
      /** @type {unknown[]} */
      const extensionErrors = [];
      await session.bindExtensions({
        mode: "print",
        onError(error) {
          extensionErrors.push(error);
        },
      });
      assert.ok(session.getActiveToolNames().includes("workflow"));
      await session.prompt("/workflow-size small");
      assert.equal(readFileSync(join(cwd, ".pi/workflow-size"), "utf8"), "small\n");
      // Native context with a legal absent AbortSignal used to report an error AFTER starting a run.
      const workflowTool = loader.getExtensions().extensions[0]?.tools;
      assert.ok(workflowTool !== undefined, "Expected the installed extension's tool registry");
      const workflow = [...workflowTool.values()].find(
        ({ definition }) => definition.name === "workflow" && definition.namespace === undefined,
      )?.definition;
      assert.ok(workflow !== undefined, "Expected the unnamespaced workflow tool");
      const result = await workflow.execute(
        "no-signal",
        { script: "export const meta = { name: 'compat', description: 'local' }\nreturn 42" },
        undefined,
        undefined,
        // oxlint-disable-next-line unicorn/no-useless-undefined -- a legally absent AbortSignal is exactly what these runs must pass
        session.extensionRunner.createToolContext("no-signal", undefined),
      );
      await new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          setImmediate(fulfill);
        },
      );
      assert.match(firstText(result.content), /^Started compat/);
      assert.ok(
        session.messages.some(
          (message) =>
            message.role === "custom" &&
            message.customType === "workflow-report" &&
            JSON.stringify(message.content).includes("42"),
        ),
      );

      /** @type {Array<Record<string, unknown>>} */
      const requests = [];
      let finishReason = "stop";
      /** @type {((value?: void) => void) | undefined} */
      let stalled;
      const respond = (
        /** @type {import("node:http").IncomingMessage} */ req,
        /** @type {import("node:http").ServerResponse} */ res,
        /** @type {string} */ body,
      ) => {
        requests.push(asRecord(JSON.parse(body)));
        if (stalled !== undefined) {
          stalled();
          return;
        }
        res.writeHead(200, { "content-type": "text/event-stream" });
        const base = { id: "compat", object: "chat.completion.chunk", created: 1, model: "worker" };
        res.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: '{"answer":42}' }, finish_reason: null }] })}\n\n`,
        );
        res.end(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\ndata: [DONE]\n\n`,
        );
      };
      server = createServer((req, res) => {
        /** @type {string} */
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (/** @type {string} */ chunk) => {
          body += chunk;
        });
        req.on("end", () => {
          respond(req, res, body);
        });
      });
      const fixtureServer = server;
      await new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          fixtureServer.listen(0, "127.0.0.1", fulfill);
        },
      );
      const address = loopbackAddress(fixtureServer);
      writeFileSync(
        join(agentDir, "models.json"),
        JSON.stringify({
          providers: {
            "compat-local": {
              api: "openai-completions",
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              apiKey: "fixture-only",
              models: [
                {
                  id: "worker",
                  name: "worker",
                  reasoning: false,
                  input: ["text"],
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                  contextWindow: 128000,
                  maxTokens: 1000,
                },
              ],
            },
          },
        }),
      );
      writeFileSync(
        join(agentDir, "settings.json"),
        JSON.stringify({
          defaultProvider: "compat-local",
          defaultModel: "worker",
          compaction: { enabled: false },
          retry: { enabled: false },
          providerRetry: { maxRetries: 0 },
        }),
      );
      // Supply the same argv[1] the real bundled Pi parent exposes. The child itself is never mocked.
      process.argv[1] = cli;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      try {
        assert.deepEqual(
          await spawnWorker("Return the local fixture answer", {
            cwd,
            schema: { type: "object" },
            signal: controller.signal,
          }),
          { answer: 42 },
        );
      } finally {
        clearTimeout(timer);
      }
      assert.equal(requests.length, 1);
      assert.ok(JSON.stringify(requests[0]).includes("Return the local fixture answer"));
      assert.deepEqual(toolNamesAt(requests, 0), [
        "bash",
        "edit",
        "find",
        "grep",
        "ls",
        "read",
        "write",
      ]);
      await workflow.execute(
        "native-fanout",
        {
          script:
            "export const meta = { name: 'native-fanout', description: 'standalone workers' }\nreturn await pipeline(['first', 'second'], task => agent(task, { schema: { type: 'object' } }))",
        },
        undefined,
        undefined,
        // oxlint-disable-next-line unicorn/no-useless-undefined -- a legally absent AbortSignal is exactly what these runs must pass
        session.extensionRunner.createToolContext("native-fanout", undefined),
      );
      const isFanoutReport = (
        /** @type {import("@earendil-works/pi-coding-agent").AgentSession["messages"][number]} */ message,
      ) =>
        message.role === "custom" &&
        message.customType === "workflow-report" &&
        message.details !== undefined &&
        asRecord(message.details).name === "native-fanout";
      const deadline = Date.now() + 15_000;
      while (!session.messages.some(isFanoutReport) && Date.now() < deadline) {
        await new Promise(
          /** @param {(value?: void) => void} fulfill */ (fulfill) => {
            setTimeout(fulfill, 20);
          },
        );
      }
      const fanout = customMessages(session.messages, "workflow-report").find(
        (message) =>
          message.details !== undefined && asRecord(message.details).name === "native-fanout",
      );
      assert.ok(
        fanout !== undefined,
        "The standalone workflow tool must complete both native workers",
      );
      assert.equal((JSON.stringify(fanout.content).match(/answer/g) ?? []).length, 2);
      assert.equal(requests.length, 3);
      for (const request of requests) {
        assert.deepEqual(
          asArray(request.tools)
            .map((entry) => asString(asRecord(asRecord(entry).function).name))
            .sort(),
          ["bash", "edit", "find", "grep", "ls", "read", "write"],
        );
      }
      finishReason = "length";
      assert.equal(
        await spawnWorker("Return the partial fixture", { cwd }),
        null,
        "Length-limited JSON is not a completed answer",
      );
      assert.equal(
        (
          await workflow.execute(
            "invalid",
            { script: "not a workflow" },
            undefined,
            undefined,
            // oxlint-disable-next-line unicorn/no-useless-undefined -- a legally absent AbortSignal is exactly what these runs must pass
            session.extensionRunner.createToolContext("invalid", undefined),
          )
        ).isError,
        true,
      );
      // Exercise shutdown with a real still-running child; no handler may retain a
      // session-bound UI/report callback after the awaited shutdown boundary.
      const requested = new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          stalled = fulfill;
        },
      );
      await workflow.execute(
        "shutdown",
        {
          script:
            "export const meta = { name: 'pending', description: 'local' }\nreturn await agent('wait')",
        },
        undefined,
        undefined,
        // oxlint-disable-next-line unicorn/no-useless-undefined -- a legally absent AbortSignal is exactly what these runs must pass
        session.extensionRunner.createToolContext("shutdown", undefined),
      );
      await requested;
      // The host emits a valid shutdown reason; the extension ignores its value, and
      // "new" is the closest semantic to switching away mid-run.
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "new" });
      const isPendingReport = (
        /** @type {import("@earendil-works/pi-coding-agent").AgentSession["messages"][number]} */ message,
      ) =>
        message.role === "custom" &&
        message.customType === "workflow-report" &&
        message.details !== undefined &&
        asRecord(message.details).name === "pending";
      assert(!session.messages.some(isPendingReport));
      /** @type {string[]} */
      const notices = [];
      const workflows = loader.getExtensions().extensions[0]?.commands.get("workflows");
      assert.ok(workflows !== undefined, "Expected the workflows command");
      // Drive the real command context; only the two dialog methods are scripted.
      const commandContext = session.extensionRunner.createCommandContext();
      commandContext.ui.select = async (title, options) =>
        title === "Workflow runs" ? options.find((label) => label.includes("pending")) : "View";
      commandContext.ui.notify = (text) => {
        notices.push(text);
      };
      await workflows.handler("", { ...commandContext, hasUI: true, mode: "rpc" });
      assert.deepEqual(
        notices,
        ["Workflow pending paused."],
        "Viewing paused work must not claim it finished",
      );
      assert.deepEqual(extensionErrors, []);
    } finally {
      await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session?.dispose();
      if (server) {
        const openServer = server;
        openServer.closeAllConnections();
        await new Promise(
          /** @param {(value?: void) => void} fulfill */ (fulfill) => {
            openServer.close(() => fulfill());
          },
        );
      }
      if (savedArgv !== undefined) {
        process.argv[1] = savedArgv;
      }
      restoreEnv(savedEnv);
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
