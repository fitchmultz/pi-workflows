import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as sdk from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const { createAgentSession, createCodemodeExtension, createToolSearchExtension, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = sdk;
const root = fileURLToPath(new URL("..", import.meta.url));
const prerequisites = ["subagent", "todo_list", "ask_question", "agent_browser_web_search"];

test("native recipe admission preserves selection, discovery, branch ownership and truthful failure", { timeout: 30_000 }, async (t) => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "pw-recipes-")));
  const cwd = join(temp, "project");
  const agentDir = join(temp, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  cpSync(join(root, ".pi"), join(cwd, ".pi"), { recursive: true });
  const envKeys = ["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_PACKAGE_DIR"];
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { HOME: temp, USERPROFILE: temp, PI_CODING_AGENT_DIR: agentDir,
    PI_PACKAGE_DIR: fileURLToPath(new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent"))) });
  const requests = [];
  let holdNext = false;
  let started;
  let release;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const base = { id: "admission", object: "chat.completion.chunk", created: 1, model: "parent" };
    res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "Fixture response" }, finish_reason: null }] })}\n\n`);
    const finish = () => res.end(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    if (holdNext) { holdNext = false; release = finish; started(); }
    else finish();
  });
  try {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { "admission-fixture": {
      api: "openai-completions", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: "fixture-only",
      models: [{ id: "parent", name: "parent", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 }],
    } } }));
    const cases = [
      { name: "standalone", tools: [], missing: prerequisites },
      { name: "missing executor", tools: prerequisites.slice(1), missing: ["subagent"] },
      { name: "missing approval", tools: prerequisites.filter(name => name !== "ask_question"), missing: ["ask_question"] },
      { name: "incompatible executor", tools: prerequisites, incompatible: true, missing: ["subagent"] },
      { name: "hidden executor", tools: [...prerequisites, "load_subagent"], hidden: "subagent", missing: ["subagent"] },
      { name: "excluded executor", tools: [...prerequisites, "load_subagent"], excluded: "subagent", missing: ["subagent"] },
      { name: "namespaced namesake is not the executor", tools: prerequisites, namespace: "subagent", missing: ["subagent"] },
      { name: "inactive executor without loader", tools: prerequisites, inactive: "subagent", missing: ["subagent"] },
      { name: "deferred tool without discovery", tools: prerequisites, deferred: "todo_list", missing: ["todo_list"] },
      { name: "deferred tool with real native tool_search", tools: prerequisites, deferred: "todo_list", discovery: "tool_search", missing: [] },
      { name: "deferred tool with real native codemode", tools: prerequisites, deferred: "todo_list", discovery: "codemode", missing: [] },
      { name: "cold lazy executor", tools: [...prerequisites, "load_subagent"], inactive: "subagent", missing: [] },
      { name: "active executor", tools: prerequisites, missing: [] },
      { name: "stale instruction entry without discovery", tools: prerequisites, inactive: "agent_browser_web_search", stale: true, missing: ["agent_browser_web_search"] },
      { name: "excluded tool cannot be admitted by stale discovery state", tools: prerequisites, excluded: "agent_browser_web_search", stale: true, groups: true, missing: ["agent_browser_web_search"] },
      { name: "real fork group deferral, latest array and current branch", tools: prerequisites, discovery: "codemode", groups: true, missing: [] },
      { name: "denial during a streaming turn is context-only, never steering", tools: [], streaming: true, missing: prerequisites },
    ];
    for (const config of cases) {
      await t.test(config.name, { skip: config.groups && !sdk.instructionGroupsExtension ? "Fork-only real instructionGroupsExtension is not exported by this official host" : false }, async () => {
        let forwarded = 0;
        let effects = 0;
        let controls;
        const definitions = new Map();
        const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } });
        const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, projectTrusted: true, noContextFiles: true,
          extensionFactories: [
            ...(config.discovery === "tool_search" ? [createToolSearchExtension()] : []),
            ...(config.discovery === "codemode" ? [createCodemodeExtension()] : []),
            ...(config.groups ? [sdk.instructionGroupsExtension] : []),
            pi => {
              controls = pi;
              for (const name of config.tools) {
                const definition = {
                  name, label: name, description: "Capability fixture",
                  ...(config.hidden === name ? { exposure: "hidden" } : {}),
                  ...(config.deferred === name ? { exposure: "deferred" } : {}),
                  ...(config.namespace === name ? { namespace: { name: "other-provider" } } : {}),
                  ...(config.inactive === name ? { defaultActive: false } : {}),
                  parameters: name === "subagent" && !config.incompatible ? Type.Object({
                    agent: Type.String(), task: Type.String(), label: Type.Optional(Type.String()),
                    tasks: Type.Optional(Type.Array(Type.Object({ agent: Type.String(), task: Type.String() }))),
                  }) : Type.Object({}),
                  async execute() { effects++; throw new Error("Admission must not execute integration tools"); },
                };
                definitions.set(name, definition);
                pi.registerTool(definition);
              }
              if (config.groups) pi.events.on("pi:instruction-groups", collector => collector.register({
                name: "browser", description: "Browser capability fixture", tools: ["agent_browser_web_search"],
                instructions: () => "Read these browser instructions before using the fixture search capability.",
              }));
              if (config.discovery) pi.on("session_start", () => pi.setActiveTools([...pi.getActiveTools(), config.discovery]));
              // Observe admitted recipes after the production handler, without executing a recipe.
              pi.on("input", event => {
                if (!/^\/(?:skill:)?recipe-/.test(event.text)) return { action: "continue" };
                forwarded++;
                return { action: "handled" };
              });
            },
          ],
        });
        await loader.reload();
        assert.deepEqual(loader.getExtensions().errors, []);
        const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: join(agentDir, "models.json"), allowModelNetwork: false });
        const model = modelRuntime.getModel("admission-fixture", "parent");
        assert.ok(model, "Only the credential-free loopback model may run");
        const sessionManager = SessionManager.inMemory(cwd);
        const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, modelRuntime, model, sessionManager,
          ...(config.excluded ? { excludeTools: [config.excluded] } : {}),
        });
        const errors = [];
        const admit = async (command, missing) => {
          const previousExitCode = process.exitCode;
          const failuresBefore = session.messages.filter(message => message.customType === "recipe-unavailable").length;
          const forwardedBefore = forwarded;
          try {
            await session.prompt(command);
            assert.equal(process.exitCode, missing.length ? 1 : previousExitCode, "SDK consumers must receive the print failure status");
            const failures = session.messages.filter(message => message.customType === "recipe-unavailable");
            assert.equal(failures.length - failuresBefore, missing.length ? 1 : 0, JSON.stringify(failures.at(-1)?.details));
            assert.equal(forwarded - forwardedBefore, missing.length ? 0 : 1);
            if (missing.length) {
              assert.deepEqual(failures.at(-1).details.missing, missing);
              assert.match(JSON.stringify(failures.at(-1).content), /not started.*scripted.*workflow/i);
            }
          } finally {
            process.exitCode = previousExitCode;
          }
        };
        try {
          await session.bindExtensions({ mode: "print", onError(error) { errors.push(error); } });
          if (config.stale) sessionManager.appendCustomEntry("pi:instruction-groups", { inactive: ["agent_browser_web_search"] });
          if (config.groups && !config.stale) {
            await admit("/recipe-task before deferral", []);
            const requestsBefore = requests.length;
            await session.prompt("Complete one ordinary fixture turn.");
            assert.equal(requests.length, requestsBefore + 1);
            assert.ok(session.getActiveToolNames().includes("discover_tools"));
            assert.equal(session.getActiveToolNames().includes("agent_browser_web_search"), false);
            const nativeEntry = sessionManager.getBranch().findLast(entry => entry.type === "custom" && entry.customType === "pi:instruction-groups");
            assert.deepEqual(nativeEntry.data.inactive, ["agent_browser_web_search"], "The real builtin, not the fixture, must publish the deferral");
          }
          if (config.streaming) {
            const requestsBefore = requests.length;
            holdNext = true;
            const requested = new Promise(resolve => { started = resolve; });
            const turn = session.prompt("Hold one ordinary fixture response.");
            await requested;
            const previousExitCode = process.exitCode;
            try {
              await session.prompt("/recipe-task unavailable during streaming", { streamingBehavior: "steer" });
              assert.deepEqual(session.agent.peekQueuedMessages(), [], "A refused recipe must not steer an unrelated running turn");
              assert.equal(process.exitCode, 1);
            } finally {
              process.exitCode = previousExitCode;
              release();
              await turn;
            }
            assert.equal(requests.length, requestsBefore + 1, "The diagnostic must not trigger a follow-up model request");
            assert.deepEqual(session.messages.find(message => message.customType === "recipe-unavailable").details.missing, prerequisites);
          } else {
            for (const command of ["/recipe-review docs/design/example.md", "/skill:recipe-task fix the example"]) await admit(command, config.missing);
          }
          if (config.groups && !config.stale) {
            const nativeLeaf = sessionManager.getLeafId();
            controls.setActiveTools(controls.getActiveTools().filter(name => name !== "todo_list"));
            await admit("/recipe-task user inactive", ["todo_list"]);
            controls.setActiveTools([...controls.getActiveTools(), "todo_list"]);
            sessionManager.appendCustomEntry("pi:instruction-groups", { inactive: "invalid latest value" });
            await admit("/recipe-task latest array survives malformed entry", []);
            sessionManager.appendCustomEntry("pi:instruction-groups", { inactive: [null, 17, {}] });
            await admit("/recipe-task latest array replaces earlier and filters nonstrings", ["agent_browser_web_search"]);
            sessionManager.branch(nativeLeaf);
            session.refreshContext();
            await admit("/recipe-task abandoned branch does not retire current deferral", []);
            controls.setActiveTools(controls.getActiveTools().filter(name => name !== "discover_tools"));
            await admit("/recipe-task inactive discovery cannot restore", ["agent_browser_web_search"]);
            controls.setActiveTools([...controls.getActiveTools(), "discover_tools"]);
            controls.registerTool({ ...definitions.get("agent_browser_web_search"), exposure: "hidden" });
            await admit("/recipe-task withdrawn registration cannot be restored", ["agent_browser_web_search"]);
          }
          assert.equal(effects, 0);
          assert.deepEqual(errors, []);
        } finally {
          await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
          session.dispose();
        }
      });
    }

    await t.test("unrelated prompt and skill namesakes remain usable", async () => {
      const otherPrompt = join(temp, "recipe-review.md");
      const otherSkill = join(temp, "SKILL.md");
      writeFileSync(otherPrompt, "---\ndescription: Other review\n---\nReview independently.\n");
      writeFileSync(otherSkill, "---\nname: recipe-task\ndescription: Other task\n---\nExecute independently.\n");
      let forwarded = 0;
      const settingsManager = SettingsManager.inMemory();
      const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, projectTrusted: true, noContextFiles: true,
        noSkills: true, noPromptTemplates: true, additionalSkillPaths: [otherSkill], additionalPromptTemplatePaths: [otherPrompt],
        extensionFactories: [pi => { pi.on("input", () => { forwarded++; return { action: "handled" }; }); }],
      });
      await loader.reload();
      const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false });
      const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, modelRuntime, sessionManager: SessionManager.inMemory(cwd) });
      try {
        await session.bindExtensions({ mode: "print" });
        await session.prompt("/recipe-review independently");
        await session.prompt("/skill:recipe-task independently");
        assert.equal(forwarded, 2);
        assert.equal(session.messages.some(message => message.customType === "recipe-unavailable"), false);
      } finally {
        await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
        session.dispose();
      }
    });
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(temp, { recursive: true, force: true });
  }
});
