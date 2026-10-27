// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EXCLUDE_ATTRIBUTE,
  IDENTITY_REGION_ATTRIBUTE,
  SENSITIVE_PORTAL_ATTRIBUTE,
} from "./capture-exclusion";
import * as stub from "./screenshot-capture.disabled";

const toBlob = vi.fn();
vi.mock("html-to-image", () => ({ toBlob: (...args: unknown[]) => toBlob(...args) }));

async function loadReal() {
  vi.resetModules();
  return import("./screenshot-capture");
}

const png = (size: number) => new Blob([new Uint8Array(size)], { type: "image/png" });

function at(path: string) {
  window.history.replaceState({}, "", path);
}

afterEach(() => {
  toBlob.mockReset();
  at("/");
  document.body.innerHTML = "";
});

describe("the screenshot capture module and its production stub", () => {
  it("export exactly the same names, so swapping one for the other cannot break an import", async () => {
    const real = await loadReal();
    expect(Object.keys(stub).sort()).toEqual(
      Object.keys(real)
        .filter((name) => name !== "SCREENSHOT_CAPTURE_MARKER")
        .sort(),
    );
  });

  it("the stub can never capture and holds none of the real module's code or marker", async () => {
    expect(stub.screenshotCaptureAvailable).toBe(false);
    expect(await stub.captureScreenshot()).toBeNull();
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const source = readFileSync(
      join(process.cwd(), "src/features/feedback/screenshot-capture.disabled.ts"),
      "utf8",
    );
    expect(source).not.toContain("feedback-screenshot-capture");
    expect(source).not.toContain("html-to-image");
  });

  it("the real module declares itself available and carries the marker the production build check looks for", async () => {
    const real = await loadReal();
    expect(real.screenshotCaptureAvailable).toBe(true);
    expect(real.SCREENSHOT_CAPTURE_MARKER).toBe("feedback-screenshot-capture");
  });
});

describe("captureScreenshot", () => {
  it.each([
    "/sign-in",
    "/verify",
    "/reset-password",
    "/finish-setup",
    "/forgot-password",
    "/sign-up",
  ])("captures nothing on %s, even if called directly", async (path) => {
    at(path);
    const real = await loadReal();
    expect(await real.captureScreenshot()).toBeNull();
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("returns the PNG of the visible screen on an allowed screen, with the capture attribute only while it runs", async () => {
    at("/trips/abc");
    let during: string | null = null;
    toBlob.mockImplementation(async () => {
      during = document.documentElement.getAttribute("data-feedback-screenshot-capture");
      return png(1000);
    });
    const real = await loadReal();
    const blob = await real.captureScreenshot();
    expect(blob?.size).toBe(1000);
    expect(during).toBe("");
    expect(document.documentElement.hasAttribute("data-feedback-screenshot-capture")).toBe(false);
    const [node, options] = toBlob.mock.calls[0];
    expect(node).toBe(document.documentElement);
    expect(options).toMatchObject({
      pixelRatio: 1,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });

  it("hands the library the exclusion filter, so marked regions and every password field are left out before cloning", async () => {
    toBlob.mockResolvedValue(png(10));
    const real = await loadReal();
    await real.captureScreenshot();
    const { filter } = toBlob.mock.calls[0][1] as { filter: (node: Node) => boolean };
    const password = document.createElement("input");
    password.type = "password";
    const marked = document.createElement("div");
    marked.setAttribute(EXCLUDE_ATTRIBUTE, "");
    expect(filter(password)).toBe(false);
    expect(filter(marked)).toBe(false);
    expect(filter(document.createElement("input"))).toBe(true);
    expect(filter(document.createElement("div"))).toBe(true);
  });

  describe("on Settings (#273)", () => {
    function settingsWithIdentity(marked: boolean) {
      const region = document.createElement("p");
      region.setAttribute(IDENTITY_REGION_ATTRIBUTE, "");
      const email = document.createElement("strong");
      if (marked) email.setAttribute(EXCLUDE_ATTRIBUTE, "account-identity");
      email.textContent = "canary@example.invalid";
      region.append(email);
      document.body.append(region);
    }

    it("takes the picture, with the sensitive parts left out, when they are all marked", async () => {
      at("/settings");
      settingsWithIdentity(true);
      toBlob.mockResolvedValue(png(500));
      const real = await loadReal();
      expect((await real.captureScreenshot())?.size).toBe(500);
      expect(toBlob).toHaveBeenCalledTimes(1);
    });

    it("takes no picture at all, and never starts the library, while a sensitive dialog is open", async () => {
      at("/settings");
      settingsWithIdentity(true);
      const portal = document.createElement("form");
      portal.setAttribute(SENSITIVE_PORTAL_ATTRIBUTE, "");
      document.body.append(portal);
      toBlob.mockResolvedValue(png(500));
      const real = await loadReal();
      expect(await real.captureScreenshot()).toBeNull();
      expect(toBlob).not.toHaveBeenCalled();
    });

    it("takes no picture when the identity is shown but its exclusion cannot be found", async () => {
      at("/settings");
      settingsWithIdentity(false);
      toBlob.mockResolvedValue(png(500));
      const real = await loadReal();
      expect(await real.captureScreenshot()).toBeNull();
      expect(toBlob).not.toHaveBeenCalled();
    });

    it("throws the picture away if a sensitive dialog opens while it is being made", async () => {
      at("/settings");
      settingsWithIdentity(true);
      toBlob.mockImplementation(async () => {
        const portal = document.createElement("form");
        portal.setAttribute(SENSITIVE_PORTAL_ATTRIBUTE, "");
        document.body.append(portal);
        return png(500);
      });
      const real = await loadReal();
      expect(await real.captureScreenshot()).toBeNull();
      expect(document.documentElement.hasAttribute("data-feedback-screenshot-capture")).toBe(false);
    });

    it("the same page without the dialog is captured, so the refusal above is the dialog's doing", async () => {
      at("/trips/abc");
      toBlob.mockResolvedValue(png(500));
      const real = await loadReal();
      expect((await real.captureScreenshot())?.size).toBe(500);
    });
  });

  it("scales down until the picture fits in 8 MiB, then gives up", async () => {
    const big = 8 * 1024 * 1024 + 1;
    toBlob.mockResolvedValueOnce(png(big)).mockResolvedValueOnce(png(500));
    const real = await loadReal();
    expect((await real.captureScreenshot())?.size).toBe(500);
    expect(toBlob.mock.calls.map((call) => (call[1] as { pixelRatio: number }).pixelRatio)).toEqual(
      [1, 0.5],
    );
    toBlob.mockReset();
    toBlob.mockResolvedValue(png(big));
    expect(await real.captureScreenshot()).toBeNull();
    expect(toBlob).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["no blob", null],
    ["an empty blob", new Blob([], { type: "image/png" })],
  ])("returns null when the library produces %s", async (_name, result) => {
    toBlob.mockResolvedValue(result);
    const real = await loadReal();
    expect(await real.captureScreenshot()).toBeNull();
  });

  it("returns null for a blob that is not a PNG", async () => {
    toBlob.mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/jpeg" }));
    const real = await loadReal();
    expect(await real.captureScreenshot()).toBeNull();
  });

  it("never throws: a failing library becomes null and the attribute is still removed", async () => {
    toBlob.mockRejectedValue(new Error("tainted canvas"));
    const real = await loadReal();
    expect(await real.captureScreenshot()).toBeNull();
    expect(document.documentElement.hasAttribute("data-feedback-screenshot-capture")).toBe(false);
  });
});
