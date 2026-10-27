import { describe, expect, it } from "vitest";
import {
  LOCKED_VERCEL,
  PREVIEW_ENV_FILE,
  PREVIEW_ENV_TEXT,
  hermeticEnv,
  projectJson,
} from "./preview-output";

describe("the offline Preview build", () => {
  it("gives the CLI a PATH, a throwaway HOME and CI, and nothing else", () => {
    const env = hermeticEnv(
      {
        PATH: "/usr/bin",
        HOME: "/home/real",
        VERCEL_TOKEN: "secret",
        NODE_AUTH_TOKEN: "secret",
        VERCEL_ORG_ID: "team_real",
      },
      "/tmp/empty",
    );
    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/tmp/empty", CI: "1" });
    expect(JSON.stringify(env)).not.toContain("secret");
  });

  it("copes with no PATH", () => {
    expect(hermeticEnv({}, "/tmp/h").PATH).toBe("");
  });

  it("uses a placeholder project that names no real Vercel account, and the preview target's environment", () => {
    expect(JSON.parse(projectJson())).toEqual({
      projectId: "prj_ci",
      orgId: "team_ci",
      settings: { framework: "nextjs" },
    });
    expect(PREVIEW_ENV_FILE).toBe(".vercel/.env.preview.local");
    expect(PREVIEW_ENV_TEXT).toBe('VERCEL_ENV="preview"\n');
    expect(LOCKED_VERCEL.startsWith("tools/vercel-cli/node_modules/.bin/")).toBe(true);
  });
});
