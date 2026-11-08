import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
const phoneStart = css.indexOf("/* Suitcase sheets are attached");
// One sheet treatment through 1023px (#376 part 2 section 8): phone full width, tablet capped at 640px and centred.
const phone = css.slice(phoneStart, css.indexOf("/* ---- Trips dashboard", phoneStart));

describe("ModalSheet suitcase layout (#421)", () => {
  it("uses the specified scrim token and opacity", () => {
    expect(css).toMatch(
      /\.modal-backdrop\s*{[^}]*background: color-mix\(in srgb, var\(--darkEdge\) 55%, transparent\)/s,
    );
  });

  it("is a full-width, bottom-anchored page sheet on phones", () => {
    expect(phone).toContain("@media (max-width: 1023px)");
    expect(phone).toContain("padding: 0;");
    expect(phone).toContain("--modal-surface: var(--page);");
    expect(phone).toContain("width: min(100%, 640px);");
    expect(phone).toContain("max-height: 90dvh;");
    expect(phone).toContain("--modal-pad-bottom: max(var(--modal-pad), var(--safe-bottom));");
    expect(phone).toContain("padding: 0 var(--modal-pad) var(--modal-pad-bottom);");
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

  it("has the specified decorative grabber", () => {
    expect(phone).toMatch(
      /\.modal-grabber\s*{[^}]*width: 44px;[^}]*height: 6px;[^}]*margin: 12px auto 24px;[^}]*border-radius: 3px;[^}]*background: var\(--line\)/s,
    );
  });

  it("keeps the 640px cap for Feedback below 1024px; its 760px layout is desktop only (#376 part 2 section 8)", () => {
    const rules = [...css.matchAll(/\.modal:has\(\.feedback-form\)\s*{([^}]*)}/g)];
    const wide = rules.filter(([, body]) => /width: min\(100%, 760px\)/.test(body));
    expect(wide).toHaveLength(1);
    const at = wide[0].index!;
    expect(css.slice(css.lastIndexOf("@media", at), at)).toContain("(min-width: 1024px)");
    const base = rules.find(([, body]) => body.includes("display: flex"))!;
    expect(base[1]).toContain("width: min(100%, 640px);");
  });

  it("pinned footers keep the safe-area inset instead of subtracting the bare padding", () => {
    expect(css).toMatch(/\.modal\s*{[^}]*--modal-foot-bottom: 12px/s);
    expect(phone).toContain("--modal-foot-bottom: max(var(--modal-pad), var(--safe-bottom));");
    const pinned = [
      ...css.matchAll(
        /(\.staple-editor-actions|\.modal:has\(\.save-list-form\) \.modal-actions|\.modal:has\(\.feedback-form\) \.modal-actions)\s*{([^}]*)}/g,
      ),
    ];
    expect(pinned).toHaveLength(3);
    for (const [, selector, body] of pinned) {
      expect(body, selector).toContain("calc(var(--modal-pad-bottom) * -1)");
      expect(body, selector).not.toMatch(/\* -1\) calc\(var\(--modal-pad\) \* -1\)/);
      expect(body, selector).toContain("var(--modal-foot-bottom)");
    }
  });
});
