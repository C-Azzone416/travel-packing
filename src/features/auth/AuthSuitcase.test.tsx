import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthSuitcase } from "./AuthSuitcase";

describe("AuthSuitcase", () => {
  it("keeps the signed-out content semantic and every suitcase decoration out of the accessibility tree", () => {
    const html = renderToStaticMarkup(
      <AuthSuitcase>
        <section aria-labelledby="screen-title">
          <h1 id="screen-title">Welcome back</h1>
        </section>
      </AuthSuitcase>,
    );

    expect(html).toContain('class="auth-suitcase"');
    expect(html).toContain('class="auth-panel"');
    expect(html).toContain('<h1 id="screen-title">Welcome back</h1>');
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toMatch(/<div class="auth-lid"[^>]*aria-hidden="true">/);
    expect(html).toContain("Every trip starts from your Staples.");
    for (const cube of ["Clothing", "Toiletries", "Tech", "Documents", "Misc"]) {
      expect(html).toContain(`>${cube}</span>`);
    }
  });

  it("uses the Ready to go sticker by default and keeps the packed option available", () => {
    const ready = renderToStaticMarkup(<AuthSuitcase>screen</AuthSuitcase>);
    expect(ready).toContain('data-sticker="ready"');
    expect(ready).toContain("READY TO");
    expect(ready).toContain("GO!");

    const packed = renderToStaticMarkup(
      <AuthSuitcase sticker="packed" lid="lighter">
        screen
      </AuthSuitcase>,
    );
    expect(packed).toContain('data-sticker="packed"');
    expect(packed).toContain('data-lid="lighter"');
    expect(packed).toContain("PACKED!");
  });
});
