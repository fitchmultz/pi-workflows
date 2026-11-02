// build-check.mjs — validation: the generated port must be complete and
// self-consistent. Invoked via build.mjs (npm run check) and by tests.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import {
  DST_AGENTS,
  DST_PROMPTS,
  DST_SKILLS,
  PACKAGE_RESOURCES,
  RESOURCE_DIRS,
  ROOT,
  SRC_AGENTS,
  SRC_SKILLS,
  agentNamespacePattern,
  parseFrontmatter,
  recipeContent,
  skillInvocationArgs,
  toPromptTemplate,
  transformAgent,
  transformContent,
} from "./build-lib.mjs";

/** @param {string} a @param {string} b @returns {number} */
function byCodeUnit(a, b) {
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Validation: the generated port must be complete and self-consistent.
// ---------------------------------------------------------------------------

/** @param {string} dir @returns {Generator<string>} */
function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(p);
    } else {
      yield p;
    }
  }
}

/**
 * @param {string} dir
 * @param {string} projectDir
 * @param {string} packageDir
 * @param {string[]} projectFiles
 * @returns {string[]}
 */
function publicTreeProblems(dir, projectDir, packageDir, projectFiles) {
  const problems = [];
  for (const file of projectFiles) {
    const target = join(packageDir, file);
    if (!existsSync(target) || !readFileSync(join(projectDir, file)).equals(readFileSync(target))) {
      problems.push(`public ${dir}/${file} differs from source-owned project asset`);
    }
  }
  return problems;
}

/** @returns {string[]} */
function checkPublicTrees() {
  const problems = [];
  for (const dir of RESOURCE_DIRS) {
    const projectDir = join(ROOT, ".pi", dir);
    const packageDir = join(PACKAGE_RESOURCES, dir);
    if (!existsSync(packageDir)) {
      problems.push(`missing public resource directory: ${dir}`);
      continue;
    }
    const projectFiles = [...walk(projectDir)]
      .map((file) => file.slice(projectDir.length + 1))
      .sort(byCodeUnit);
    const packageFiles = [...walk(packageDir)]
      .map((file) => file.slice(packageDir.length + 1))
      .sort(byCodeUnit);
    if (JSON.stringify(projectFiles) !== JSON.stringify(packageFiles)) {
      problems.push(`public ${dir} file inventory differs from project assets`);
    }
    problems.push(...publicTreeProblems(dir, projectDir, packageDir, projectFiles));
  }
  if (
    existsSync(PACKAGE_RESOURCES) &&
    readdirSync(PACKAGE_RESOURCES).some((dir) => !RESOURCE_DIRS.includes(dir))
  ) {
    problems.push("unexpected public resource tree");
  }
  return problems;
}

/**
 * @param {string[]} srcRecipes
 * @param {string[]} dstPrompts
 * @returns {string[]}
 */
function checkRecipePrompts(srcRecipes, dstPrompts) {
  const problems = [];
  if (srcRecipes.length !== dstPrompts.length) {
    problems.push(
      `recipe prompt count: upstream ${srcRecipes.length} vs generated ${dstPrompts.length}`,
    );
  }
  for (const r of srcRecipes) {
    if (!dstPrompts.includes(`${r}.md`)) {
      problems.push(`missing recipe prompt: ${r}.md`);
      continue;
    }
    // The template pi expands must equal the translated upstream skill body.
    const expected = toPromptTemplate(
      recipeContent(readFileSync(join(SRC_SKILLS, r, "SKILL.md"), "utf8")),
    );
    const actual = readFileSync(join(DST_PROMPTS, `${r}.md`), "utf8");
    if (actual !== expected) {
      problems.push(`${r}.md: template body differs from translated skill`);
    }
  }
  return problems;
}

/**
 * @param {string[]} srcSkillDirs
 * @param {string[]} dstSkillDirs
 * @param {string[]} srcAgents
 * @param {string[]} dstAgents
 * @returns {string[]}
 */
function checkInventories(srcSkillDirs, dstSkillDirs, srcAgents, dstAgents) {
  const problems = [];
  if (srcSkillDirs.length !== dstSkillDirs.length) {
    problems.push(
      `skill count: upstream ${srcSkillDirs.length} vs generated ${dstSkillDirs.length}`,
    );
  }
  if (srcAgents.length !== dstAgents.length) {
    problems.push(`agent count: upstream ${srcAgents.length} vs generated ${dstAgents.length}`);
  }
  for (const d of srcSkillDirs) {
    if (!dstSkillDirs.includes(d)) {
      problems.push(`missing skill: ${d}`);
    }
  }
  for (const f of srcAgents) {
    if (!dstAgents.includes(f)) {
      problems.push(`missing agent: ${f}`);
    }
  }
  return problems;
}

/** @returns {string[]} */
function checkSkillContents() {
  const problems = [];
  const skillSources = [...walk(SRC_SKILLS)];
  const sourceSkillFiles = skillSources
    .map((path) => path.slice(SRC_SKILLS.length + 1))
    .sort(byCodeUnit);
  const generatedSkillFiles = existsSync(DST_SKILLS)
    ? [...walk(DST_SKILLS)].map((path) => path.slice(DST_SKILLS.length + 1)).sort(byCodeUnit)
    : [];
  if (JSON.stringify(sourceSkillFiles) !== JSON.stringify(generatedSkillFiles)) {
    problems.push("generated skill/support file inventory differs from canonical source");
  }
  for (const source of skillSources) {
    const relative = source.slice(SRC_SKILLS.length + 1);
    const target = join(DST_SKILLS, relative);
    const input = readFileSync(source);
    const expected = source.endsWith(".md")
      ? Buffer.from(
          relative.split(sep)[0]?.startsWith("recipe-") === true &&
            relative.endsWith(`${sep}SKILL.md`)
            ? skillInvocationArgs(recipeContent(input.toString()))
            : transformContent(input.toString()),
        )
      : input;
    if (!existsSync(target) || !expected.equals(readFileSync(target))) {
      problems.push(`${relative}: generated skill differs from canonical source`);
    }
  }
  return problems;
}

