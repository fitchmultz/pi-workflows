/**
 * Section 8.2 qualification battery for the strict Oxlint/Oxfmt standard.
 *
 * Every control drives the real installed toolchain (oxlint with tsgolint,
 * tsc, oxfmt, node --test, the build freshness check) against disposable
 * fixtures in temporary directories, asserting exit status, diagnostic
 * identity, and file/location. Shared-tree wiring controls run inside a
 * `git archive` copy so the checked-out tree is never mutated. The battery
 * skips itself when invoked recursively through a copied checkout.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test as nodeTest } from "node:test";
import { asArray, asRecord, asString } from "./test-helpers.mjs";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binDir = join(repoRoot, "node_modules", ".bin");
const oxlintBin = join(binDir, "oxlint");
const oxfmtBin = join(binDir, "oxfmt");
const recursive = process.env.PW_STANDARD_BATTERY === "1";
const initialTree = spawnSync("git", ["status", "--porcelain"], {
  cwd: repoRoot,
  encoding: "utf8",
}).stdout;
/** @type {string[]} */
const tempDirs = [];

/**
 * @param {string} label
 * @returns {string} fresh temporary directory tracked for cleanup
 */
function makeTempDir(label) {
  const dir = mkdtempSync(join(tmpdir(), `pw-standard-${label}-`));
  tempDirs.push(dir);
  return dir;
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, pathBin?: boolean }} [options]
 * @returns {{ status: number | null, output: string }}
 */
function run(command, args, options = {}) {
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("NODE_TEST_")) {
      delete childEnv[key];
    }
  }
  if (options.pathBin === true) {
    childEnv.PATH = `${binDir}:${childEnv.PATH ?? ""}`;
  }
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
    timeout: 120_000,
    env: childEnv,
  });
  // CI environments force colorized child output; strip ANSI escapes so
  // diagnostic identity and location matching stay deterministic.
  const raw = `${result.stdout}${result.stderr}`.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
  return { status: result.status, output: raw };
}

/**
 * Assert a run failed with the expected diagnostic identity and location.
 * Throws with `label` when the run silently passed, which is how the
 * integrity controls detect policy downgrades and omitted source.
 *
 * @param {{ status: number | null, output: string }} result
 * @param {string} diagnostic
 * @param {string} label
 */
function expectDiagnostic(result, diagnostic, label) {
  assert.notEqual(result.status, 0, `${label}: expected a failing exit status`);
  assert.ok(result.output.includes(diagnostic), `${label}: expected ${diagnostic} in output`);
}

/**
 * @param {{ status: number | null, output: string }} result
 * @param {string} label
 */
function expectClean(result, label) {
  assert.ok(
    result.status === 0,
    `${label}: expected exit 0, got ${String(result.status)}\n${result.output}`,
  );
}

/**
 * Lint explicit files with the repository configuration (type-aware rules
 * resolve each file's nearest tsconfig, so type-aware fixtures must live in
 * a typed project; syntactic fixtures may live anywhere).
 *
 * @param {string[]} files
 * @param {string} [config]
 * @returns {{ status: number | null, output: string }}
 */
function lintFiles(files, config) {
  const args = ["--deny-warnings"];
  if (config !== undefined) {
    args.push("-c", config);
  }
  return run(oxlintBin, [...args, ...files]);
}

/**
 * Lint `.` from a temporary directory holding its own configuration copy.
 * The repository `.bin` is prepended to PATH so the type-aware engine finds
 * the installed tsgolint without a node_modules symlink (which a `.` scan
 * would follow).
 *
 * @param {string} dir
 * @returns {{ status: number | null, output: string }}
 */
function lintScan(dir) {
  return run("oxlint", ["--deny-warnings", "."], { cwd: dir, pathBin: true });
}

/** @param {string} dir @returns {{ status: number | null, output: string }} */
// --pretty false pins the plain `file(line,col): error TSxxxx` diagnostic
// format so location and identity assertions hold in every environment.
const typecheckProject = (dir) =>
  run(process.execPath, [
    join(binDir, "tsc"),
    "--noEmit",
    "--pretty",
    "false",
    "-p",
    join(dir, "tsconfig.json"),
  ]);

/** @param {string} file @returns {{ status: number | null, output: string }} */
const checkFormat = (file) => run(oxfmtBin, ["--check", file]);

