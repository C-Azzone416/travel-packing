// After `vercel build` (#20): the output a deploy would upload must actually contain the app. This app is server-rendered
// (every route is dynamic), so a healthy output has server functions. An output with none would deploy "successfully" and
// answer every request with a 404, so it must stop the run before anything is uploaded. Reports facts only, never contents.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MAX_DEPTH = 6;

/** Is there at least one `<name>.func` (a function bundle, a directory) under `dir`? */
function hasFunction(dir: string, depth = 0): boolean {
  if (depth > MAX_DEPTH) return false;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return false;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory) continue;
    if (entry.endsWith(".func")) return true;
    if (hasFunction(full, depth + 1)) return true;
  }
  return false;
}

/** What is wrong with a `.vercel/output` directory (empty when it looks like a built, server-rendered app). */
export function buildOutputProblems(outputDir: string): string[] {
  if (!existsSync(outputDir)) return ["the build output directory does not exist"];
  const problems: string[] = [];
  if (!existsSync(join(outputDir, "config.json")))
    problems.push("the build output has no config.json");
  const functions = join(outputDir, "functions");
  if (!existsSync(functions)) problems.push("the build output has no functions directory");
  else if (!hasFunction(functions))
    problems.push("the build output has no server functions, so every route would 404");
  return problems;
}
