import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkDeployEnv, parseEnvFile, REDACTION_MARKER } from "./deploy-env";
import { formatEnvLine, INJECTED_SECRETS, injectSecrets, readBack } from "./preview-secrets";

// The reader `vercel build` uses (Vercel CLI 64.5.0 bundles dotenv@4.0.0), copied verbatim as an independent oracle so
// these tests do not just agree with our own parseEnvFile.
function dotenv4Parse(src: string): Record<string, string> {
  const obj: Record<string, string> = {};
  src
    .toString()
    .split("\n")
    .forEach((line) => {
      const keyValueArr = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (keyValueArr != null) {
        const key = keyValueArr[1];
        let value = keyValueArr[2] ? keyValueArr[2] : "";
        const len = value ? value.length : 0;
        if (len > 0 && value.charAt(0) === '"' && value.charAt(len - 1) === '"') {
          value = value.replace(/\\n/gm, "\n");
        }
        value = value.replace(/(^['"]|['"]$)/g, "").trim();
        obj[key] = value;
      }
    });
  return obj;
}

const PULLED = [
  "# Created by Vercel CLI",
  `DATABASE_URL="${REDACTION_MARKER}"`,
  `DATABASE_URL_UNPOOLED="${REDACTION_MARKER}"`,
  'LOCATION_PROVIDER="open-meteo"',
  `NEON_AUTH_COOKIE_SECRET="${REDACTION_MARKER}"`,
  'NEON_AUTH_BASE_URL="https://auth.example.test"',
  `OWNER_EMAIL_ALLOWLIST="${REDACTION_MARKER}"`,
  'VERCEL_ENV="preview"',
  "",
].join("\n");

const SECRETS = {
  DATABASE_URL: "postgres://u:p@ep-prev-1-pooler.us-east-2.aws.neon.tech/db",
  DATABASE_URL_UNPOOLED: "postgres://u:p@ep-prev-1.us-east-2.aws.neon.tech/db",
  OWNER_EMAIL_ALLOWLIST: "a@example.test,b@example.test",
  NEON_AUTH_COOKIE_SECRET: "k".repeat(40),
};

function inject(file: string, secrets: Record<string, string | undefined>) {
  const result = injectSecrets(file, secrets);
  if (!result.ok) throw new Error(`unexpected refusal: ${result.problems.join("; ")}`);
  return result.text;
}

describe("injectSecrets", () => {
  it("replaces exactly the four marker entries and keeps every other line as it was", () => {
    const text = inject(PULLED, SECRETS);
    const before = PULLED.split("\n");
    const after = text.split("\n");
    expect(after).toEqual([
      "# Created by Vercel CLI",
      `DATABASE_URL="${SECRETS.DATABASE_URL}"`,
      `DATABASE_URL_UNPOOLED="${SECRETS.DATABASE_URL_UNPOOLED}"`,
      'LOCATION_PROVIDER="open-meteo"',
      `NEON_AUTH_COOKIE_SECRET="${SECRETS.NEON_AUTH_COOKIE_SECRET}"`,
      'NEON_AUTH_BASE_URL="https://auth.example.test"',
      `OWNER_EMAIL_ALLOWLIST="${SECRETS.OWNER_EMAIL_ALLOWLIST}"`,
      'VERCEL_ENV="preview"',
      "",
    ]);
    expect(after.filter((line) => !before.includes(line))).toHaveLength(4);
    expect(text).not.toContain(REDACTION_MARKER);
  });

  it("makes the file pass the validator that would have rejected the pulled one", () => {
    const base = { LOCATION_PROVIDER: "open-meteo" };
    const prod = "ep-prod-9.us-east-2.aws.neon.tech";
    expect(
      checkDeployEnv("preview", { ...base, ...parseEnvFile(PULLED) }, prod).join("\n"),
    ).toMatch(/redaction marker/);
    expect(checkDeployEnv("preview", parseEnvFile(inject(PULLED, SECRETS)), prod)).toEqual([]);
  });

  it("appends an entry the pull did not write, and drops duplicate lines for the same name", () => {
    const file = `DATABASE_URL="old1"\nOTHER=1\nDATABASE_URL="old2"\n`;
    const lines = inject(file, SECRETS).split("\n");
    expect(lines.filter((line) => line.startsWith("DATABASE_URL="))).toHaveLength(1);
    expect(lines[0]).toBe(`DATABASE_URL="${SECRETS.DATABASE_URL}"`);
    expect(lines[1]).toBe("OTHER=1");
    for (const name of INJECTED_SECRETS) {
      expect(lines.filter((line) => line.startsWith(`${name}=`))).toHaveLength(1);
    }
  });

  it("keeps CRLF line endings, and works on a file with no trailing newline", () => {
    const crlf = inject(PULLED.replace(/\n/g, "\r\n"), SECRETS);
    expect(crlf).toContain("\r\n");
    expect(crlf.replace(/\r\n/g, "")).not.toContain("\n");
    expect(readBack(crlf)).toEqual(SECRETS);
    expect(readBack(inject(PULLED.trimEnd(), SECRETS))).toEqual(SECRETS);
  });

  it("does not treat a longer name or an export line as the entry", () => {
    const file = 'DATABASE_URL_OTHER="x"\nexport DATABASE_URL="y"\n';
    const text = inject(file, SECRETS);
    expect(text).toContain('DATABASE_URL_OTHER="x"');
    expect(text).toContain('export DATABASE_URL="y"');
    expect(dotenv4Parse(text).DATABASE_URL).toBe(SECRETS.DATABASE_URL);
  });
});

describe("what the build reads back (the real dotenv 4 reader as the oracle)", () => {
  it.each([
    ["a double quote inside", 'pa"ss"word-with-a-long-enough-length-1234'],
    ["a quote at each end", '"quoted-secret-with-a-long-enough-length-12"'],
    ["single quotes at each end", "'single-quoted-secret-long-enough-length-1'"],
    ["a backslash", "pa\\ss\\word-with-a-long-enough-length-1234"],
    ["a trailing backslash", "ends-with-a-backslash-and-is-long-enough\\"],
    ["a dollar sign", "$HOME-and-${PATH}-secret-with-a-long-length"],
    ["a hash", "abc#def # not a comment secret value long enough"],
    ["an equals sign and spaces", "a = b = c secret value that is long enough"],
    ["a real newline", "line one of the secret\nline two of the secret x"],
    ["two real newlines in a row", "first part of it\n\nsecond part of the secret"],
    ["unicode", "pässwörd-日本語-secret-value-that-is-long-enough"],
  ])("round-trips a value with %s", (_name, value) => {
    const text = inject(PULLED, { ...SECRETS, NEON_AUTH_COOKIE_SECRET: value });
    expect(dotenv4Parse(text).NEON_AUTH_COOKIE_SECRET).toBe(value);
    expect(parseEnvFile(text).NEON_AUTH_COOKIE_SECRET).toBe(value);
    // The other entries are unaffected by the odd one.
    expect(dotenv4Parse(text).DATABASE_URL).toBe(SECRETS.DATABASE_URL);
  });

  it("writes an injection-shaped value as one line of data, never as a second assignment", () => {
    const value = 'x"\nEVIL="1';
    const text = inject(PULLED, { ...SECRETS, NEON_AUTH_COOKIE_SECRET: value });
    expect(dotenv4Parse(text).EVIL).toBeUndefined();
    expect(dotenv4Parse(text).NEON_AUTH_COOKIE_SECRET).toBe(value);
    expect(text.split("\n").filter((line) => line.startsWith("EVIL")).length).toBe(0);
  });

  it("formats a line with the newline escaped", () => {
    expect(formatEnvLine("A", "x\ny")).toBe('A="x\\ny"');
  });
});

describe("injectSecrets fails closed, naming only the variable", () => {
  it.each(INJECTED_SECRETS)("a missing %s", (name) => {
    const result = injectSecrets(PULLED, { ...SECRETS, [name]: undefined });
    expect(result).toEqual({ ok: false, problems: [`${name} is missing or empty`] });
  });

  it.each(INJECTED_SECRETS)("an empty or blank %s", (name) => {
    for (const value of ["", "   ", "\n"]) {
      expect(injectSecrets(PULLED, { ...SECRETS, [name]: value })).toEqual({
        ok: false,
        problems: [`${name} is missing or empty`],
      });
    }
  });

  it("reports every missing one in one go", () => {
    const result = injectSecrets(PULLED, {});
    expect(result).toEqual({
      ok: false,
      problems: INJECTED_SECRETS.map((name) => `${name} is missing or empty`),
    });
  });

  it.each([
    [
      "leading whitespace",
      " secret-value-that-is-long-enough-for-use",
      /leading or trailing whitespace/,
    ],
    [
      "a trailing newline",
      "secret-value-that-is-long-enough-for-use\n",
      /leading or trailing whitespace/,
    ],
    ["a carriage return", "secret-value-that-is\r-long-enough-for-use", /cannot be written/],
    ["a NUL", "secret-value-that-is\0-long-enough-for-use", /cannot be written/],
    [
      "a line separator",
      `secret-value-that-is${String.fromCharCode(0x2028)}-long-enough`,
      /cannot be written/,
    ],
    [
      "a paragraph separator",
      `secret-value-that-is${String.fromCharCode(0x2029)}-long-enough`,
      /cannot be written/,
    ],
    [
      "a literal backslash-n",
      "secret-value-that-is\\n-long-enough-for-use",
      /backslash followed by n/,
    ],
  ])("refuses a value with %s, never repeating it", (_name, value, message) => {
    const result = injectSecrets(PULLED, { ...SECRETS, NEON_AUTH_COOKIE_SECRET: value });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]).toMatch(/^NEON_AUTH_COOKIE_SECRET /);
    expect(result.problems[0]).toMatch(message);
    expect(result.problems[0]).not.toContain(value.trim().slice(0, 12));
  });

  it("never puts any value in a problem message", () => {
    const result = injectSecrets(PULLED, {
      ...SECRETS,
      DATABASE_URL: "",
      OWNER_EMAIL_ALLOWLIST: " b@example.test",
    });
    expect(JSON.stringify(result)).not.toMatch(/postgres|example\.test|kkkk/);
  });
});

describe("the script", () => {
  const dir = mkdtempSync(join(tmpdir(), "inject-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const tsx = join(process.cwd(), "node_modules", ".bin", "tsx");
  const script = join(process.cwd(), "scripts", "inject-preview-secrets.ts");

  function run(file: string, env: Record<string, string | undefined>) {
    // A clean environment: only what the test passes (PATH for node).
    return spawnSync(tsx, [script, file], {
      env: { PATH: process.env.PATH, ...env } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
  }

  it("injects for a preview run, prints names only, and writes the file readable by its owner alone", () => {
    const file = join(dir, "ok.env");
    writeFileSync(file, PULLED);
    const result = run(file, { TARGET: "preview", ...SECRETS });
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(
      "preview secrets: injected DATABASE_URL, DATABASE_URL_UNPOOLED, OWNER_EMAIL_ALLOWLIST, NEON_AUTH_COOKIE_SECRET (values not shown)\n",
    );
    expect(`${result.stdout}${result.stderr}`).not.toMatch(/postgres|example\.test|kkkk/);
    expect(dotenv4Parse(readFileSync(file, "utf8"))).toMatchObject(SECRETS);
    expect(statSync(file).mode & 0o077).toBe(0);
  });

  it.each([["production"], [undefined], [""], ["Preview"]])(
    "refuses when TARGET is %j and leaves the file alone",
    (target) => {
      const file = join(dir, `refused-${String(target)}.env`);
      writeFileSync(file, PULLED);
      const result = run(file, { TARGET: target, ...SECRETS });
      expect(result.status).toBe(1);
      expect(result.stderr).toBe(
        "preview secrets: refused: this is not a preview run (TARGET must be preview)\n",
      );
      expect(readFileSync(file, "utf8")).toBe(PULLED);
    },
  );

  it("fails closed on a missing secret, naming only the variable, and leaves the file alone", () => {
    const file = join(dir, "missing.env");
    writeFileSync(file, PULLED);
    const result = run(file, { TARGET: "preview", ...SECRETS, NEON_AUTH_COOKIE_SECRET: undefined });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("preview secrets: NEON_AUTH_COOKIE_SECRET is missing or empty\n");
    expect(readFileSync(file, "utf8")).toBe(PULLED);
  });

  it("fails without echoing anything when the file cannot be read, and needs a file argument", () => {
    const result = run(join(dir, "does-not-exist.env"), { TARGET: "preview", ...SECRETS });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("preview secrets: failed to update the env file\n");
    const usage = spawnSync(tsx, [script], {
      env: { PATH: process.env.PATH, TARGET: "preview" } as unknown as NodeJS.ProcessEnv,
      encoding: "utf8",
    });
    expect(usage.status).toBe(2);
  });
});