/** @param {string} file @returns {{ status: number | null, output: string }} */
const writeFormat = (file) => run(oxfmtBin, ["--write", file]);

/** @param {string} file @returns {{ status: number | null, output: string }} */
const runTestFile = (file) => run(process.execPath, ["--test", file]);

/**
 * A temporary project with the repository's strict compiler settings, a
 * node_modules symlink for SDK and @types resolution, and the given files.
 *
 * @param {Record<string, string>} files
 * @returns {string} project directory
 */
function typedProject(files) {
  const dir = makeTempDir("typed");
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          allowJs: true,
          checkJs: true,
          noEmit: true,
          skipLibCheck: true,
          types: ["node"],
        },
        include: ["*.ts", "*.mjs", "*.d.ts"],
      },
      null,
      2,
    ),
  );
  symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"), "dir");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/**
 * A temporary directory with no tsconfig, for syntactic-only fixtures.
 *
 * @param {Record<string, string>} files
 * @returns {string} directory
 */
function plainDir(files) {
  const dir = makeTempDir("plain");
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

/**
 * A disposable `git archive HEAD` copy of the repository with a node_modules
 * symlink, for wiring controls that must run repository gates against a
 * mutated tree without touching the checkout.
 *
 * @returns {string} copy directory
 */
function archiveCopy() {
  const dir = makeTempDir("copy");
  const extract = run("sh", ["-c", `git archive HEAD | tar -x -C ${JSON.stringify(dir)}`]);
  assert.ok(extract.status === 0, `git archive extraction failed: ${extract.output}`);
  symlinkSync(join(repoRoot, "node_modules"), join(dir, "node_modules"), "dir");
  return dir;
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {string} content
 * @returns {string} absolute file path
 */
function put(dir, name, content) {
  const file = join(dir, name);
  writeFileSync(file, content);
  return file;
}

/**
 * Generate a plain-JS function body with `count` if-branches.
 *
 * @param {number} count
 * @returns {string} source text
 */
function complexitySource(count) {
  const branches = Array.from({ length: count }, (_, i) => `if (v === ${i}) { r += ${i}; }`).join(
    " ",
  );
  return `export function cx(v) { let r = 0; ${branches} return r; }\n`;
}

/**
 * @param {number} params
 * @param {number} depth
 * @returns {string} source text
 */
function nestedSource(params, depth) {
  const names = Array.from({ length: params }, (_, i) => `p${i}`);
  const argList = names.join(", ");
  let body = `return ${names.at(-1) ?? 0};`;
  for (let i = 0; i < depth; i += 1) {
    body = `if (${names[i % Math.max(names.length, 1)] ?? "p0"}) { ${body} }`;
  }
  return `export function deep(${argList}) { ${body} return 0; }\n`;
}

/**
 * @param {number} statements
 * @returns {string} source text
 */
function statementsSource(statements) {
  const body = Array.from({ length: statements }, (_, i) => `r += ${i};`).join(" ");
  return `export function many() { let r = 0; ${body} return r; }\n`;
}

/**
 * @param {number} lines per-function code lines (blanks and comments never count)
 * @returns {string} source text
 */
function functionLinesSource(lines) {
  const body = Array.from({ length: lines }, (_, i) => `r += ${i};`).join("\n  ");
  return `export function tall() {\n  let r = 0;\n  ${body}\n  return r;\n}\n`;
}

/**
 * @param {number} lines file-level code lines (blanks and comments never count)
 * @returns {string} source text
 */
function fileLinesSource(lines) {
  const rows = Array.from({ length: lines }, (_, i) => `export const value${i} = ${i};`);
  return `${rows.join("\n")}\n`;
}

/**
 * @param {string} name
 * @param {() => void | Promise<void>} body
 * @returns {void}
 */
function control(name, body) {
  nodeTest(name, recursive ? { skip: "recursive battery invocation" } : {}, body);
}

control("8.2 base and composition: valid source passes", () => {
  const dir = plainDir({
    "valid.mjs": [
      "/**",
      " * @param {number} a",
      " * @param {number} b",
      " */",
      "export function add(a, b) {",
      "  return a + b;",
      "}",
      "",
    ].join("\n"),
  });
  expectClean(lintFiles([join(dir, "valid.mjs")]), "valid source");
});

control("8.2 base and composition: explicit and category violations fail with identity", () => {
  const dir = plainDir({
    "explicit.mjs": "export const eq = (a, b) => a == b;\n",
    "category.mjs": "export function f(x) { if (x = 1) { return 2; } return 3; }\n",
  });
  const explicit = lintFiles([join(dir, "explicit.mjs")]);
  expectDiagnostic(explicit, "eslint(eqeqeq)", "explicit rule violation");
  assert.ok(explicit.output.includes("explicit.mjs:1:"), "expected file:line:col for eqeqeq");
  const category = lintFiles([join(dir, "category.mjs")]);
  expectDiagnostic(category, "eslint(no-cond-assign)", "category-only violation");
  assert.ok(
    category.output.includes("category.mjs:1:30"),
    "expected file:line:col for no-cond-assign",
  );
});

control("8.2 base and composition: test overrides compose to their actual scopes", () => {
  const source = complexitySource(12);
  const dir = plainDir({ "cx.mjs": source, "cx.test.mjs": source });
  const asSource = lintFiles([join(dir, "cx.mjs")]);
  expectDiagnostic(asSource, "eslint(complexity)", "source-scope complexity");
  expectClean(
    lintFiles([join(dir, "cx.test.mjs")]),
    "test-scope complexity within the raised limit",
  );
});

control(
  "8.2 semantic and compiler: type-aware violation fails and both compiler contexts fail",
  () => {
    const dir = typedProject({
      "unsafe.ts": [
        "export function leak(value: unknown): any {",
        "  return value;",
        "}",
        "export const consumed: string = leak(1);",
        "",
      ].join("\n"),
      "err.ts": 'export const n: number = "text";\n',
      "jserr.mjs": '/** @type {number} */\nexport const j = "text";\n',
    });
    const lint = lintFiles([join(dir, "unsafe.ts")]);
    expectDiagnostic(lint, "typescript(no-unsafe-assignment)", "type-aware unsafe assignment");
    expectDiagnostic(lint, "unsafe.ts:4", "type-aware diagnostic location");
    const compile = typecheckProject(dir);
    expectDiagnostic(compile, "err.ts(1,14): error TS2322", "TypeScript context compiler error");
    expectDiagnostic(compile, "jserr.mjs(2,14): error TS2322", "checked-JS context compiler error");
  },
);

control(
  "8.2 declarations and public types: augmentation rejects invalid consumers, accepts valid ones",
  () => {
    const declarations = readFileSync(join(repoRoot, "scripts", "fork-exports.d.ts"), "utf8");
    const consumer = [
      'import { instructionGroupsExtension } from "@earendil-works/pi-coding-agent";',
      "export const factory = instructionGroupsExtension;",
      "",
    ].join("\n");
    const valid = typedProject({ "fork-exports.d.ts": declarations, "consumer.ts": consumer });
    expectClean(typecheckProject(valid), "valid consumer of the handwritten declaration");
    const invalid = typedProject({
      "fork-exports.d.ts": declarations,
      "bad-consumer.ts": [
        'import { instructionGroupsExtension } from "@earendil-works/pi-coding-agent";',
        'export const bad = instructionGroupsExtension("not-a-config");',
        "",
      ].join("\n"),
    });
    const rejected = typecheckProject(invalid);
    expectDiagnostic(rejected, "bad-consumer.ts(2,47): error TS2345", "invalid consumer rejected");
  },
);

control(
  "8.2 declarations and public types: handwritten declaration errors fail the compiler gate",
  () => {
    // Drop the final closing brace: a parse error inside the handwritten
    // declaration is reported at the declaration file, unaffected by skipLibCheck.
    const pristine = readFileSync(join(repoRoot, "scripts", "fork-exports.d.ts"), "utf8");
    const broken = pristine.slice(0, pristine.lastIndexOf("}"));
    const dir = typedProject({
      "fork-exports.d.ts": broken,
      "consumer.ts": [
        'import { instructionGroupsExtension } from "@earendil-works/pi-coding-agent";',
        "export const factory = instructionGroupsExtension;",
        "",
      ].join("\n"),
    });
    const failed = typecheckProject(dir);
    expectDiagnostic(
      failed,
      "fork-exports.d.ts",
      "declaration error attributed to the declaration file",
    );
    expectDiagnostic(failed, "error TS1005", "parse error in the declaration");
  },
);

control("8.2 type safety: unsafe assertion fails, valid narrowing passes", () => {
  const dir = typedProject({
    "assertion.ts": [
      "export function asText(value: any): string {",
      "  return value as string;",
      "}",
      "",
    ].join("\n"),
    "narrow.ts": [
      "export function isText(value: unknown): value is string {",
      '  return typeof value === "string";',
      "}",
      "export function length(value: unknown): number {",
      "  return isText(value) ? value.length : 0;",
      "}",
      "",
    ].join("\n"),
  });
  const lint = lintFiles([join(dir, "assertion.ts")]);
  expectDiagnostic(lint, "typescript(no-unsafe-type-assertion)", "unsafe type assertion");
  expectDiagnostic(lint, "assertion.ts:2", "assertion diagnostic location");
  expectClean(lintFiles([join(dir, "narrow.ts")]), "valid narrowing");
  expectClean(typecheckProject(dir), "narrowed code compiles");
});

control("8.2 async safety: floating work and invalid rejections fail, owned work passes", () => {
  const dir = typedProject({
    "floating.ts": [
      "export function work(): Promise<void> {",
      "  return Promise.resolve();",
      "}",
      "export function caller(): void {",
      "  work();",
      "}",
      "",
    ].join("\n"),
    "rejections.ts": ["export const reject = (): void => {", "  Promise.reject();", "};", ""].join(
      "\n",
    ),
    "misused.ts": [
      "async function each(): Promise<void> {}",
      "export const run = (): void => {",
      "  [1].forEach(each);",
      "};",
      "",
    ].join("\n"),
    "owned.ts": [
      "export async function owned(): Promise<void> {",
      "  await Promise.resolve();",
      "}",
      "export function forward(): Promise<void> {",
      "  return Promise.resolve();",
      "}",
      "",
    ].join("\n"),
  });
  const floating = lintFiles([join(dir, "floating.ts")]);
  expectDiagnostic(floating, "typescript(no-floating-promises)", "floating promise");
  expectDiagnostic(floating, "floating.ts:5:3", "floating diagnostic location");
  const rejections = lintFiles([join(dir, "rejections.ts")]);
  expectDiagnostic(rejections, "typescript(prefer-promise-reject-errors)", "empty rejection");
  const misused = lintFiles([join(dir, "misused.ts")]);
  expectDiagnostic(misused, "typescript(no-misused-promises)", "async callback misuse");
  expectClean(lintFiles([join(dir, "owned.ts")]), "owned and forwarded work");
});

control("8.2 structural profiles: all six production metrics fail at their boundaries", () => {
  const dir = plainDir({
    "complexity.mjs": complexitySource(12),
    "nested.mjs": nestedSource(5, 4),
    "statements.mjs": statementsSource(45),
    "function-lines.mjs": functionLinesSource(85),
    "file-lines.mjs": fileLinesSource(505),
  });
  /** @type {[string, string][]} */
  const cases = [
    ["complexity.mjs", "eslint(complexity)"],
    ["nested.mjs", "eslint(max-params)"],
    ["nested.mjs", "eslint(max-depth)"],
    ["statements.mjs", "eslint(max-statements)"],
    ["function-lines.mjs", "eslint(max-lines-per-function)"],
    ["file-lines.mjs", "eslint(max-lines)"],
  ];
  for (const [name, diagnostic] of cases) {
    expectDiagnostic(lintFiles([join(dir, name)]), diagnostic, `structural boundary ${name}`);
  }
});

control("8.2 structural profiles: long tests pass while test boundaries still fail", () => {
  const longTest = [
    complexitySource(12),
    statementsSource(45),
    functionLinesSource(85),
    fileLinesSource(505),
  ].join("\n");
  const dir = plainDir({
    "long.test.mjs": longTest,
    "over.test.mjs": `${complexitySource(16)}\n${nestedSource(7, 5)}`,
  });
  expectClean(lintFiles([join(dir, "long.test.mjs")]), "oversized test fixture within test limits");
  const over = lintFiles([join(dir, "over.test.mjs")]);
  expectDiagnostic(over, "eslint(complexity)", "test complexity above the raised limit");
  expectDiagnostic(over, "eslint(max-params)", "test parameters above the raised limit");
  expectDiagnostic(over, "eslint(max-depth)", "test depth above the raised limit");
});

control(
  "8.2 framework behavior: passing test passes and failed assertion fails the test command",
  () => {
    const dir = plainDir({
      "good.test.mjs":
        'import assert from "node:assert/strict";\nimport { test as nodeTest } from "node:test";\nnodeTest("passes", () => {\n  assert.equal(1, 1);\n});\n',
      "bad.test.mjs":
        'import assert from "node:assert/strict";\nimport { test as nodeTest } from "node:test";\nnodeTest("fails", () => {\n  assert.equal(1, 2);\n});\n',
    });
    expectClean(runTestFile(join(dir, "good.test.mjs")), "valid test file");
    const failed = runTestFile(join(dir, "bad.test.mjs"));
    assert.notEqual(failed.status, 0, "failed assertion must fail the test command");
    assert.ok(failed.output.includes("fails"), "failing test named in output");
  },
);

control("8.2 node registration: intended unawaited registrations pass", () => {
  const dir = typedProject({
    "register.ts": [
      'import { test as nodeTest } from "node:test";',
      "const mark = (): number => 1;",
      'nodeTest("top level", () => {',
      "  mark();",
      "});",
      "",
    ].join("\n"),
  });
  expectClean(lintFiles([join(dir, "register.ts")]), "unawaited top-level registration");
});

control("8.2 node registration: unawaited context subtest fails", () => {
  const dir = typedProject({
    "subtest.ts": [
      'import { test as nodeTest } from "node:test";',
      "const mark = (): number => 1;",
      'nodeTest("outer", (t) => {',
      "  mark();",
      '  t.test("inner", () => {',
      "    mark();",
      "  });",
      "});",
      "",
    ].join("\n"),
  });
  const failed = lintFiles([join(dir, "subtest.ts")]);
  expectDiagnostic(failed, "typescript(no-floating-promises)", "unawaited context subtest");
  expectDiagnostic(failed, "subtest.ts:5:", "subtest diagnostic location");
});

control("8.2 node registration: same-named local and imported promises fail", () => {
  const dir = typedProject({
    "helper.ts": "export const nodeTest = async (): Promise<void> => {};\n",
    "local.ts": [
      "const nodeTest = (): Promise<void> => Promise.resolve();",
      "export const run = (): void => {",
      "  nodeTest();",
      "};",
      "",
    ].join("\n"),
    "foreign.ts": [
      'import { nodeTest } from "./helper.ts";',
      "export const run = (): void => {",
      "  nodeTest();",
      "};",
      "",
    ].join("\n"),
  });
  const local = lintFiles([join(dir, "local.ts")]);
  expectDiagnostic(local, "typescript(no-floating-promises)", "same-named local promise");
  expectDiagnostic(local, "local.ts:3", "local diagnostic location");
  const foreign = lintFiles([join(dir, "foreign.ts")]);
  expectDiagnostic(foreign, "typescript(no-floating-promises)", "same-named imported promise");
  expectDiagnostic(foreign, "foreign.ts:3", "import diagnostic location");
});

control(
  "8.2 node registration: floating and unrelated promises inside and outside tests fail",
  () => {
    const dir = typedProject({
      "work.ts": "export const work = (): Promise<void> => Promise.resolve();\n",
      "inside.ts": [
        'import { test as nodeTest } from "node:test";',
        'import { work } from "./work.ts";',
        'nodeTest("body", () => {',
        "  work();",
        "});",
        "",
      ].join("\n"),
      "outside.ts": [
        'import { work } from "./work.ts";',
        "export const run = (): void => {",
        "  work();",
        "};",
        "",
      ].join("\n"),
    });
    const inside = lintFiles([join(dir, "inside.ts")]);
    expectDiagnostic(
      inside,
      "typescript(no-floating-promises)",
      "floating promise inside a test body",
    );
    expectDiagnostic(inside, "inside.ts:4", "in-body diagnostic location");
    const outside = lintFiles([join(dir, "outside.ts")]);
    expectDiagnostic(outside, "typescript(no-floating-promises)", "unrelated floating promise");
  },
);

control(
  "8.2 exceptions and directives: accepted directive passes, unused and unauthorized fail",
  () => {
    const dir = plainDir({
      "accepted.mjs":
        "// oxlint-disable-next-line eslint/eqeqeq\nexport const eq = (a, b) => a == b;\n",
      "unused.mjs": "// oxlint-disable-next-line eslint/eqeqeq\nexport const one = 1;\n",
      "copied.mjs": "// oxlint-disable-next-line eslint/max-params\nexport const one = 1;\n",
      "eslint-style.mjs":
        "// eslint-disable-next-line eqeqeq\nexport const eq = (a, b) => a == b;\n",
    });
    expectClean(lintFiles([join(dir, "accepted.mjs")]), "directive suppressing a real violation");
    expectDiagnostic(
      lintFiles([join(dir, "unused.mjs")]),
      "Unused oxlint-disable directive",
      "unused directive",
    );
    expectDiagnostic(
      lintFiles([join(dir, "copied.mjs")]),
      "Unused oxlint-disable directive",
      "copied directive at wrong site",
    );
    const unauthorized = lintFiles([join(dir, "eslint-style.mjs")]);
    expectDiagnostic(unauthorized, "eslint(eqeqeq)", "eslint-prefixed directive has no effect");
    expectDiagnostic(
      unauthorized,
      "eslint-style.mjs:2:31",
      "violation location under the inert directive",
    );
  },
);

control("8.2 formatting and freshness: misformatted source fails and formatting is stable", () => {
  const dir = makeTempDir("format");
  const file = put(dir, "messy.mjs", "const  x=1\nexport{x}\n");
  assert.notEqual(
    checkFormat(file).status,
    0,
    "misformatted maintained-style source must fail --check",
  );
  expectClean(writeFormat(file), "first format pass");
  expectClean(checkFormat(file), "formatted source passes --check");
  const once = readFileSync(file, "utf8");
  expectClean(writeFormat(file), "second format pass");
  assert.equal(readFileSync(file, "utf8"), once, "repeated formatting must be stable");
});

control("8.2 formatting and freshness: stale generated output fails the freshness gate", () => {
  const copy = archiveCopy();
  const generated = join(copy, "resources", "extensions", "pi-workflows", "index.ts");
  writeFileSync(generated, `${readFileSync(generated, "utf8")}\n// stale mutation\n`);
  const stale = run("npm", ["run", "check", "--silent"], { cwd: copy });
  assert.notEqual(stale.status, 0, "stale generated output must fail npm run check");
});

control("8.2 integrity: policy downgrade is detected instead of passing silently", () => {
  const dir = makeTempDir("downgrade");
  put(dir, "violation.mjs", "export const eq = (a, b) => a == b;\n");
  put(dir, "clean.mjs", "export const one = 1;\n");
  const config = asRecord(JSON.parse(readFileSync(join(repoRoot, ".oxlintrc.json"), "utf8")));
  asRecord(config.rules).eqeqeq = "off";
  put(dir, ".oxlintrc.json", JSON.stringify(config, null, 2));
  const downgraded = lintScan(dir);
  assert.equal(downgraded.status, 0, "downgraded policy must let the violation pass silently");
  assert.throws(
    () => expectDiagnostic(downgraded, "eslint(eqeqeq)", "downgrade probe"),
    /expected a failing exit status/,
    "the battery must flag a policy downgrade as a failed control",
  );
});

control("8.2 integrity: omitted maintained source is detected instead of passing silently", () => {
  const dir = makeTempDir("omitted");
  put(dir, "violation.mjs", "export const eq = (a, b) => a == b;\n");
  put(dir, "clean.mjs", "export const one = 1;\n");
  const config = asRecord(JSON.parse(readFileSync(join(repoRoot, ".oxlintrc.json"), "utf8")));
  config.ignorePatterns = ["**/violation.mjs"];
  put(dir, ".oxlintrc.json", JSON.stringify(config, null, 2));
  const omitted = lintScan(dir);
  assert.equal(omitted.status, 0, "omitted source must let the violation pass silently");
  assert.throws(
    () => expectDiagnostic(omitted, "eslint(eqeqeq)", "omission probe"),
    /expected a failing exit status/,
    "the battery must flag omitted maintained source as a failed control",
  );
  const intact = asRecord(JSON.parse(readFileSync(join(repoRoot, ".oxlintrc.json"), "utf8")));
  assert.deepEqual(
    asArray(intact.ignorePatterns).map(asString),
    ["reference/", "resources/", ".pi/skills/", ".pi/agents/", ".pi/prompts/"],
    "repository ignore mappings unchanged",
  );
});

control("8.2 acceptance wiring: each gate fails independently in a mutated copy", () => {
  const copy = archiveCopy();
  const helpers = join(copy, "scripts", "test-helpers.mjs");
  const extension = join(copy, ".pi", "extensions", "pi-workflows", "ui.ts");
  const helpersOriginal = readFileSync(helpers, "utf8");
  const extensionOriginal = readFileSync(extension, "utf8");
  const gate = (/** @type {string} */ task) => run("npm", ["run", task, "--silent"], { cwd: copy });
  try {
    writeFileSync(helpers, `${helpersOriginal}\nexport const wired = (a, b) => a == b;\n`);
    const lint = gate("lint");
    expectDiagnostic(lint, "eslint(eqeqeq)", "lint gate");
    const aggregate = gate("check:compat");
    assert.notEqual(aggregate.status, 0, "lint failure must fail the aggregate");
    assert.ok(
      aggregate.output.includes("eslint(eqeqeq)"),
      "the aggregate must fail at the lint stage itself",
    );
    writeFileSync(helpers, helpersOriginal);
    writeFileSync(
      extension,
      `${extensionOriginal}\nconst leaked: any = undefined as any;\nexport { leaked };\n`,
    );
    expectDiagnostic(gate("lint"), "typescript(no-unsafe-type-assertion)", "semantic gate");
    writeFileSync(extension, extensionOriginal);
    put(
      join(copy, "scripts"),
      "wiring-type-error.mjs",
      "/** @type {number} */\nconst broken='text';\nexport{broken};\n",
    );
    const compile = gate("typecheck");
    expectDiagnostic(compile, "wiring-type-error.mjs", "compiler gate");
    expectDiagnostic(compile, "error TS2322", "compiler diagnostic identity");
    const formatter = gate("format:check");
    assert.notEqual(formatter.status, 0, "misformatting must fail the format gate");
  } finally {
    writeFileSync(helpers, helpersOriginal);
    writeFileSync(extension, extensionOriginal);
    rmSync(join(copy, "scripts", "wiring-type-error.mjs"), { force: true });
  }
});

control("8.2 acceptance wiring: test failure fails the aggregate through the full chain", () => {
  const copy = archiveCopy();
  const manifest = asRecord(JSON.parse(readFileSync(join(copy, "package.json"), "utf8")));
  const scripts = asRecord(manifest.scripts);
  const suiteGlob = asString(scripts.test);
  assert.ok(
    /node --test .*scripts\/\*\.test\.mjs/.test(suiteGlob),
    "the battery must be part of the repository test suite",
  );
  const chained = asString(scripts["check:compat"]);
  for (const stage of ["check", "lint", "format:check", "typecheck", "test"]) {
    assert.ok(
      chained.includes(`npm run ${stage}`) || (stage === "test" && chained.includes("npm test")),
      `aggregate must chain the ${stage} gate`,
    );
  }
  put(
    join(copy, "scripts"),
    "wiring-fail.test.mjs",
    'import assert from "node:assert/strict";\nimport { test as nodeTest } from "node:test";\nnodeTest("wiring propagation probe", () => {\n  assert.equal(1, 2);\n});\n',
  );
  scripts.test = "node --test scripts/wiring-fail.test.mjs";
  put(copy, "package.json", `${JSON.stringify(manifest, null, 2)}\n`);
  const aggregate = run("npm", ["run", "check:compat", "--silent"], {
    cwd: copy,
    pathBin: true,
  });
  assert.notEqual(aggregate.status, 0, "a failing test must fail the aggregate result");
  assert.ok(
    aggregate.output.includes("wiring propagation probe"),
    "the aggregate must fail at the test stage itself, not an earlier gate",
  );
});

control("8.2 acceptance wiring: policy failure fails the suite through this battery", () => {
  const dir = makeTempDir("policy");
  put(dir, "violation.mjs", "export const eq = (a, b) => a == b;\n");
  put(dir, "clean.mjs", "export const one = 1;\n");
  const config = asRecord(JSON.parse(readFileSync(join(repoRoot, ".oxlintrc.json"), "utf8")));
  asRecord(config.rules).eqeqeq = "off";
  put(dir, ".oxlintrc.json", JSON.stringify(config, null, 2));
  const downgraded = lintScan(dir);
  assert.equal(downgraded.status, 0, "setup: downgraded policy passes the raw gate");
  assert.throws(
    () => expectDiagnostic(downgraded, "eslint(eqeqeq)", "policy wiring probe"),
    /expected a failing exit status/,
    "a policy downgrade fails this battery, which npm test chains into the aggregate",
  );
});

after(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  const finalTree = spawnSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).stdout;
  assert.equal(
    finalTree,
    initialTree,
    "the shared working tree must be restored before final verification",
  );
});
