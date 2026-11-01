// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toSvg } from "html-to-image";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  EXCLUDE_ATTRIBUTE,
  IDENTITY_REGION_ATTRIBUTE,
  SENSITIVE_PORTAL_ATTRIBUTE,
  captureReadiness,
  includeInCapture,
} from "./capture-exclusion";

// Synthetic canaries: made-up values that must never appear anywhere in a picture's source.
const EMAIL = "canary.person@example.invalid";
const INVITATION = "INVITATION-CANARY-0f3a9c";
const PASSWORD = "PASSWORD-CANARY-77b1d2";
const MODAL_TEXT = "MODAL-CANARY-DELETE-ME";
const ORDINARY = "ordinary-preference-visible";

// jsdom has no SVG image element, which the library looks for when it embeds pictures; there are none in these pages.
beforeAll(() => {
  vi.stubGlobal("SVGImageElement", class {});
});

afterEach(() => {
  document.body.innerHTML = "";
});

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text?: string,
) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

describe("the capture filter", () => {
  it("keeps ordinary elements and everything that is not an element", () => {
    expect(includeInCapture(el("div"))).toBe(true);
    expect(includeInCapture(el("p", {}, "text"))).toBe(true);
    expect(includeInCapture(el("input", { type: "text" }))).toBe(true);
    expect(includeInCapture(document.createTextNode(EMAIL))).toBe(true);
    expect(includeInCapture(document.createComment("c"))).toBe(true);
  });

  it("drops any element carrying the exclusion marker, whatever its value", () => {
    for (const value of ["", "account-identity", "invitation", "anything", "false"]) {
      expect(includeInCapture(el("div", { [EXCLUDE_ATTRIBUTE]: value }))).toBe(false);
    }
  });

  it("drops every password input, marked or not, however its type is written", () => {
    expect(includeInCapture(el("input", { type: "password" }))).toBe(false);
    expect(includeInCapture(el("input", { type: "PASSWORD" }))).toBe(false);
    expect(includeInCapture(el("input", { type: " Password " }))).toBe(false);
    const live = el("input");
    live.type = "password";
    expect(includeInCapture(live)).toBe(false);
    // Not an input: a div that says type=password is just a div.
    expect(includeInCapture(el("div", { type: "password" }))).toBe(true);
  });

  it("drops a sensitive portal if one is ever offered to it", () => {
    expect(includeInCapture(el("form", { [SENSITIVE_PORTAL_ATTRIBUTE]: "" }))).toBe(false);
  });

  it("is imported by nothing but the capture module, which Production replaces with a stub", () => {
    const sources = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sources(path);
        return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)
          ? [path]
          : [];
      });
    const importers = sources(join(process.cwd(), "src"))
      .filter((file) => /capture-exclusion["']/.test(readFileSync(file, "utf8")))
      .map((file) => file.replace(`${process.cwd()}/`, ""));
    expect(importers).toEqual(["src/features/feedback/screenshot-capture.ts"]);
    // And the stub Production gets has none of it.
    const stub = readFileSync(
      join(process.cwd(), "src/features/feedback/screenshot-capture.disabled.ts"),
      "utf8",
    );
    expect(stub).not.toContain("capture-exclusion");
  });
});

