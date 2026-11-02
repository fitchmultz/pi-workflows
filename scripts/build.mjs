#!/usr/bin/env node
// build.mjs — regenerate project assets and public package resources from reference/.
//
// Usage: node scripts/build.mjs [--check]
//   (no flag)  wipe and regenerate those trees
//   --check    verify generated output is present, complete, and consistent
//
// The port mirrors upstream's own sync-plugins.mjs architecture: canonical
// markdown in, mechanically transformed artifacts out. All upstream-harness → pi
// translations live in build-lib.mjs; consistency checks live in build-check.mjs.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DST_AGENTS,
  DST_PROMPTS,
  DST_SKILLS,
  PACKAGE_RESOURCES,
  RESOURCE_DIRS,
  ROOT,
  SRC,
  SRC_AGENTS,
  SRC_SKILLS,
  recipeContent,
  skillInvocationArgs,
  toPromptTemplate,
  transformAgent,
  transformContent,
} from "./build-lib.mjs";
import { check } from "./build-check.mjs";

export { check } from "./build-check.mjs";
export {
  transformContent,
  transformAgent,
  toPromptTemplate,
  skillInvocationArgs,
} from "./build-lib.mjs";

const CHECK = process.argv.includes("--check");

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/** @param {string} src @param {string} dst @returns {void} */
function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      copyTree(s, d);
    } else if (entry.name.endsWith(".md")) {
      writeFileSync(d, transformContent(readFileSync(s, "utf8")));
    } else {
      cpSync(s, d);
    }
  }
}

/** @returns {void} */
export function generate() {
  if (!existsSync(SRC_SKILLS) || !existsSync(SRC_AGENTS)) {
    throw new Error(`upstream source missing under ${SRC} — clone it into reference/ first`);
  }
  rmSync(DST_SKILLS, { recursive: true, force: true });
  rmSync(DST_AGENTS, { recursive: true, force: true });
  rmSync(DST_PROMPTS, { recursive: true, force: true });
  mkdirSync(DST_SKILLS, { recursive: true });
  mkdirSync(DST_AGENTS, { recursive: true });
  mkdirSync(DST_PROMPTS, { recursive: true });

  for (const dir of readdirSync(SRC_SKILLS)) {
    copyTree(join(SRC_SKILLS, dir), join(DST_SKILLS, dir));
    if (dir.startsWith("recipe-")) {
      const skillFile = join(SRC_SKILLS, dir, "SKILL.md");
      if (existsSync(skillFile)) {
        const translated = recipeContent(readFileSync(skillFile, "utf8"));
        writeFileSync(join(DST_SKILLS, dir, "SKILL.md"), skillInvocationArgs(translated));
        writeFileSync(join(DST_PROMPTS, `${dir}.md`), toPromptTemplate(translated));
      }
    }
  }
  for (const file of readdirSync(SRC_AGENTS)) {
    if (!file.endsWith(".md")) {
      continue;
    }
    writeFileSync(
      join(DST_AGENTS, file),
      transformAgent(readFileSync(join(SRC_AGENTS, file), "utf8")),
    );
  }
  // Only these source-owned trees are distributable; never copy project .pi state.
  rmSync(PACKAGE_RESOURCES, { recursive: true, force: true });
  mkdirSync(PACKAGE_RESOURCES, { recursive: true });
  for (const dir of RESOURCE_DIRS) {
    cpSync(join(ROOT, ".pi", dir), join(PACKAGE_RESOURCES, dir), { recursive: true });
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: node scripts/build.mjs [--check]\n\nRegenerate project assets and public package resources from reference/workflows.\nExamples:\n  node scripts/build.mjs          # regenerate both layouts\n  node scripts/build.mjs --check  # verify without rewriting\nExit codes: 0 complete; 1 invalid arguments or inconsistent assets.",
    );
    process.exit(0);
  }
  if (process.argv.slice(2).some((arg) => arg !== "--check")) {
    throw new Error("Expected --check or --help");
  }
  if (!CHECK) {
    generate();
  }
  const problems = check();
  const skillCount = existsSync(DST_SKILLS) ? readdirSync(DST_SKILLS).length : 0;
  const agentCount = existsSync(DST_AGENTS) ? readdirSync(DST_AGENTS).length : 0;
  if (problems.length > 0) {
    console.error(`pi-workflows build: ${problems.length} problem(s)`);
    for (const p of problems) {
      console.error(`  - ${p}`);
    }
    process.exit(1);
  }
  console.log(
    `pi-workflows build OK: ${skillCount} skills, ${agentCount} agents (${CHECK ? "check only" : "regenerated"})`,
  );
}
