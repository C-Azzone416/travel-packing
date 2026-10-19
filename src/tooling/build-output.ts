// After `vercel build` (#20): the output a deploy would upload must actually contain the app. This app is server-rendered
// (every route is dynamic), so a healthy output has server functions. An output with none would deploy "successfully" and
// answer every request with a 404, so it must stop the run before anything is uploaded. Reports facts only, never contents.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

/** Counts the `.func` bundles and totals the bytes of every file under `dir`. */
function measure(dir: string, depth = 0): { functions: number; bytes: number } {
  const total = { functions: 0, bytes: 0 };
  if (depth > MAX_DEPTH + 4) return total;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return total;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let info;
    try {
      info = statSync(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (entry.endsWith(".func")) total.functions += 1;
      const inner = measure(full, depth + 1);
      total.functions += inner.functions;
      total.bytes += inner.bytes;
    } else {
      total.bytes += info.size;
    }
  }
  return total;
}

/** Facts about an output directory, to read in the run log: function count, total size, and the framework config.json names. */
export function buildOutputSummary(outputDir: string): string[] {
  if (!existsSync(outputDir)) return ["build output summary: the directory does not exist"];
  const { functions, bytes } = measure(outputDir);
  let framework = "(none named)";
  try {
    const config = JSON.parse(readFileSync(join(outputDir, "config.json"), "utf8")) as {
      framework?: { slug?: unknown; version?: unknown };
    };
    const slug = typeof config.framework?.slug === "string" ? config.framework.slug : "";
    const version = typeof config.framework?.version === "string" ? config.framework.version : "";
    if (slug) framework = version ? `${slug} ${version}` : slug;
  } catch {
    framework = "(config.json unreadable)";
  }
  return [
    `build output summary: ${functions} function bundles, ${(bytes / 1024 / 1024).toFixed(1)} MB in total (symlinks followed)`,
    `build output summary: config.json framework: ${framework}`,
  ];
}
