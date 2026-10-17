import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AccessDeniedPage from "./page";

describe("AccessDeniedPage", () => {
  const html = renderToStaticMarkup(<AccessDeniedPage />);

  it("says the app is private, generically", () => {
    expect(html).toContain("This app is private");
    expect(html).toContain("doesn’t have access");
    expect(html).not.toContain("@");
  });

  it("offers one way forward: back to sign in", () => {
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain("Back to sign in");
  });
});
