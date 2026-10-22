// Usage: tsx scripts/print-project-settings.ts [path to .vercel/project.json, default .vercel/project.json]
// Prints the five build settings that decide which builder `vercel build` uses. Never prints anything else from the file.
import { readFileSync } from "node:fs";
import { projectSettingLines } from "../src/tooling/project-settings";

const file = process.argv[2] ?? ".vercel/project.json";
let text = "";
try {
  text = readFileSync(file, "utf8");
} catch {
  console.log("project settings: .vercel/project.json does not exist");
  process.exit(0);
}
for (const line of projectSettingLines(text)) console.log(line);
