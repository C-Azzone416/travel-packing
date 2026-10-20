import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { aliasDecision } from "./alias-head";

const A = "a".repeat(40);
const B = "b".repeat(40);

describe("aliasDecision: an older run must never replace a newer build", () => {
  it("assigns when this run's commit is the develop head", () => {
    expect(aliasDecision(A, A)).toMatchObject({ assign: true });
  });

  it("skips, naming why, when develop has moved on", () => {
    const decision = aliasDecision(A, B);
    expect(decision.assign).toBe(false);
    expect(decision.reason).toMatch(/develop has moved on/);
  });

  it("ignores case and surrounding whitespace in either SHA", () => {
    expect(aliasDecision(` ${A.toUpperCase()}\n`, A)).toMatchObject({ assign: true });
  });

  it.each([[undefined], [""], ["abc123"], ["g".repeat(40)], [`${A}0`]])(
    "fails closed (an error, not a pass) when the develop head is %j",
    (head) => {
      expect(() => aliasDecision(A, head)).toThrow(/develop head could not be read/);
    },
  );

  it.each([[undefined], [""], ["main"], [A.slice(0, 7)]])(
    "fails closed when this run's commit is %j",
    (run) => {
      expect(() => aliasDecision(run, A)).toThrow(/not a full SHA/);
    },
  );
});

describe("scripts/check-alias-head.ts", () => {
  const dir = mkdtempSync(join(tmpdir(), "alias-head-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const script = join(process.cwd(), "scripts", "check-alias-head.ts");

  function run(args: string[]) {
    const output = join(dir, `out-${Math.random().toString(16).slice(2)}`);
    writeFileSync(output, "");
    const result = spawnSync(tsx, [script, ...args], {
      env: { PATH: process.env.PATH, GITHUB_OUTPUT: output } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    return { result, output: readFileSync(output, "utf8") };
  }

  it("writes assign=true for the develop head", () => {
    const { result, output } = run([A, A]);
    expect(result.status).toBe(0);
    expect(output).toBe("assign=true\n");
    expect(result.stdout).toMatch(/^alias: ok:/);
  });

  it("writes assign=false and a notice for a stale run, and still succeeds", () => {
    const { result, output } = run([A, B]);
    expect(result.status).toBe(0);
    expect(output).toBe("assign=false\n");
    expect(result.stdout).toMatch(/^::notice::alias skipped:/);
  });

  it("fails loudly and writes nothing when a SHA is unreadable", () => {
    const { result, output } = run([A, "nope"]);
    expect(result.status).toBe(1);
    expect(output).toBe("");
    expect(result.stderr).toMatch(/develop head could not be read/);
  });
});
