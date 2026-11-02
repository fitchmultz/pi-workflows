import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
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
import { delimiter, dirname, join, resolve } from "node:path";
import nodeTest from "node:test";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultPackageManager,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import {
  adoptFixtureEnv,
  asArray,
  asRecord,
  asString,
  customMessages,
  firstText,
  loopbackAddress,
  recipePayload,
  restoreEnv,
  textOf,
  toolResults,
} from "./test-helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const minimumSubagentsVersion = "0.44.4";
const hostRoot = fileURLToPath(
  new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")),
);
const host = asRecord(JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8")));
const cli = resolve(hostRoot, asString(asRecord(host.bin).pi));
const cliBundleHash = createHash("sha256");
const bundleFiles = readdirSync(dirname(cli), { recursive: true }).flatMap((entry) =>
  typeof entry === "string" && entry.endsWith(".js") ? [entry] : [],
);
for (const file of bundleFiles.sort()) {
  cliBundleHash
    .update(file)
    .update("\0")
    .update(readFileSync(join(dirname(cli), file)))
    .update("\0");
}
const cliBundleSha256 = cliBundleHash.digest("hex");
if (process.env.PI_HOST_CLI !== undefined) {
  assert.equal(realpathSync(cli), realpathSync(process.env.PI_HOST_CLI));
}
if (process.env.PI_COMPAT_EXPECTED_VERSION !== undefined) {
  assert.equal(asString(host.version), process.env.PI_COMPAT_EXPECTED_VERSION);
}
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR !== undefined) {
  assert.equal(realpathSync(hostRoot), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));
}

