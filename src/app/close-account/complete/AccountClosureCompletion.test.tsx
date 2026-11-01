import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./actions", () => ({ consumeAccountClosureSignalAction: vi.fn() }));
vi.mock("./client-cleanup", () => ({
  runConfirmedAccountClosureClientCleanup: vi.fn(),
}));

import { AccountClosureCompletion } from "./AccountClosureCompletion";

describe("AccountClosureCompletion", () => {
  it("renders an accessible, identity-free progress screen with a no-script escape", () => {
    const html = renderToStaticMarkup(<AccountClosureCompletion />);
    expect(html).toContain("Your account is closed");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('href="/sign-in?notice=account-closed"');
    expect(html).not.toContain("@");
  });
});