/** @param {string[]} srcAgents @returns {string[]} */
function checkAgentContents(srcAgents) {
  const problems = [];
  for (const file of srcAgents) {
    const target = join(DST_AGENTS, file);
    if (
      existsSync(target) &&
      readFileSync(target, "utf8") !== transformAgent(readFileSync(join(SRC_AGENTS, file), "utf8"))
    ) {
      problems.push(`${file}: generated agent differs from canonical source`);
    }
  }
  return problems;
}

/** @type {Array<[RegExp, string]>} */
const residualPatterns = [
  [agentNamespacePattern(), "plugin-namespaced agent ref"],
  [/subagent_type/g, "subagent_type"],
  [/\bTaskCreate\b|\bTaskUpdate\b|\bTodoWrite\b/g, "upstream task tool"],
  [/\bAskUserQuestion\b/g, "AskUserQuestion"],
  [/\bMultiEdit\b/g, "MultiEdit"],
  [/\bGlob\b/g, "Glob"],
  [/\bGrep\b/g, "Grep"],
  [/\bLS\b/g, "LS"],
  [/\bBash\b/g, "Bash"],
  [/\bAgent (?:tool|prompts?|invocation|calls?|routing)\b/g, "upstream Agent tool ref"],
  [/\bWebSearch\b|\bWebFetch\b/g, "upstream web tool"],
  [/Execute Skill:/g, "Execute Skill:"],
  [/\$ARGUMENTS/g, "$ARGUMENTS outside prompts"],
  [new RegExp(["cla", "ude"].join(""), "i"), "forbidden name"],
];

/** @param {string} file @param {Set<string>} agentNames @returns {string[]} */
function residualProblems(file, agentNames) {
  const problems = [];
  const text = readFileSync(file, "utf8");
  for (const [re, label] of residualPatterns) {
    if (label.startsWith("$ARGUMENTS") && file.includes(`${sep}prompts${sep}`)) {
      continue;
    }
    const hits = text.match(re);
    if (hits !== null) {
      problems.push(`${file}: residual ${label} x${hits.length}`);
    }
  }
  // Every pi-subagents agent reference must resolve to a generated agent.
  for (const m of text.matchAll(/\bagent`?\s*:\s*`?"?([a-z0-9][a-z0-9-]*)"?`?\)?/g)) {
    const ref = m[1];
    if (ref === undefined) {
      continue;
    }
    if (!agentNames.has(ref) && !["name", "the", "a", "an", "tool"].includes(ref)) {
      problems.push(`${file}: unresolved agent ref '${ref}'`);
    }
  }
  return problems;
}

/** @param {Set<string>} agentNames @returns {string[]} */
function checkResiduals(agentNames) {
  const problems = [];
  for (const dir of [DST_SKILLS, DST_AGENTS, DST_PROMPTS, join(ROOT, ".pi", "extensions")]) {
    if (!existsSync(dir)) {
      continue;
    }
    for (const file of walk(dir)) {
      problems.push(...residualProblems(file, agentNames));
    }
  }
  return problems;
}

/**
 * @param {string[]} dstAgents
 * @param {Set<string>} skillNames
 * @returns {string[]}
 */
function checkAgentFrontmatter(dstAgents, skillNames) {
  const problems = [];
  // Every skill attached to an agent must exist in .pi/skills.
  for (const f of dstAgents) {
    const { fields } = parseFrontmatter(readFileSync(join(DST_AGENTS, f), "utf8"));
    for (const s of (fields.get("skills") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (!skillNames.has(s)) {
        problems.push(`${f}: attached skill '${s}' not in .pi/skills`);
      }
    }
    // Agent tools must be pi tool names.
    for (const t of (fields.get("tools") ?? "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)) {
      if (!/^[a-z_][a-z_0-9]*$/.test(t)) {
        problems.push(`${f}: suspicious tool name '${t}'`);
      }
    }
  }
  return problems;
}

/** @returns {string[]} */
export function check() {
  const srcSkillDirs = readdirSync(SRC_SKILLS).filter((d) =>
    existsSync(join(SRC_SKILLS, d, "SKILL.md")),
  );
  const dstSkillDirs = existsSync(DST_SKILLS)
    ? readdirSync(DST_SKILLS).filter((d) => existsSync(join(DST_SKILLS, d, "SKILL.md")))
    : [];
  const srcAgents = readdirSync(SRC_AGENTS).filter((f) => f.endsWith(".md"));
  const dstAgents = existsSync(DST_AGENTS)
    ? readdirSync(DST_AGENTS).filter((f) => f.endsWith(".md"))
    : [];
  const srcRecipes = srcSkillDirs.filter((d) => d.startsWith("recipe-"));
  const dstPrompts = existsSync(DST_PROMPTS)
    ? readdirSync(DST_PROMPTS).filter((f) => f.endsWith(".md"))
    : [];
  return [
    ...checkPublicTrees(),
    ...checkRecipePrompts(srcRecipes, dstPrompts),
    ...checkInventories(srcSkillDirs, dstSkillDirs, srcAgents, dstAgents),
    ...checkSkillContents(),
    ...checkAgentContents(srcAgents),
    ...checkResiduals(new Set(dstAgents.map((f) => f.replace(/\.md$/, "")))),
    ...checkAgentFrontmatter(dstAgents, new Set(dstSkillDirs)),
  ];
}