nodeTest(
  "packed workflows install standalone, reject unavailable recipes, then compose with the real Subagents receiver",
  { timeout: 120_000 },
  async (t) => {
    const temp = realpathSync(mkdtempSync(join(tmpdir(), "pw-pack-")));
    const cwd = join(temp, "consumer");
    const agentDir = join(temp, "agent");
    const packs = join(temp, "packs");
    for (const dir of [cwd, agentDir, packs]) {
      mkdirSync(dir);
    }
    /** @returns {{ fixture: NodeJS.ProcessEnv, inherited: Record<string, string | undefined> }} */
    const fixtureEnv = () => {
      /** @type {NodeJS.ProcessEnv} */
      const fixture = {
        ...process.env,
        HOME: temp,
        USERPROFILE: temp,
        PI_CODING_AGENT_DIR: agentDir,
        PI_PACKAGE_DIR: hostRoot,
        PI_SUBAGENT_TEMP_ROOT: join(temp, "pi-subagents-runs"),
        PI_OFFLINE: "1",
        PI_TELEMETRY: "0",
      };
      const inherited = Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(PI_SUBAGENT_|PI_INTERCOM_|PI_SESSION_)/.test(key),
        ),
      );
      for (const key of Object.keys(inherited)) {
        delete fixture[key];
      }
      fixture.PI_SUBAGENT_TEMP_ROOT = join(temp, "pi-subagents-runs");
      return { fixture, inherited };
    };
    const { fixture: env, inherited } = fixtureEnv();
    const saved = Object.fromEntries(
      [
        "HOME",
        "USERPROFILE",
        "PI_CODING_AGENT_DIR",
        "PI_PACKAGE_DIR",
        "PI_SUBAGENT_TEMP_ROOT",
        "PATH",
      ].map((key) => [key, process.env[key]]),
    );
    const run = (
      /** @type {string} */ command,
      /** @type {string[]} */ args,
      workdir = cwd,
      commandEnv = env,
    ) => {
      const result = spawnSync(command, args, {
        cwd: workdir,
        env: commandEnv,
        encoding: "utf8",
        timeout: 60_000,
      });
      if (result.error) {
        throw result.error;
      }
      assert.equal(
        result.status,
        0,
        `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
      );
      return result.stdout;
    };
    const packTarball = (
      /** @type {string | undefined} */ override,
      /** @type {string} */ spec = "",
    ) => {
      if (override !== undefined) {
        return resolve(override);
      }
      const args = ["pack", "--json", "--ignore-scripts", "--pack-destination", packs];
      if (spec !== "") {
        args.push(spec);
      }
      /** @type {unknown} */
      const packed = JSON.parse(run("npm", args, root));
      // npm pack --json emits an array on some versions and a name-keyed record on others.
      const entries = Array.isArray(packed) ? packed : Object.values(asRecord(packed));
      return join(packs, asString(asRecord(entries[0]).filename));
    };
    /** @type {import("@earendil-works/pi-coding-agent").AgentSession | undefined} */
    let session;
    /** @type {import("node:http").Server | undefined} */
    let server;
    try {
      const tarball = packTarball(process.env.PI_WORKFLOWS_TARBALL);
      const manifest = asRecord(JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"])));
      assert.equal(asString(manifest.name), "@fitchmultz/pi-workflows");
      assert.equal(
        asString(manifest.version),
        asString(asRecord(JSON.parse(readFileSync(join(root, "package.json"), "utf8"))).version),
      );
      assert.equal(
        run("tar", ["-tzf", tarball])
          .trim()
          .split("\n")
          .some((path) => path.split("/").includes(".pi")),
        false,
        "Project-private state must never be shipped",
      );
      const artifactSha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
      run(process.execPath, [
        cli,
        "install",
        "--approve",
        `npm:@fitchmultz/pi-workflows@file:${tarball}`,
      ]);
      const installed = join(agentDir, "npm", "node_modules", "@fitchmultz", "pi-workflows");
      assert.equal(
        asString(
          asRecord(JSON.parse(readFileSync(join(installed, "package.json"), "utf8"))).version,
        ),
        asString(manifest.version),
      );
      assert.equal(
        existsSync(join(cwd, ".pi")),
        false,
        "Installed assets must not require copying a project kit",
      );
      adoptFixtureEnv(inherited, saved, env);

      /** @type {Array<Record<string, unknown>>} */
      const requests = [];
      /**
       * @type {{ agent: string, description?: string, prompt?: string, label?: string, task?: string, model?: string, async?: boolean, context?: string } | undefined}
       */
      let toolPayload;
      let callSeq = 0;
      const respond = (
        /** @type {import("node:http").IncomingMessage} */ req,
        /** @type {import("node:http").ServerResponse} */ res,
        /** @type {string} */ body,
      ) => {
        const request = asRecord(JSON.parse(body));
        requests.push(request);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const base = {
          id: "recipe",
          object: "chat.completion.chunk",
          created: 1,
          model: request.model,
        };
        const calling = request.model === "parent" && toolPayload !== undefined;
        const delta = calling
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: `recipe-${++callSeq}`,
                  type: "function",
                  function: { name: "subagent", arguments: JSON.stringify(toolPayload) },
                },
              ],
            }
          : { role: "assistant", content: '{"fixture":true}' };
        if (calling) {
          toolPayload = undefined;
        }
        res.write(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
        );
        res.end(
          `data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: calling ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
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
            "recipe-fixture": {
              api: "openai-completions",
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              apiKey: "fixture-only",
              models: ["parent", "worker"].map((id) => ({
                id,
                name: id,
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 1000,
              })),
            },
          },
        }),
      );

      const standaloneSettings = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
      const standaloneLoader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager: standaloneSettings,
        noContextFiles: true,
      });
      await standaloneLoader.reload();
      assert.deepEqual(standaloneLoader.getExtensions().errors, []);
      assert.equal(
        standaloneLoader.getExtensions().extensions.length,
        1,
        "Only the workflow extension is installed",
      );
      assert.equal(standaloneLoader.getPrompts().prompts.length, 17);
      assert.equal(standaloneLoader.getSkills().skills.length, 31);
      const standaloneRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: null,
        allowModelNetwork: false,
      });
      ({ session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime: standaloneRuntime,
        settingsManager: standaloneSettings,
        resourceLoader: standaloneLoader,
        sessionManager: SessionManager.inMemory(cwd),
      }));
      await session.bindExtensions({ mode: "print" });
      assert.equal(session.getActiveToolNames().includes("subagent"), false);
      const printProbe = async (/** @type {string} */ mode) => {
        const before = requests.length;
        /** @type {Promise<{ status: number | null, stdout: string, stderr: string }>} */
        const printed = new Promise((fulfill, reject) => {
          const child = spawn(
            process.execPath,
            [
              cli,
              "--approve",
              "--offline",
              "--provider",
              "recipe-fixture",
              "--model",
              "parent",
              ...(mode === "json" ? ["--mode", "json"] : []),
              "-p",
              "/recipe-task missing prerequisite",
            ],
            { cwd, env, stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
          );
          let stdout = "";
          let stderr = "";
          child.stdout.setEncoding("utf8").on("data", (/** @type {string} */ chunk) => {
            stdout += chunk;
          });
          child.stderr.setEncoding("utf8").on("data", (/** @type {string} */ chunk) => {
            stderr += chunk;
          });
          child.on("error", reject);
          child.on("close", (status) => {
            fulfill({ status, stdout, stderr });
          });
        });
        const printedOut = await printed;
        assert.equal(
          printedOut.status,
          1,
          `${mode} print must fail clearly: ${JSON.stringify(printed)}`,
        );
        assert.match(printedOut.stderr, /Recipe recipe-task not started/);
        for (const name of ["subagent", "todo_list", "ask_question", "agent_browser_web_search"]) {
          assert.ok(printedOut.stderr.includes(name), printedOut.stderr);
        }
        if (mode === "json") {
          assert.match(printedOut.stdout, /recipe-unavailable/);
        }
        assert.equal(
          requests.length,
          before,
          "A rejected printed recipe must not dispatch to the provider",
        );
      };
      for (const mode of ["text", "json"]) {
        await printProbe(mode);
      }
      const previousExitCode = process.exitCode;
      try {
        for (const command of ["/recipe-design add accounts", "/skill:recipe-task fix accounts"]) {
          await session.prompt(command);
          assert.equal(process.exitCode, 1, "SDK denial must expose nonzero print status");
        }
      } finally {
        process.exitCode = previousExitCode;
      }
      const failures = customMessages(session.messages, "recipe-unavailable");
      assert.equal(
        failures.length,
        2,
        "Installed prompt and skill invocations must be stopped before model work",
      );
      for (const message of failures) {
        assert.deepEqual(asRecord(message.details).missing, [
          "subagent",
          "todo_list",
          "ask_question",
          "agent_browser_web_search",
        ]);
      }
      const standaloneTool = session.agent.state.tools.find((tool) => tool.name === "workflow");
      assert.ok(standaloneTool !== undefined, "The workflow tool must be installed");
      const standaloneResult = await standaloneTool.execute(
        "standalone",
        {
          script:
            "export const meta = { name: 'standalone', description: 'native core' }\nreturn await pipeline([1, 2], async n => n * 2)",
        },
        new AbortController().signal,
      );
      assert.match(firstText(standaloneResult.content), /^Started standalone/);
      await new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          setImmediate(fulfill);
        },
      );
      assert.ok(
        session.messages.some(
          (message) =>
            message.role === "custom" &&
            message.customType === "workflow-report" &&
            JSON.stringify(message.content).includes("4"),
        ),
      );
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
      session.dispose();
      session = undefined;
      t.diagnostic(
        "Standalone packed install: one extension, 17 prompts, 31 skills; missing recipe integrations stopped before inference; native pipeline completed.",
      );

      const subagentsTarball = packTarball(
        process.env.PI_WORKFLOWS_SUBAGENTS_TARBALL,
        `@fitchmultz/pi-subagents@${minimumSubagentsVersion}`,
      );
      const subagents = `npm:@fitchmultz/pi-subagents@file:${subagentsTarball}`;
      run(process.execPath, [cli, "install", "--approve", subagents]);
      const prerequisite = new DefaultPackageManager({
        cwd,
        agentDir,
        settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: true }),
      }).getInstalledPath(subagents, "user");
      assert.ok(
        prerequisite !== undefined,
        "The native CLI must install the actual Subagents prerequisite",
      );
      const prerequisiteManifest = asRecord(
        JSON.parse(readFileSync(join(prerequisite, "package.json"), "utf8")),
      );
      assert.equal(asString(prerequisiteManifest.name), "@fitchmultz/pi-subagents");
      assert.equal(asString(prerequisiteManifest.version), minimumSubagentsVersion);
      for (const entry of ["dist/extension/index.js", "dist/pi-intercom/index.js"]) {
        assert.ok(existsSync(join(prerequisite, entry)), entry);
      }
      const verifyGitInstall = async () => {
        const gitAgentDir = join(temp, "git-agent");
        mkdirSync(gitAgentDir);
        const gitSource = "git:github.com/fitchmultz/pi-subagents";
        run(process.execPath, [cli, "install", "--approve", gitSource], cwd, {
          ...env,
          PI_CODING_AGENT_DIR: gitAgentDir,
        });
        const gitPackage = new DefaultPackageManager({
          cwd,
          agentDir: gitAgentDir,
          settingsManager: SettingsManager.create(cwd, gitAgentDir, { projectTrusted: true }),
        }).getInstalledPath(gitSource, "user");
        assert.ok(gitPackage !== undefined, "The native CLI must install Subagents from Git");
        const gitManifest = asRecord(
          JSON.parse(readFileSync(join(gitPackage, "package.json"), "utf8")),
        );
        assert.equal(asString(gitManifest.name), "@fitchmultz/pi-subagents");
        const gitEntries = asArray(asRecord(gitManifest.pi).extensions);
        assert.ok(gitEntries.length > 0, "The Git package must advertise extension entries");
        for (const entry of gitEntries) {
          assert.ok(existsSync(join(gitPackage, asString(entry))), asString(entry));
        }
        assert.equal(
          run("git", ["ls-files", "dist"], gitPackage).trim(),
          "",
          "The compiled entries must come from native Git prepare, not tracked build output",
        );
        assert.equal(
          existsSync(join(gitPackage, "node_modules", "typescript")),
          false,
          "Native Git prepare must not retain its compiler",
        );
        t.diagnostic(
          `Native Git prepare: ${asString(gitManifest.name)}@${asString(gitManifest.version)}, commit ${run("git", ["rev-parse", "HEAD"], gitPackage).trim()}.`,
        );
      };
      if (process.env.PI_WORKFLOWS_SUBAGENTS_TARBALL === undefined) {
        await verifyGitInstall();
      }
      const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        settingsManager,
        noContextFiles: true,
      });
      await loader.reload();
      assert.deepEqual(loader.getExtensions().errors, []);
      const expectedSkills = readdirSync(join(root, "reference/workflows/skills"))
        .filter((name) => existsSync(join(root, "reference/workflows/skills", name, "SKILL.md")))
        .sort();
      const expectedRecipes = expectedSkills.filter((name) => name.startsWith("recipe-"));
      assert.equal(expectedSkills.length, 31);
      assert.equal(expectedRecipes.length, 17);
      assert.deepEqual(
        loader
          .getSkills()
          .skills.map(({ name }) => name)
          .filter((name) => expectedSkills.includes(name))
          .sort(),
        expectedSkills,
      );
      assert.deepEqual(
        loader
          .getPrompts()
          .prompts.map(({ name }) => name)
          .sort(),
        expectedRecipes,
      );
      assert.deepEqual(loader.getSkills().diagnostics, []);
      assert.deepEqual(loader.getPrompts().diagnostics, []);
      const modelRuntime = await ModelRuntime.create({
        authPath: join(agentDir, "auth.json"),
        modelsPath: join(agentDir, "models.json"),
        allowModelNetwork: false,
      });
      const parentModel = modelRuntime.getModel("recipe-fixture", "parent");
      assert.ok(
        parentModel,
        "Receiver qualification must select only the credential-free loopback provider",
      );
      ({ session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime,
        model: parentModel,
        settingsManager,
        resourceLoader: loader,
        sessionManager: SessionManager.inMemory(cwd),
      }));
      const bound = session;
      /** @type {unknown[]} */
      const errors = [];
      await bound.bindExtensions({
        mode: "print",
        onError(error) {
          errors.push(error);
        },
      });
      const tool = (/** @type {string} */ name) => {
        const found = bound.agent.state.tools.find((candidate) => candidate.name === name);
        assert.ok(found !== undefined, `Missing native tool ${name}`);
        return found;
      };
      const signal = new AbortController().signal;
      const coldExitCode = process.exitCode;
      try {
        assert.equal(
          bound.getActiveToolNames().includes("subagent"),
          false,
          "Real advanced Subagents must still be cold",
        );
        await bound.prompt("/recipe-task inspect real cold Subagents");
        assert.equal(process.exitCode, 1);
        const unavailable = customMessages(bound.messages, "recipe-unavailable")[0];
        assert.ok(unavailable !== undefined, "recipe-unavailable must be recorded");
        assert.deepEqual(
          asRecord(unavailable.details).missing,
          ["todo_list", "ask_question", "agent_browser_web_search"],
          "Real cold executor and loader must be accepted before loading",
        );
        assert.equal(requests.length, 0);
      } finally {
        process.exitCode = coldExitCode;
      }
      await tool("load_subagent").execute("profiles", { advanced: true }, signal);
      const template = loader.getPrompts().prompts.find((prompt) => prompt.name === "recipe-task");
      assert.ok(template !== undefined, "recipe-task prompt must be installed");
      const payload = recipePayload(template.content, "verify standalone boundaries");
      assert.deepEqual(payload, {
        agent: "rule-advisor",
        label: "Rule selection",
        task: "Task: verify standalone boundaries. Select appropriate rules and perform metacognitive analysis.",
      });
      toolPayload = { agent: payload.agent, description: payload.label, prompt: payload.task };
      await bound.prompt("Probe the legacy recipe payload contract.");
      const legacy = toolResults(bound.messages, "recipe-1")[0];
      assert.ok(legacy !== undefined, "legacy subagent result must be recorded");
      assert.equal(legacy.isError, true, "The real host/receiver rejects the old upstream aliases");
      const legacyReasons = textOf(legacy.content)
        .split("\n")
        .filter((line) => /^\s+- /.test(line))
        .join("\n");
      assert.match(legacyReasons, /unexpected property|must not have additional properties/i);
      assert.match(legacyReasons, /^\s+- (description|prompt): /m);
      assert.equal(requests.filter((request) => request.model === "worker").length, 0);
      if (process.platform === "win32") {
        t.diagnostic(
          "SKIP selected-child probe: Subagents 0.44.4 spawns bare pi without a shell; the executable POSIX routing shim is unavailable on Windows.",
        );
      } else {
        const childBin = join(temp, "bin");
        const childReceipt = join(temp, "child-launches.jsonl");
        const selectedChild = {
          node: realpathSync(process.execPath),
          cli: realpathSync(cli),
          packageDir: realpathSync(hostRoot),
          version: asString(host.version),
          cliBundleSha256,
        };
        const shellQuote = (/** @type {string} */ value) => `'${value.replaceAll("'", "'\\''")}'`;
        mkdirSync(childBin);
        writeFileSync(childReceipt, "");
        // Subagents resolves bare "pi" through PATH, not process.argv[1].
        writeFileSync(
          join(childBin, "pi"),
          `#!/bin/sh
[ "$PI_PACKAGE_DIR" = ${shellQuote(hostRoot)} ] || exit 1
printf '%s\\n' ${shellQuote(JSON.stringify(selectedChild))} >> ${shellQuote(childReceipt)}
exec ${shellQuote(process.execPath)} ${shellQuote(cli)} "$@"
`,
          { mode: 0o700 },
        );
        const previousPath = process.env.PATH;
        try {
          process.env.PATH = [childBin, previousPath].filter(Boolean).join(delimiter);
          toolPayload = {
            ...payload,
            model: "recipe-fixture/worker",
            async: false,
            context: "fresh",
          };
          await bound.prompt("Probe the supported generated recipe payload contract.");
          const received = toolResults(bound.messages, "recipe-2")[0];
          assert.ok(received !== undefined, "generated recipe result must be recorded");
          assert.notEqual(received.isError, true, JSON.stringify(received.content));
          const launches = readFileSync(childReceipt, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => asRecord(JSON.parse(line)));
          assert.deepEqual(
            launches,
            [selectedChild],
            "Exactly one Subagents child must use the selected CLI and package cohort",
          );
          const childRequests = requests.filter((request) => request.model === "worker");
          assert.equal(childRequests.length, 1);
          const childRequest = childRequests[0];
          assert.ok(childRequest !== undefined, "worker request must be recorded");
          assert.ok(
            JSON.stringify(childRequest.messages).includes(payload.task),
            "The specialist must receive the complete generated canonical task",
          );
          assert.equal(asRecord(asArray(asRecord(received.details).results)[0]).task, payload.task);
          t.diagnostic(
            JSON.stringify({
              selectedChild: launches[0],
              childLaunches: launches.length,
              inference: "one credential-free loopback fixture response",
            }),
          );
        } finally {
          if (previousPath === undefined) {
            delete process.env.PATH;
          } else {
            process.env.PATH = previousPath;
          }
        }
      }
      const profiles = readdirSync(join(root, "reference/workflows/agents"))
        .filter((name) => name.endsWith(".md"))
        .map((name) => name.slice(0, -3))
        .sort();
      assert.equal(profiles.length, 25);
      for (const name of profiles) {
        const result = await tool("subagent").execute(
          `profile-${name}`,
          { action: "get", agent: name },
          signal,
        );
        assert.notEqual(result.isError, true, name);
        const text = textOf(result.content);
        assert.ok(text.includes(`Agent: ${name} (package)`), text);
        assert.match(text, /System prompt mode: replace/);
        assert.match(text, /Default context: fresh/);
        assert.ok(
          text.includes(join(installed, "resources", "agents")),
          "Profile must come from the actual installed artifact",
        );
      }
      const denied = await tool("subagent").execute(
        "readonly",
        { action: "delete", agent: "task-executor" },
        signal,
      );
      assert.equal(denied.isError, true);
      assert.match(firstText(denied.content), /package.*cannot be modified/);
      /** @type {string[]} */
      const headers = [];
      const log = t.mock.method(console, "log", (/** @type {string} */ text) => {
        headers.push(text);
      });
      await bound.prompt("/workflows status");
      log.mock.restore();
      assert.ok(
        headers.some(
          (text) =>
            text.includes("Recipes (17):") &&
            text.includes("Skills (31):") &&
            text.includes("Agents (25):"),
        ),
        "The installed production command must resolve its public sibling assets",
      );
      await bound.prompt("/workflow-size small");
      assert.equal(readFileSync(join(cwd, ".pi/workflow-size"), "utf8"), "small\n");
      assert.equal(existsSync(join(installed, ".pi")), false);
      assert.equal(existsSync(join(installed, "resources/workflow-size")), false);
      const result = await tool("workflow").execute(
        "packed-runtime",
        {
          script:
            "export const meta = { name: 'packed-runtime', description: 'native runtime' }\nreturn 42",
        },
        signal,
      );
      assert.match(firstText(result.content), /^Started packed-runtime/);
      await new Promise(
        /** @param {(value?: void) => void} fulfill */ (fulfill) => {
          setImmediate(fulfill);
        },
      );
      assert.ok(
        bound.messages.some(
          (message) =>
            message.role === "custom" &&
            message.customType === "workflow-report" &&
            JSON.stringify(message.content).includes("42"),
        ),
      );
      assert.deepEqual(errors, []);
      t.diagnostic(
        JSON.stringify({
          host: process.env.PI_COMPAT_HOST ?? "local",
          version: asString(host.version),
          hostRoot,
          cli,
          cliBundleSha256,
          artifact: tarball,
          artifactSha256,
          prerequisite: {
            source: subagents,
            path: prerequisite,
            name: asString(prerequisiteManifest.name),
            version: asString(prerequisiteManifest.version),
          },
          profiles: profiles.length,
          skills: expectedSkills.length,
          recipes: expectedRecipes.length,
          inference: "loopback fixture only",
        }),
      );
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
      restoreEnv(saved);
      Object.assign(process.env, inherited);
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
