import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const phoneStart = css.indexOf("/* Suitcase sheets are attached");
const tabletStart = css.indexOf("@media (min-width: 601px) and (max-width: 1023px)", phoneStart);
const phone = css.slice(phoneStart, tabletStart);
const tablet = css.slice(tabletStart, css.indexOf("/* ---- Trips dashboard", tabletStart));

describe("ModalSheet suitcase layout (#421)", () => {
  it("uses the specified scrim token and opacity", () => {
    expect(css).toMatch(
      /\.modal-backdrop\s*{[^}]*background: color-mix\(in srgb, var\(--darkEdge\) 55%, transparent\)/s,
    );
  });

  it("is a full-width, bottom-anchored page sheet on phones", () => {
    expect(phone).toContain("@media (max-width: 600px)");
    expect(phone).toContain("padding: 0;");
    expect(phone).toContain("--modal-surface: var(--page);");
    expect(phone).toContain("width: 100%;");
    expect(phone).toContain("max-height: 90dvh;");
    expect(phone).toContain(
      "padding: 0 var(--modal-pad) max(var(--modal-pad), var(--safe-bottom));",
    );
    expect(phone).toContain("border-radius: 22px 22px 0 0;");
  });

  it("keeps a flush-bottom phone sheet inside the viewport throughout its entrance", () => {
    expect(phone).toContain("animation-name: modalSheetIn;");
    const animation = css.slice(
      css.indexOf("@keyframes modalSheetIn"),
      css.indexOf(".modal-head", css.indexOf("@keyframes modalSheetIn")),
    );
    expect(animation).toContain("opacity: 0.4;");
    expect(animation).not.toContain("transform:");
  });

  it("has the specified decorative grabber and tablet cap", () => {
    expect(phone).toMatch(
      /\.modal-grabber\s*{[^}]*width: 44px;[^}]*height: 6px;[^}]*margin: 12px auto 24px;[^}]*border-radius: 3px;[^}]*background: var\(--line\)/s,
    );
    expect(tablet).toContain("width: min(100%, 640px);");
  });
});
