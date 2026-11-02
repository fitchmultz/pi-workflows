import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import * as sdk from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { asRecord, customMessages, loopbackAddress, restoreEnv } from "./test-helpers.mjs";

const {
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} = sdk;
const root = fileURLToPath(new URL("..", import.meta.url));
const prerequisites = ["subagent", "todo_list", "ask_question", "agent_browser_web_search"];
/** @type {unknown} */
const instructionGroupsProbe = Reflect.get(sdk, "instructionGroupsExtension");
/**
 * The fork-only export cannot be structurally verified beyond being callable;
 * tests skip group cases when it is absent.
 * @param {unknown} value
 * @returns {value is import("@earendil-works/pi-coding-agent").ExtensionFactory}
 */
const isExtensionFactory = (value) => typeof value === "function";
const instructionGroupsExtension = isExtensionFactory(instructionGroupsProbe)
  ? instructionGroupsProbe
  : undefined;

/**
 * @param {unknown} value
 * @returns {value is (group: { name: string, description: string, tools: string[], instructions: () => string }) => void}
 */
const isCollector = (value) => typeof value === "function";

nodeTest(
  "native recipe admission preserves selection, discovery, branch ownership and truthful failure",
  { timeout: 30_000 },
  async (t) => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "pw-recipes-")));
    const cwd = join(temp, "project");
    const agentDir = join(temp, "agent");
    mkdirSync(cwd);
    mkdirSync(agentDir);
    cpSync(join(root, ".pi"), join(cwd, ".pi"), { recursive: true });
    const envKeys = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_PACKAGE_DIR"];
    const saved = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
    Object.assign(process.env, {
      HOME: temp,
      USERPROFILE: temp,
      PI_CODING_AGENT_DIR: agentDir,
      PI_PACKAGE_DIR: fileURLToPath(
        new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")),
      ),
    });
    /** @type {Array<Record<string, unknown>>} */
    const requests = [];
    let holdNext = false;
    /** @type {((value?: void) => void) | undefined} */
    let started;
    /** @type {((value?: void) => void) | undefined} */
    let release;
    const respond = (
      /** @type {import("node:http").IncomingMessage} */ req,
      /** @type {import("node:http").ServerResponse} */ res,
      /** @type {string} */ body,
    ) => {
      requests.push(asRecord(JSON.parse(body)));
      res.writeHead(200, { "content-type": "text/event-stream" });
      const base = {
        id: "admission",
        object: "chat.completion.chunk",
        created: 1,
        model: "parent",
      };
      res.write(
        `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Fixture response" }, finish_reason: null }] })}\n\n`,
      );
      const finish = () =>
        res.end(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        );
      if (holdNext) {
        holdNext = false;
        release = finish;
        started?.();
      } else {
        finish();
      }
    };
    const server = createServer((req, res) => {
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
    try {
      await new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          server.listen(0, "127.0.0.1", fulfill);
        },
      );
      const address = loopbackAddress(server);
      writeFileSync(
        join(agentDir, "models.json"),
        JSON.stringify({
          providers: {
            "admission-fixture": {
              api: "openai-completions",
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              apiKey: "fixture-only",
              models: [
                {
                  id: "parent",
                  name: "parent",
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
      const cases = [
        { name: "standalone", tools: [], missing: prerequisites },
        { name: "missing executor", tools: prerequisites.slice(1), missing: ["subagent"] },
        {
          name: "missing approval",
          tools: prerequisites.filter((name) => name !== "ask_question"),
          missing: ["ask_question"],
        },
        {
          name: "incompatible grouped executor",
          tools: prerequisites,
          namespace: "subagent",
          incompatible: true,
          missing: ["subagent"],
        },
        {
          name: "hidden executor",
          tools: [...prerequisites, "load_subagent"],
          hidden: "subagent",
          missing: ["subagent"],
        },
        {
          name: "excluded executor",
          tools: [...prerequisites, "load_subagent"],
          excluded: "subagent",
          missing: ["subagent"],
        },
        {
          name: "namespace grouping preserves a compatible executor's callable name",
          tools: prerequisites,
          namespace: "subagent",
          missing: [],
        },
        {
          name: "a foreign tool's namespace alias is not the executor's callable name",
          tools: prerequisites,
          foreign: "subagent",
          missing: ["subagent"],
        },
        {
          name: "inactive executor without loader",
          tools: prerequisites,
          inactive: "subagent",
          missing: ["subagent"],
        },
        {
          name: "deferred tool without discovery",
          tools: prerequisites,
          deferred: "todo_list",
          missing: ["todo_list"],
        },
        {
          name: "deferred tool with real native tool_search",
          tools: prerequisites,
          deferred: "todo_list",
          discovery: "tool_search",
          missing: [],
        },
        {
          name: "deferred tool with real native codemode",
          tools: prerequisites,
          deferred: "todo_list",
          discovery: "codemode",
          missing: [],
        },
        {
          name: "cold lazy executor",
          tools: [...prerequisites, "load_subagent"],
          inactive: "subagent",
          missing: [],
        },
        { name: "active executor and native browser namespace", tools: prerequisites, missing: [] },
        {
          name: "stale instruction entry without discovery",
          tools: prerequisites,
          inactive: "agent_browser_web_search",
          stale: true,
          missing: ["agent_browser_web_search"],
        },
        {
          name: "excluded tool cannot be admitted by stale discovery state",
          tools: prerequisites,
          excluded: "agent_browser_web_search",
          stale: true,
          groups: true,
          missing: ["agent_browser_web_search"],
        },
        {
          name: "real fork group deferral, latest array and current branch",
          tools: prerequisites,
          discovery: "codemode",
          groups: true,
          missing: [],
        },
        {
          name: "denial during a streaming turn is context-only, never steering",
          tools: [],
          streaming: true,
          missing: prerequisites,
        },
      ];
      for (const config of cases) {
        await t.test(
          config.name,
          {
            skip:
              config.groups === true && instructionGroupsExtension === undefined
                ? "Fork-only real instructionGroupsExtension is not exported by this official host"
                : false,
          },
          async () => {
            let forwarded = 0;
            let effects = 0;
            /** @type {import("@earendil-works/pi-coding-agent").ExtensionAPI | undefined} */
            let controls;
            /** @type {Map<string, import("@earendil-works/pi-coding-agent").ToolDefinition>} */
            const definitions = new Map();
            const settingsManager = SettingsManager.inMemory({
              compaction: { enabled: false },
              retry: { enabled: false },
            });
            const loader = new DefaultResourceLoader({
              cwd,
              agentDir,
              settingsManager,
              noContextFiles: true,
              extensionFactories: [
                ...(config.discovery === "tool_search" ? [createToolSearchExtension()] : []),
                ...(config.discovery === "codemode" ? [createCodemodeExtension()] : []),
                ...(config.groups === true && instructionGroupsExtension !== undefined
                  ? [instructionGroupsExtension]
                  : []),
                (pi) => {
                  controls = pi;
                  for (const name of config.tools) {
                    /** @type {import("@earendil-works/pi-coding-agent").ToolDefinition} */
                    const definition = {
                      name: config.foreign === name ? "other_provider_subagent" : name,
                      label: name,
                      description: "Capability fixture",
                      ...(config.hidden === name ? { exposure: "hidden" } : {}),
                      ...(config.deferred === name ? { exposure: "deferred" } : {}),
                      ...(name === "agent_browser_web_search"
                        ? {
                            namespace: {
                              name: "browser",
                              description: "Browser commands and optional web search.",
                              instructions:
                                "Optional web search is available only when configured.",
                            },
                          }
                        : {}),
                      ...(config.namespace === name
                        ? { namespace: { name: "other-provider" } }
                        : {}),
                      ...(config.foreign === name
                        ? { namespace: { name: "other-provider", aliases: ["subagent"] } }
                        : {}),
                      ...(config.inactive === name ? { defaultActive: false } : {}),
                      parameters:
                        name === "subagent" && config.incompatible !== true
                          ? Type.Object({
                              agent: Type.String(),
                              task: Type.String(),
                              label: Type.Optional(Type.String()),
                              tasks: Type.Optional(
                                Type.Array(
                                  Type.Object({ agent: Type.String(), task: Type.String() }),
                                ),
                              ),
                            })
                          : Type.Object({}),
                      async execute() {
                        effects++;
                        throw new Error("Admission must not execute integration tools");
                      },
                    };
                    definitions.set(name, definition);
                    pi.registerTool(definition);
                  }
                  if (config.groups === true) {
                    pi.events.on("pi:instruction-groups", (/** @type {unknown} */ data) => {
                      const collector = asRecord(data);
                      const register = collector.register;
                      if (!isCollector(register)) {
                        throw new Error("instruction-groups collector contract");
                      }
                      register({
                        name: "browser",
                        description: "Browser capability fixture",
                        tools: ["agent_browser_web_search"],
                        instructions: () =>
                          "Read these browser instructions before using the fixture search capability.",
                      });
                    });
                  }
                  if (config.discovery !== undefined) {
                    pi.on("session_start", () =>
                      pi.setActiveTools([...pi.getActiveTools(), config.discovery]),
                    );
                  }
                  // Observe admitted recipes after the production handler, without executing a recipe.
                  pi.on("input", (event) => {
                    if (!/^\/(?:skill:)?recipe-/.test(event.text)) {
                      return { action: "continue" };
                    }
                    forwarded++;
                    return { action: "handled" };
                  });
                },
              ],
            });
            await loader.reload();
            assert.deepEqual(loader.getExtensions().errors, []);
            assert.ok(controls !== undefined, "fixture extension must have initialized");
            const modelRuntime = await ModelRuntime.create({
              authPath: join(agentDir, "auth.json"),
              modelsPath: join(agentDir, "models.json"),
              allowModelNetwork: false,
            });
            const model = modelRuntime.getModel("admission-fixture", "parent");
            assert.ok(model, "Only the credential-free loopback model may run");
            const sessionManager = SessionManager.inMemory(cwd);
            const { session } = await createAgentSession({
              cwd,
              agentDir,
              settingsManager,
              resourceLoader: loader,
              modelRuntime,
              model,
              sessionManager,
              ...(config.excluded !== undefined ? { excludeTools: [config.excluded] } : {}),
            });
            /** @type {unknown[]} */
            const errors = [];
            const admit = async (
              /** @type {string} */ command,
              /** @type {string[]} */ missing,
            ) => {
              const previousExitCode = process.exitCode;
              const failuresBefore = customMessages(session.messages, "recipe-unavailable").length;
              const forwardedBefore = forwarded;
              try {
                await session.prompt(command);
                assert.equal(
                  process.exitCode,
                  missing.length > 0 ? 1 : previousExitCode,
                  "SDK consumers must receive the print failure status",
                );
                const failures = customMessages(session.messages, "recipe-unavailable");
                const last = failures.at(-1);
                assert.equal(
                  failures.length - failuresBefore,
                  missing.length > 0 ? 1 : 0,
                  JSON.stringify(last?.details),
                );
                assert.equal(forwarded - forwardedBefore, missing.length > 0 ? 0 : 1);
                if (missing.length > 0) {
                  assert.ok(last !== undefined, "recipe-unavailable must be recorded");
                  assert.deepEqual(asRecord(last.details).missing, missing);
                  assert.match(JSON.stringify(last.content), /not started.*scripted.*workflow/i);
                }
              } finally {
                process.exitCode = previousExitCode;
              }
            };
            try {
              await session.bindExtensions({
                mode: "print",
                onError(error) {
                  errors.push(error);
                },
              });
              if (config.stale === true) {
                sessionManager.appendCustomEntry("pi:instruction-groups", {
                  inactive: ["agent_browser_web_search"],
                });
              }
              if (config.groups === true && config.stale !== true) {
                await admit("/recipe-task before deferral", []);
                const requestsBefore = requests.length;
                await session.prompt("Complete one ordinary fixture turn.");
                assert.equal(requests.length, requestsBefore + 1);
                assert.ok(session.getActiveToolNames().includes("discover_tools"));
                assert.equal(
                  session.getActiveToolNames().includes("agent_browser_web_search"),
                  false,
                );
                const nativeEntry = sessionManager
                  .getBranch()
                  .flatMap((entry) =>
                    entry.type === "custom" && entry.customType === "pi:instruction-groups"
                      ? [entry]
                      : [],
                  )
                  .at(-1);
                assert.ok(nativeEntry !== undefined, "native deferral entry must be recorded");
                assert.deepEqual(
                  asRecord(nativeEntry.data).inactive,
                  ["agent_browser_web_search"],
                  "The real builtin, not the fixture, must publish the deferral",
                );
              }
              if (config.streaming === true) {
                const requestsBefore = requests.length;
                holdNext = true;
                const requested = new Promise((resolve) => {
                  started = resolve;
                });
                const turn = session.prompt("Hold one ordinary fixture response.");
                await requested;
                const previousExitCode = process.exitCode;
                try {
                  await session.prompt("/recipe-task unavailable during streaming", {
                    streamingBehavior: "steer",
                  });
                  assert.deepEqual(
                    session.agent.peekQueuedMessages(),
                    [],
                    "A refused recipe must not steer an unrelated running turn",
                  );
                  assert.equal(process.exitCode, 1);
                } finally {
                  process.exitCode = previousExitCode;
                  assert.ok(release !== undefined, "held response must be registered");
                  release();
                  await turn;
                }
                assert.equal(
                  requests.length,
                  requestsBefore + 1,
                  "The diagnostic must not trigger a follow-up model request",
                );
                const unavailable = customMessages(session.messages, "recipe-unavailable")[0];
                assert.ok(unavailable !== undefined, "recipe-unavailable must be recorded");
                assert.deepEqual(asRecord(unavailable.details).missing, prerequisites);
              } else {
                for (const command of [
                  "/recipe-review docs/design/example.md",
                  "/skill:recipe-task fix the example",
                ]) {
                  await admit(command, config.missing);
                }
              }
              if (config.groups === true && config.stale !== true) {
                const nativeLeaf = sessionManager.getLeafId();
                assert.ok(nativeLeaf !== null, "branch leaf must exist");
                controls.setActiveTools(
                  controls.getActiveTools().filter((name) => name !== "todo_list"),
                );
                await admit("/recipe-task user inactive", ["todo_list"]);
                controls.setActiveTools([...controls.getActiveTools(), "todo_list"]);
                sessionManager.appendCustomEntry("pi:instruction-groups", {
                  inactive: "invalid latest value",
                });
                await admit("/recipe-task latest array survives malformed entry", []);
                sessionManager.appendCustomEntry("pi:instruction-groups", {
                  inactive: [null, 17, {}],
                });
                await admit("/recipe-task latest array replaces earlier and filters nonstrings", [
                  "agent_browser_web_search",
                ]);
                sessionManager.branch(nativeLeaf);
                session.refreshContext();
                await admit("/recipe-task abandoned branch does not retire current deferral", []);
                controls.setActiveTools(
                  controls.getActiveTools().filter((name) => name !== "discover_tools"),
                );
                await admit("/recipe-task inactive discovery cannot restore", [
                  "agent_browser_web_search",
                ]);
                controls.setActiveTools([...controls.getActiveTools(), "discover_tools"]);
                const browserDefinition = definitions.get("agent_browser_web_search");
                assert.ok(browserDefinition !== undefined, "browser fixture must be registered");
                controls.registerTool({ ...browserDefinition, exposure: "hidden" });
                await admit("/recipe-task withdrawn registration cannot be restored", [
                  "agent_browser_web_search",
                ]);
              }
              assert.equal(effects, 0);
              assert.deepEqual(errors, []);
            } finally {
              await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
              session.dispose();
            }
          },
        );
      }

      await t.test("unrelated prompt and skill namesakes remain usable", async () => {
        const otherPrompt = join(temp, "recipe-review.md");
        const otherSkill = join(temp, "SKILL.md");
        writeFileSync(otherPrompt, "---\ndescription: Other review\n---\nReview independently.\n");
        writeFileSync(
          otherSkill,
          "---\nname: recipe-task\ndescription: Other task\n---\nExecute independently.\n",
        );
        let forwarded = 0;
        const settingsManager = SettingsManager.inMemory();
        const loader = new DefaultResourceLoader({
          cwd,
          agentDir,
          settingsManager,
          noContextFiles: true,
          noSkills: true,
          noPromptTemplates: true,
          additionalSkillPaths: [otherSkill],
          additionalPromptTemplatePaths: [otherPrompt],
          extensionFactories: [
            (pi) => {
              pi.on("input", () => {
                forwarded++;
                return { action: "handled" };
              });
            },
          ],
        });
        await loader.reload();
        const modelRuntime = await ModelRuntime.create({
          authPath: join(agentDir, "auth.json"),
          modelsPath: null,
          allowModelNetwork: false,
        });
        const { session } = await createAgentSession({
          cwd,
          agentDir,
          settingsManager,
          resourceLoader: loader,
          modelRuntime,
          sessionManager: SessionManager.inMemory(cwd),
        });
        try {
          await session.bindExtensions({ mode: "print" });
          await session.prompt("/recipe-review independently");
          await session.prompt("/skill:recipe-task independently");
          assert.equal(forwarded, 2);
          assert.equal(
            session.messages.some(
              (message) => message.role === "custom" && message.customType === "recipe-unavailable",
            ),
            false,
          );
        } finally {
          await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
          session.dispose();
        }
      });
    } finally {
      server.closeAllConnections();
      await new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          server.close(() => fulfill());
        },
      );
      restoreEnv(saved);
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
