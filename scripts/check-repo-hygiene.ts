// Fails if any tracked file breaks the repository hygiene rules (src/tooling/repo-hygiene.ts).

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { findHygieneProblems, type TrackedFile } from "../src/tooling/repo-hygiene";

const listed = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const files: TrackedFile[] = listed
  .split("\0")
  .filter(Boolean)
  .flatMap((path): TrackedFile[] => {
    try {
      const contents = readFileSync(path);
      return [
        {
          path,
          bytes: statSync(path).size,
          // NUL bytes are a conservative binary marker. All other tracked files are scanned as UTF-8 text.
          text: contents.includes(0) ? undefined : contents.toString("utf8"),
        },
      ];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return []; // tracked but deleted in the working tree: nothing to measure
      }
      return [{ path, bytes: 0, inspectionFailed: true }];
    }
  });

const problems = findHygieneProblems(files);
if (problems.length > 0) {
  console.error(`Repository hygiene check failed (${problems.length} problems):`);
  for (const problem of problems.slice(0, 20)) console.error(`  ${problem}`);
  if (problems.length > 20) console.error(`  ...and ${problems.length - 20} more`);
  process.exit(1);
}
console.log(`ok: ${files.length} tracked files pass the hygiene rules`);
