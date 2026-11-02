import assert from "node:assert/strict";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    artifact: { type: "string" },
    "fork-artifact": { type: "string" },
    automation: { type: "string" },
    repository: { type: "string" },
    "source-ref": { type: "string" },
    "release-source": { type: "string" },
    "official-version": { type: "string" },
    "fork-ref": { type: "string" },
    host: { type: "string" },
    output: { type: "string" },
  },
});

// parseArgs yields optional strings; each required flag is asserted once so the
// rest of the script reads fully narrowed values.
assert.ok(typeof values.artifact === "string" && values.artifact !== "", "Missing --artifact");
assert.ok(
  typeof values["fork-artifact"] === "string" && values["fork-artifact"] !== "",
  "Missing --fork-artifact",
);
assert.ok(
  typeof values.automation === "string" && values.automation !== "",
  "Missing --automation",
);
assert.ok(
  typeof values.repository === "string" && values.repository !== "",
  "Missing --repository",
);
assert.ok(
  typeof values["source-ref"] === "string" && values["source-ref"] !== "",
  "Missing --source-ref",
);
assert.ok(
  typeof values["release-source"] === "string" && values["release-source"] !== "",
  "Missing --release-source",
);
assert.ok(
  typeof values["official-version"] === "string" && values["official-version"] !== "",
  "Missing --official-version",
);
assert.ok(
  typeof values["fork-ref"] === "string" && values["fork-ref"] !== "",
  "Missing --fork-ref",
);
assert.ok(typeof values.host === "string" && values.host !== "", "Missing --host");
assert.ok(typeof values.output === "string" && values.output !== "", "Missing --output");
assert.ok(values.host === "official" || values.host === "fork", "Host must be official or fork");

/**
 * Host facts recorded per host during candidate preparation.
 * @typedef {{
 *   version: string,
 *   indexSha256: string,
 *   cliSha256: string,
 *   runtimeLockSha256: string,
 *   runtimeGraphSha256: string,
 *   cohort: unknown,
 *   companions: unknown,
 * }} HostFacts
 */

/**
 * release.json receipt written by candidate preparation.
 * @typedef {{
 *   repository: string,
 *   name: string,
 *   source: string,
 *   releaseSource: string,
 *   version: string,
 *   filename: string,
 *   sha256: string,
 *   hosts: { official: HostFacts, fork: HostFacts & { provenance: { ref: string } } },
 * }} Release
 */

// The automation repository is resolved at runtime; its helpers are declared
// here as the single typed boundary this script actually consumes.
/**
 * @typedef {{
 *   isolatedEnvironment: (dir: string) => Record<string, string>,
 *   readJson: (path: string) => unknown,
 *   run: (
 *     cmd: string,
 *     args: string[],
 *     opts?: { cwd?: string, env?: Record<string, string>, quiet?: boolean },
 *   ) => string,
 *   sha256: (path: string) => string,
 *   writeJson: (path: string, value: unknown) => void,
 * }} CommonModule
 */

/**
 * @typedef {{
 *   prepareHost: (
 *     dir: string,
 *     host: string,
 *     artifact: string,
 *     env: Record<string, string>,
 *   ) => Promise<HostFacts>,
 *   selectDevelopmentHost: (
 *     source: string,
 *     host: HostFacts,
 *     env: Record<string, string>,
 *   ) => { packageDir: string, cli: string },
 * }} HostsModule
 */

