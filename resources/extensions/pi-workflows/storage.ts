import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseMeta, type WorkflowMeta } from "./runtime.ts";

const here = dirname(fileURLToPath(import.meta.url));
const piDir = join(here, "..", "..");

export const skillsDir = join(piDir, "skills");
export const agentsDir = join(piDir, "agents");
export const promptsDir = join(piDir, "prompts");

export function listDirNames(dir: string, kind: "dir" | "file"): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => (kind === "dir" ? e.isDirectory() : e.isFile() && e.name.endsWith(".md")))
    .map((e) => (kind === "dir" ? e.name : e.name.replace(/\.md$/, "")))
    .sort();
}

export function walkWorkflowDirs(cwd: string): string[] {
  const dirs: string[] = [];
  let dir = cwd;
  for (;;) {
    const candidate = join(dir, ".pi", "workflows");
    if (existsSync(candidate)) {
      dirs.push(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    if (existsSync(join(dir, ".git"))) {
      break;
    }
    dir = parent;
  }
  return dirs;
}

export function discoverSaved(
  cwd: string,
): Map<string, { meta: WorkflowMeta; source: string; path: string }> {
  const found = new Map<string, { meta: WorkflowMeta; source: string; path: string }>();
  for (const dir of walkWorkflowDirs(cwd).reverse()) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
      const path = join(dir, file);
      const source = readFileSync(path, "utf8");
      try {
        const meta = parseMeta(source);
        found.set(meta.name, { meta, source, path });
      } catch {
        // skip invalid scripts
      }
    }
  }
  return found;
}

export function repoRoot(cwd: string): string {
  let dir = cwd;
  const root = cwd;
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return root;
    }
    dir = parent;
  }
}

export function saveScript(cwd: string, script: string): string {
  const meta = parseMeta(script);
  const dir = walkWorkflowDirs(cwd)[0] ?? join(repoRoot(cwd), ".pi", "workflows");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${meta.name}.js`);
  writeFileSync(path, script.endsWith("\n") ? script : `${script}\n`);
  return path;
}
