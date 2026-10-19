import { describe, expect, it } from "vitest";
import { deployTargetProblems } from "./deploy-target";

// What the pinned CLI printed in the first real runs (colours as the CLI writes them).
const ESC = String.fromCharCode(27);
const cyan = (text: string) => `${ESC}[36m${text}${ESC}[39m`;
const PRODUCTION = [
  "Vercel CLI 64.5.0 (Node.js 22.23.3)",
  "Retrieving project…",
  "Deploying team/travel-packing",
  `  Inspect         ${cyan("https://vercel.com/team/travel-packing/abc")}`,
  `  Production      ${cyan("https://travel-packing-aaa-team.vercel.app")}`,
  "Building…",
  "Completing…",
].join("\n");
const PREVIEW = PRODUCTION.replace("  Production    ", "  Preview       ");

describe("deployTargetProblems: a preview run", () => {
  it("accepts a deployment the CLI labels Preview", () => {
    expect(deployTargetProblems("preview", PREVIEW)).toEqual([]);
  });

  it("refuses a deployment the CLI labels Production (the first-deployment-is-production case)", () => {
    expect(deployTargetProblems("preview", PRODUCTION)).toEqual([
      "a preview run created a PRODUCTION deployment; stop and check the Vercel project",
    ]);
  });

  it("refuses on the CLI's own first-deployment notice even without the label", () => {
    const text = `${PREVIEW}\nThis is your project's first deployment, so it was assigned to production.`;
    expect(deployTargetProblems("preview", text)).toHaveLength(1);
  });

  it("recognises the labels with and without colours and the CLI's triangle gutter", () => {
    expect(deployTargetProblems("preview", "\u25b2 Production https://x.vercel.app")).toHaveLength(
      1,
    );
    expect(
      deployTargetProblems("preview", `${ESC}[1m  Production  https://x.vercel.app`),
    ).toHaveLength(1);
    expect(deployTargetProblems("preview", "Preview: https://x.vercel.app")).toHaveLength(1);
  });

  it.each([[""], ["Vercel CLI 64.5.0\nDeploying…"], ["the word Production in prose, no URL"]])(
    "refuses output that does not say what was created (%j): the target is unknown",
    (output) => {
      expect(deployTargetProblems("preview", output)).toEqual([
        "the deploy output does not say the deployment is a Preview, so its target is unknown",
      ]);
    },
  );
});

describe("deployTargetProblems: a production run", () => {
  it("accepts a deployment the CLI labels Production", () => {
    expect(deployTargetProblems("production", PRODUCTION)).toEqual([]);
  });

  it("refuses a deployment the CLI labels Preview", () => {
    expect(deployTargetProblems("production", PREVIEW)).toEqual([
      "a production run created a PREVIEW deployment, not a production one",
    ]);
  });

  it("refuses output that does not say what was created", () => {
    expect(deployTargetProblems("production", "")).toEqual([
      "the deploy output does not say the deployment is Production, so its target is unknown",
    ]);
  });
});