describe("whether a screenshot can be proven clean", () => {
  it("is fine on a page with nothing sensitive open", () => {
    document.body.append(el("main", {}, ORDINARY));
    expect(captureReadiness(document)).toEqual({ ok: true });
  });

  it("fails closed while a marked sensitive portal is open", () => {
    const sheet = el("div", { role: "dialog" });
    sheet.append(el("form", { [SENSITIVE_PORTAL_ATTRIBUTE]: "" }));
    document.body.append(el("main"), sheet);
    expect(captureReadiness(document)).toEqual({ ok: false, reason: "sensitive-surface-open" });
  });

  it("is fine again once the portal closes", () => {
    const form = el("form", { [SENSITIVE_PORTAL_ATTRIBUTE]: "" });
    document.body.append(form);
    expect(captureReadiness(document).ok).toBe(false);
    form.remove();
    expect(captureReadiness(document).ok).toBe(true);
  });

  it("passes an identity region whose address is marked, directly or inside it", () => {
    const inside = el("p", { [IDENTITY_REGION_ATTRIBUTE]: "" });
    inside.append(el("strong", { [EXCLUDE_ATTRIBUTE]: "account-identity" }, EMAIL));
    const direct = el("p", {
      [IDENTITY_REGION_ATTRIBUTE]: "",
      [EXCLUDE_ATTRIBUTE]: "account-identity",
    });
    document.body.append(inside, direct);
    expect(captureReadiness(document).ok).toBe(true);
  });

  it("fails closed when an identity is shown but its exclusion cannot be found", () => {
    const region = el("p", { [IDENTITY_REGION_ATTRIBUTE]: "" });
    region.append(el("strong", {}, EMAIL));
    document.body.append(region);
    expect(captureReadiness(document)).toEqual({ ok: false, reason: "unproven-exclusion" });
  });

  it("does not take some other exclusion as proof the identity is out", () => {
    const region = el("p", { [IDENTITY_REGION_ATTRIBUTE]: "" });
    region.append(el("strong", { [EXCLUDE_ATTRIBUTE]: "invitation" }, EMAIL));
    document.body.append(region);
    expect(captureReadiness(document).ok).toBe(false);
  });

  it("fails closed if any one of several identity regions is unproven", () => {
    const good = el("p", { [IDENTITY_REGION_ATTRIBUTE]: "" });
    good.append(el("strong", { [EXCLUDE_ATTRIBUTE]: "account-identity" }, EMAIL));
    const bad = el("p", { [IDENTITY_REGION_ATTRIBUTE]: "" }, EMAIL);
    document.body.append(good, bad);
    expect(captureReadiness(document).ok).toBe(false);
  });
});

/** A Settings-shaped page with every kind of canary in it. */
function settingsPage() {
  const page = el("main");
  const identity = el("p", { [IDENTITY_REGION_ATTRIBUTE]: "" }, "Signed in as ");
  identity.append(el("strong", { [EXCLUDE_ATTRIBUTE]: "account-identity" }, EMAIL));
  const invitation = el("form", { [EXCLUDE_ATTRIBUTE]: "invitation" });
  const field = el("input", { type: "password" });
  field.value = INVITATION;
  invitation.append(el("label", {}, "Invitation"), field);
  // A password field nobody marked: still out.
  const bare = el("input", { type: "password" });
  bare.value = PASSWORD;
  // A text field with an ordinary value must still be in the picture.
  const preference = el("input", { type: "text" });
  preference.value = ORDINARY;
  page.append(identity, invitation, bare, preference, el("p", {}, "Weather for my trips"));
  return page;
}

async function pictureSource(root: HTMLElement, filter?: (node: Node) => boolean) {
  const url = await toSvg(root, {
    width: 400,
    height: 800,
    skipFonts: true,
    ...(filter ? { filter } : {}),
  });
  return decodeURIComponent(url);
}

describe("through the real html-to-image library", () => {
  it("never reads or copies a marked region, an unmarked password, or their values", async () => {
    const page = settingsPage();
    document.body.append(page);
    const source = await pictureSource(page, includeInCapture);
    for (const canary of [EMAIL, INVITATION, PASSWORD]) expect(source).not.toContain(canary);
    expect(source).not.toContain("Invitation");
    // The rest of the page is still there.
    expect(source).toContain("Signed in as");
    expect(source).toContain("Weather for my trips");
    expect(source).toContain(ORDINARY);
  });

  it("the same page WITHOUT the filter does leak every canary (so this test can fail)", async () => {
    const page = settingsPage();
    document.body.append(page);
    const source = await pictureSource(page);
    expect(source).toContain(EMAIL);
    expect(source).toContain(INVITATION);
    expect(source).toContain(PASSWORD);
  });

  it("leaves out a marked region's whole subtree, however deep", async () => {
    const page = el("main");
    const region = el("div", { [EXCLUDE_ATTRIBUTE]: "" });
    const deep = el("div");
    deep.append(el("span", {}, MODAL_TEXT));
    region.append(el("section", {}, ""), deep);
    page.append(region, el("p", {}, ORDINARY));
    document.body.append(page);
    const source = await pictureSource(page, includeInCapture);
    expect(source).not.toContain(MODAL_TEXT);
    expect(source).toContain(ORDINARY);
  });

  it("asks the filter about a node before looking at anything inside it", async () => {
    const page = settingsPage();
    document.body.append(page);
    const asked: string[] = [];
    await pictureSource(page, (node) => {
      if (node.nodeType === 1) asked.push((node as Element).localName);
      return includeInCapture(node);
    });
    // The marked form and its field were put to the filter as elements; nothing below them was ever asked about.
    expect(asked).toContain("form");
    expect(asked.filter((name) => name === "label")).toHaveLength(0);
    expect(asked.filter((name) => name === "input")).toHaveLength(3 - 1);
  });
});
