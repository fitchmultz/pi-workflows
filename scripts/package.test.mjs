import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentSession, DefaultPackageManager, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("..", import.meta.url));
const subagentsRef = "c98eeed01aabe6b833f5235d5bf2b074b5b41ff7";
const hostRoot = fileURLToPath(new URL("..", import.meta.resolve("@earendil-works/pi-coding-agent")));
const host = JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8"));
const cli = resolve(hostRoot, host.bin.pi);
if (process.env.PI_HOST_CLI) assert.equal(realpathSync(cli), realpathSync(process.env.PI_HOST_CLI));
if (process.env.PI_COMPAT_EXPECTED_VERSION) assert.equal(host.version, process.env.PI_COMPAT_EXPECTED_VERSION);
if (process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR) assert.equal(realpathSync(hostRoot), realpathSync(process.env.PI_COMPAT_EXPECTED_PACKAGE_DIR));

test("same packed workflow artifact composes native recipes, skills, specialist profiles and runtime", { timeout: 120_000 }, async (t) => {
  const temp = realpathSync(mkdtempSync(join(tmpdir(), "pw-pack-")));
  const cwd = join(temp, "consumer");
  const agentDir = join(temp, "agent");
  const packs = join(temp, "packs");
  for (const dir of [cwd, agentDir, packs]) mkdirSync(dir);
  const env = { ...process.env, HOME: temp, USERPROFILE: temp, PI_CODING_AGENT_DIR: agentDir,
    PI_PACKAGE_DIR: hostRoot, PI_SUBAGENT_TEMP_ROOT: join(temp, "pi-subagents-runs"), PI_OFFLINE: "1", PI_TELEMETRY: "0" };
  const saved = Object.fromEntries(["HOME", "USERPROFILE", "PI_CODING_AGENT_DIR", "PI_PACKAGE_DIR", "PI_SUBAGENT_TEMP_ROOT"].map(key => [key, process.env[key]]));
  const run = (command, args, workdir = cwd) => {
    const result = spawnSync(command, args, { cwd: workdir, env, encoding: "utf8", timeout: 60_000 });
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
    return result.stdout;
  };
  let session;
  try {
    const tarball = process.env.PI_WORKFLOWS_TARBALL
      ? resolve(process.env.PI_WORKFLOWS_TARBALL)
      : join(packs, Object.values(JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packs], root)))[0].filename);
    const manifest = JSON.parse(run("tar", ["-xOf", tarball, "package/package.json"]));
    assert.equal(manifest.name, "@fitchmultz/pi-workflows");
    assert.equal(run("tar", ["-tzf", tarball]).trim().split("\n").some(path => path.split("/").includes(".pi")), false, "Project-private state must never be shipped");
    const artifactSha256 = createHash("sha256").update(readFileSync(tarball)).digest("hex");
    const subagents = process.env.PI_WORKFLOWS_SUBAGENTS_TARBALL
      ? `npm:@fitchmultz/pi-subagents@file:${resolve(process.env.PI_WORKFLOWS_SUBAGENTS_TARBALL)}`
      : `git:github.com/fitchmultz/pi-subagents@${subagentsRef}`;
    run(process.execPath, [cli, "install", "--approve", subagents]);
    const prerequisite = new DefaultPackageManager({ cwd, agentDir, settingsManager: SettingsManager.create(cwd, agentDir, { projectTrusted: true }) }).getInstalledPath(subagents, "user");
    assert.ok(prerequisite, "The native CLI must install the actual Subagents prerequisite");
    const prerequisiteManifest = JSON.parse(readFileSync(join(prerequisite, "package.json"), "utf8"));
    assert.equal(prerequisiteManifest.name, "@fitchmultz/pi-subagents");
    assert.equal(prerequisiteManifest.version, "0.44.4");
    for (const entry of ["dist/extension/index.js", "dist/pi-intercom/index.js"]) assert.ok(existsSync(join(prerequisite, entry)), entry);
    if (!process.env.PI_WORKFLOWS_SUBAGENTS_TARBALL) {
      assert.equal(run("git", ["rev-parse", "HEAD"], prerequisite).trim(), subagentsRef);
      assert.equal(run("git", ["ls-files", "dist"], prerequisite).trim(), "", "The compiled entries must come from native Git prepare, not tracked build output");
      assert.equal(existsSync(join(prerequisite, "node_modules", "typescript")), false, "Native Git prepare must not retain its compiler");
    }
    run(process.execPath, [cli, "install", "--approve", `npm:@fitchmultz/pi-workflows@file:${tarball}`]);
    const installed = join(agentDir, "npm", "node_modules", "@fitchmultz", "pi-workflows");
    assert.equal(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")).version, "0.2.1");
    assert.equal(existsSync(join(cwd, ".pi")), false, "Installed assets must not require copying a project kit");
    Object.assign(process.env, Object.fromEntries(Object.keys(saved).map(key => [key, env[key]])));
    const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
    const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, projectTrusted: true, noContextFiles: true });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, []);
    const expectedSkills = readdirSync(join(root, "reference/workflows/skills")).filter(name => existsSync(join(root, "reference/workflows/skills", name, "SKILL.md"))).sort();
    const expectedRecipes = expectedSkills.filter(name => name.startsWith("recipe-"));
    assert.equal(expectedSkills.length, 31);
    assert.equal(expectedRecipes.length, 17);
    assert.deepEqual(loader.getSkills().skills.map(({ name }) => name).filter(name => expectedSkills.includes(name)).sort(), expectedSkills);
    assert.deepEqual(loader.getPrompts().prompts.map(({ name }) => name).sort(), expectedRecipes);
    assert.deepEqual(loader.getSkills().diagnostics, []);
    assert.deepEqual(loader.getPrompts().diagnostics, []);
    const modelRuntime = await ModelRuntime.create({ authPath: join(agentDir, "auth.json"), modelsPath: null, allowModelNetwork: false });
    ({ session } = await createAgentSession({ cwd, agentDir, modelRuntime, settingsManager, resourceLoader: loader, sessionManager: SessionManager.inMemory(cwd) }));
    const errors = [];
    await session.bindExtensions({ mode: "print", onError(error) { errors.push(error); } });
    const tool = name => {
      const found = session.agent.state.tools.find(tool => tool.name === name);
      assert.ok(found, `Missing native tool ${name}`);
      return found;
    };
    const signal = new AbortController().signal;
    await tool("load_subagent").execute("profiles", { advanced: true }, signal);
    const profiles = readdirSync(join(root, "reference/workflows/agents")).filter(name => name.endsWith(".md")).map(name => name.slice(0, -3)).sort();
    assert.equal(profiles.length, 25);
    for (const name of profiles) {
      const result = await tool("subagent").execute(`profile-${name}`, { action: "get", agent: name }, signal);
      assert.notEqual(result.isError, true, name);
      const text = result.content.filter(part => part.type === "text").map(part => part.text).join("\n");
      assert.ok(text.includes(`Agent: ${name} (package)`), text);
      assert.match(text, /System prompt mode: replace/);
      assert.match(text, /Default context: fresh/);
      assert.ok(text.includes(join(installed, "resources", "agents")), "Profile must come from the actual installed artifact");
    }
    const denied = await tool("subagent").execute("readonly", { action: "delete", agent: "task-executor" }, signal);
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /package.*cannot be modified/);
    const headers = [];
    const log = t.mock.method(console, "log", text => headers.push(text));
    await session.prompt("/workflows status");
    log.mock.restore();
    assert.ok(headers.some(text => text.includes("Recipes (17):") && text.includes("Skills (31):") && text.includes("Agents (25):")), "The installed production command must resolve its public sibling assets");
    await session.prompt("/workflow-size small");
    assert.equal(readFileSync(join(cwd, ".pi/workflow-size"), "utf8"), "small\n");
    assert.equal(existsSync(join(installed, ".pi")), false);
    assert.equal(existsSync(join(installed, "resources/workflow-size")), false);
    const result = await tool("workflow").execute("packed-runtime", { script: "export const meta = { name: 'packed-runtime', description: 'native runtime' }\nreturn 42" }, signal);
    assert.match(result.content[0].text, /^Started packed-runtime/);
    await new Promise(resolve => setImmediate(resolve));
    assert.ok(session.messages.some(message => message.customType === "workflow-report" && JSON.stringify(message.content).includes("42")));
    assert.deepEqual(errors, []);
    t.diagnostic(JSON.stringify({ host: process.env.PI_COMPAT_HOST ?? "local", version: host.version, hostRoot, cli, artifact: tarball, artifactSha256, prerequisite: { source: subagents, path: prerequisite, name: prerequisiteManifest.name, version: prerequisiteManifest.version }, profiles: profiles.length, skills: expectedSkills.length, recipes: expectedRecipes.length, inference: "not invoked" }));
  } finally {
    await session?.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session?.dispose();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    rmSync(temp, { recursive: true, force: true });
  }
});
