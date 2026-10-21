import { describe, expect, it } from "vitest";
import * as real from "./screenshot-capture";
import * as stub from "./screenshot-capture.disabled";

describe("the screenshot capture module and its production stub", () => {
  it("export exactly the same names, so swapping one for the other cannot break an import", () => {
    expect(Object.keys(stub).sort()).toEqual(
      Object.keys(real)
        .filter((name) => name !== "SCREENSHOT_CAPTURE_MARKER")
        .sort(),
    );
  });

  it("the stub can never capture", async () => {
    expect(stub.screenshotCaptureAvailable).toBe(false);
    expect(await stub.captureScreenshot()).toBeNull();
  });

  it("the real module declares itself available and carries the marker the production build check looks for", () => {
    expect(real.screenshotCaptureAvailable).toBe(true);
    expect(real.SCREENSHOT_CAPTURE_MARKER).toBe("feedback-screenshot-capture");
  });

  it("the stub holds none of the real module's code or marker", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync(
      new URL("./screenshot-capture.disabled.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("feedback-screenshot-capture");
  });

  it("the real capture is not implemented yet (#132), and says so", async () => {
    await expect(real.captureScreenshot()).rejects.toThrow(/feedback-screenshot-capture: .*#132/);
  });
});
