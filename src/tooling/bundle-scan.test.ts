import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  readBundle,
  scanDirectory,
  scanFiles,
  SECRET_ENV_NAMES,
  SECRET_VALUE_PATTERNS,
  SERVER_ONLY_MARKERS,
} from "./bundle-scan";

const clean = { path: "a.js", text: "console.log('hello world');" };
const scratch = mkdtempSync(join(tmpdir(), "bundle-scan-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("scanFiles", () => {
  it("passes ordinary client code", () => {
    expect(scanFiles([clean])).toEqual([]);
  });

  it.each(SECRET_ENV_NAMES)("fails when client code names %s", (name) => {
    const findings = scanFiles([{ path: "chunk.js", text: `x=process.env.${name};` }]);
    expect(findings).toEqual([{ path: "chunk.js", problem: `names the server secret ${name}` }]);
  });

  it("does not trip on a name that merely contains a secret name", () => {
    expect(scanFiles([{ path: "a.js", text: "MY_DATABASE_URL_NOTE_ x_SEED_OWNER_IDS" }])).toEqual(
      [],
    );
  });

  it.each([
    ["a database URL with credentials", "postgres://user:hunter2@db.example.test/app"],
    ["a database URL with credentials", "postgresql://user:hunter2@db.example.test/app"],
    ["a private key", ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" ")],
    // Built at run time so this file is not itself a secret-shaped string (gitleaks scans the repository).
    ["an AWS access key id", ["AKIA", "ABCDEFGHIJKLMNOP"].join("")],
    ["a GitHub token", `ghp_${"a".repeat(36)}`],
    ["a Stripe-style secret key", `sk_live_${"b".repeat(20)}`],
  ])("fails an injected secret value: %s", (problem, text) => {
    const findings = scanFiles([{ path: "leak.js", text: `var s="${text}";` }]);
    expect(findings).toEqual([{ path: "leak.js", problem: `contains ${problem}` }]);
  });

  it("allows a database URL without a password (a host name in documentation)", () => {
    expect(scanFiles([{ path: "a.js", text: "postgres://db.example.test/app" }])).toEqual([]);
  });

  it.each(SERVER_ONLY_MARKERS)("fails when server-only code appears: $name", (marker) => {
    const findings = scanFiles([{ path: "c.js", text: `function ${marker.text}(){}` }]);
    expect(findings).toEqual([
      { path: "c.js", problem: `contains server-only code (${marker.name})` },
    ]);
  });

  it("never prints the secret itself", () => {
    const secret = "postgres://user:hunter2@db.example.test/app";
    const printed = JSON.stringify(scanFiles([{ path: "leak.js", text: secret }]));
    expect(printed).not.toContain("hunter2");
    expect(printed).not.toContain("db.example.test");
  });
});

describe("the markers are real", () => {
  it.each(SERVER_ONLY_MARKERS)("$name: its text is still in $source", (marker) => {
    expect(readFileSync(join(process.cwd(), marker.source), "utf8")).toContain(marker.text);
  });

  it("every value pattern is a distinct, named rule", () => {
    const names = SECRET_VALUE_PATTERNS.map((rule) => rule.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("scanDirectory and the CLI", () => {
  it("reads nested text files only and scans them", () => {
    const dir = join(scratch, "bundle");
    mkdirSync(join(dir, "chunks"), { recursive: true });
    writeFileSync(join(dir, "chunks", "a.js"), "ok");
    writeFileSync(join(dir, "image.png"), "postgres://user:hunter2@db.example.test/app");
    expect(readBundle(dir).map((file) => file.path)).toEqual([join(dir, "chunks", "a.js")]);
    expect(scanDirectory(dir)).toEqual([]);
  });

  const run = (dir: string) =>
    spawnSync("npx", ["tsx", "scripts/check-client-bundle.ts", dir], {
      cwd: process.cwd(),
      encoding: "utf8",
    });

  it("the CLI exits 0 on a clean bundle and 1 on an injected secret, without printing it", () => {
    const good = join(scratch, "good");
    mkdirSync(good);
    writeFileSync(join(good, "a.js"), "console.log(1)");
    expect(run(good).status).toBe(0);

    const bad = join(scratch, "bad");
    mkdirSync(bad);
    writeFileSync(join(bad, "leak.js"), 'var url="postgres://user:hunter2@db.example.test/app";');
    const result = run(bad);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("contains a database URL with credentials");
    expect(result.stderr + result.stdout).not.toContain("hunter2");
  }, 60_000);

  it("the CLI exits 2 when there is no build to scan", () => {
    expect(run(join(scratch, "missing")).status).toBe(2);
  }, 60_000);
});
