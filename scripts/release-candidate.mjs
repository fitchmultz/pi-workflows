import assert from "node:assert/strict";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  artifact: { type: "string" }, "fork-artifact": { type: "string" }, automation: { type: "string" },
  repository: { type: "string" }, "source-ref": { type: "string" }, "release-source": { type: "string" },
  "official-version": { type: "string" }, "fork-ref": { type: "string" }, host: { type: "string" }, output: { type: "string" },
} });
for (const key of ["artifact", "fork-artifact", "automation", "repository", "source-ref", "release-source", "official-version", "fork-ref", "host", "output"]) {
  assert.ok(values[key], `Missing --${key}`);
}
assert.ok(["official", "fork"].includes(values.host), "Host must be official or fork");

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = resolve(values.artifact);
const output = resolve(values.output);
const { isolatedEnvironment, readJson, run, sha256, writeJson } = await import(pathToFileURL(join(resolve(values.automation), "scripts/common.mjs")));
const { prepareHost, selectDevelopmentHost } = await import(pathToFileURL(join(resolve(values.automation), "scripts/hosts.mjs")));
const release = readJson(join(artifact, "release.json"));
assert.equal(release.repository, values.repository, "Candidate repository differs from the caller");
assert.equal(release.name, "@fitchmultz/pi-workflows");
assert.equal(release.source, values["source-ref"], "Candidate source differs from the plan");
assert.equal(release.releaseSource, values["release-source"], "Candidate queue source differs from the plan");
assert.equal(run("git", ["rev-parse", "HEAD"], { cwd: source, quiet: true }).trim(), release.source);
assert.equal(run("git", ["status", "--porcelain"], { cwd: source, quiet: true }).trim(), "", "Qualification source must be clean");
assert.equal(readJson(join(source, "package.json")).version, release.version);
assert.equal(release.hosts.official.version, values["official-version"]);
assert.equal(release.hosts.fork.provenance.ref, values["fork-ref"]);
assert.equal(basename(release.filename), release.filename);
const tarball = join(artifact, release.filename);
assert.equal(sha256(tarball), release.sha256, "Candidate tarball differs from its receipt");

const env = isolatedEnvironment(join(output, "isolation"));
const host = await prepareHost(join(output, "host"), values.host,
  values.host === "official" ? values["official-version"] : resolve(values["fork-artifact"]), env);
const expected = release.hosts[values.host];
for (const key of ["version", "indexSha256", "cliSha256", "runtimeLockSha256", "runtimeGraphSha256"]) {
  assert.equal(host[key], expected[key], `${values.host} host ${key} differs from candidate preparation`);
}
assert.deepEqual(host.cohort, expected.cohort, `${values.host} host Pi cohort differs`);
assert.deepEqual(host.companions, expected.companions, `${values.host} host companions differ`);
const selected = selectDevelopmentHost(source, host, env);
run(process.execPath, ["--test", "scripts/package.test.mjs"], { cwd: source, env: {
  ...env,
  PI_WORKFLOWS_TARBALL: tarball,
  PI_COMPAT_HOST: values.host,
  PI_COMPAT_EXPECTED_VERSION: host.version,
  PI_COMPAT_EXPECTED_PACKAGE_DIR: selected.packageDir,
  PI_HOST_CLI: selected.cli,
} });
assert.equal(sha256(tarball), release.sha256, "Candidate tarball changed during qualification");
writeJson(join(output, "report.json"), {
  source: release.source, releaseSource: release.releaseSource, candidateSha256: release.sha256,
  candidateVersion: release.version, host: values.host, hostVersion: host.version,
  indexSha256: host.indexSha256, cliSha256: host.cliSha256,
  runtimeLockSha256: host.runtimeLockSha256, runtimeGraphSha256: host.runtimeGraphSha256,
});