/** @param {unknown} value @param {string} what @returns {string} */
function asString(value, what) {
  if (typeof value !== "string") {
    throw new Error(`${what} must be a string`);
  }
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {unknown} value @param {string} what @returns {Record<string, unknown>} */
function asRecord(value, what) {
  if (!isRecord(value)) {
    throw new Error(`${what} must be an object`);
  }
  return value;
}

/** @param {unknown} value @param {string} what @returns {HostFacts} */
function asHostFacts(value, what) {
  const record = asRecord(value, what);
  return {
    version: asString(record.version, `${what}.version`),
    indexSha256: asString(record.indexSha256, `${what}.indexSha256`),
    cliSha256: asString(record.cliSha256, `${what}.cliSha256`),
    runtimeLockSha256: asString(record.runtimeLockSha256, `${what}.runtimeLockSha256`),
    runtimeGraphSha256: asString(record.runtimeGraphSha256, `${what}.runtimeGraphSha256`),
    cohort: record.cohort,
    companions: record.companions,
  };
}

/** @param {unknown} value @returns {Release} */
function asRelease(value) {
  const record = asRecord(value, "release.json");
  const hosts = asRecord(record.hosts, "release.json hosts");
  return {
    repository: asString(record.repository, "release.repository"),
    name: asString(record.name, "release.name"),
    source: asString(record.source, "release.source"),
    releaseSource: asString(record.releaseSource, "release.releaseSource"),
    version: asString(record.version, "release.version"),
    filename: asString(record.filename, "release.filename"),
    sha256: asString(record.sha256, "release.sha256"),
    hosts: {
      official: asHostFacts(hosts.official, "release.hosts.official"),
      fork: {
        ...asHostFacts(hosts.fork, "release.hosts.fork"),
        provenance: {
          ref: asString(
            asRecord(
              asRecord(hosts.fork, "release.hosts.fork").provenance,
              "release.hosts.fork.provenance",
            ).ref,
            "release.hosts.fork.provenance.ref",
          ),
        },
      },
    },
  };
}

const source = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const artifact = resolve(values.artifact);
const output = resolve(values.output);
// QX-005 (typescript/no-unsafe-type-assertion, file override in .oxlintrc.json):
// the automation repository is resolved at runtime and ships no type source, so
// these dynamic imports are `any`. Each single boundary assertion below declares
// the helper signatures this script consumes; no assertion-free alternative
// exists for runtime-resolved modules, and every member is exercised immediately
// so a wrong shape fails fast.
const { isolatedEnvironment, readJson, run, sha256, writeJson } = /** @type {CommonModule} */ (
  await import(pathToFileURL(join(resolve(values.automation), "scripts/common.mjs")).href)
);
const { prepareHost, selectDevelopmentHost } = /** @type {HostsModule} */ (
  await import(pathToFileURL(join(resolve(values.automation), "scripts/hosts.mjs")).href)
);

const release = asRelease(readJson(join(artifact, "release.json")));
assert.equal(release.repository, values.repository, "Candidate repository differs from the caller");
assert.equal(release.name, "@fitchmultz/pi-workflows");
assert.equal(release.source, values["source-ref"], "Candidate source differs from the plan");
assert.equal(
  release.releaseSource,
  values["release-source"],
  "Candidate queue source differs from the plan",
);
assert.equal(
  run("git", ["rev-parse", "HEAD"], { cwd: source, quiet: true }).trim(),
  release.source,
);
assert.equal(
  run("git", ["status", "--porcelain"], { cwd: source, quiet: true }).trim(),
  "",
  "Qualification source must be clean",
);
const pkgVersion = asString(
  asRecord(readJson(join(source, "package.json")), "package.json").version,
  "package.json version",
);
assert.equal(pkgVersion, release.version);
assert.equal(release.hosts.official.version, values["official-version"]);
assert.equal(release.hosts.fork.provenance.ref, values["fork-ref"]);
assert.equal(basename(release.filename), release.filename);
const tarball = join(artifact, release.filename);
assert.equal(sha256(tarball), release.sha256, "Candidate tarball differs from its receipt");

const env = isolatedEnvironment(join(output, "isolation"));
const host = await prepareHost(
  join(output, "host"),
  values.host,
  values.host === "official" ? values["official-version"] : resolve(values["fork-artifact"]),
  env,
);
const expected = values.host === "official" ? release.hosts.official : release.hosts.fork;
/** @type {Array<[string, string, string]>} */
const hostChecks = [
  ["version", host.version, expected.version],
  ["indexSha256", host.indexSha256, expected.indexSha256],
  ["cliSha256", host.cliSha256, expected.cliSha256],
  ["runtimeLockSha256", host.runtimeLockSha256, expected.runtimeLockSha256],
  ["runtimeGraphSha256", host.runtimeGraphSha256, expected.runtimeGraphSha256],
];
for (const [key, actual, wanted] of hostChecks) {
  assert.equal(actual, wanted, `${values.host} host ${key} differs from candidate preparation`);
}
assert.deepEqual(host.cohort, expected.cohort, `${values.host} host Pi cohort differs`);
assert.deepEqual(host.companions, expected.companions, `${values.host} host companions differ`);
const selected = selectDevelopmentHost(source, host, env);
run(process.execPath, ["--test", "scripts/package.test.mjs"], {
  cwd: source,
  env: {
    ...env,
    PI_WORKFLOWS_TARBALL: tarball,
    PI_COMPAT_HOST: values.host,
    PI_COMPAT_EXPECTED_VERSION: host.version,
    PI_COMPAT_EXPECTED_PACKAGE_DIR: selected.packageDir,
    PI_HOST_CLI: selected.cli,
  },
});
assert.equal(sha256(tarball), release.sha256, "Candidate tarball changed during qualification");
writeJson(join(output, "report.json"), {
  source: release.source,
  releaseSource: release.releaseSource,
  candidateSha256: release.sha256,
  candidateVersion: release.version,
  host: values.host,
  hostVersion: host.version,
  indexSha256: host.indexSha256,
  cliSha256: host.cliSha256,
  runtimeLockSha256: host.runtimeLockSha256,
  runtimeGraphSha256: host.runtimeGraphSha256,
});
