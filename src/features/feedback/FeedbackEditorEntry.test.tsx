// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackEditorEntry } from "./FeedbackEditorEntry";
import { FeedbackEditorEntry as ProductionStub } from "./feedback.disabled";

let pathname = "/trips/t1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const openReport = vi.fn();
const captureScreenshot = vi.fn();
let access: { available: boolean; status: { canCapture: boolean } | null } = {
  available: true,
  status: { canCapture: true },
};
vi.mock("./FeedbackAccess", () => ({
  useFeedbackAccess: () => ({ ...access, openReport }),
}));
vi.mock("./screenshot-capture", () => ({
  captureScreenshot: (...args: unknown[]) => captureScreenshot(...args),
  screenshotCaptureAvailable: true,
}));

beforeEach(() => {
  pathname = "/trips/t1";
  access = { available: true, status: { canCapture: true } };
  openReport.mockReset();
  captureScreenshot.mockReset();
});

const entry = () => screen.queryByRole("button", { name: "Send feedback" }) as HTMLButtonElement;

describe("FeedbackEditorEntry", () => {
  it("renders a Feedback button named Send feedback, and captures nothing on render, hover or focus", async () => {
    render(<FeedbackEditorEntry />);
    expect(entry().textContent).toBe("Feedback");
    expect(entry().disabled).toBe(false);
    await userEvent.hover(entry());
    entry().focus();
    expect(openReport).not.toHaveBeenCalled();
    expect(captureScreenshot).not.toHaveBeenCalled();
  });

  it("renders nothing when feedback is not available in this build", () => {
    access = { available: false, status: null };
    render(<FeedbackEditorEntry />);
    expect(entry()).toBeNull();
  });

  it.each([
    "/sign-in",
    "/sign-up",
    "/verify",
    "/forgot-password",
    "/reset-password",
    "/finish-setup",
    "/access-denied",
    "/close-account",
  ])("renders nothing on the blocked screen %s", (path) => {
    pathname = path;
    render(<FeedbackEditorEntry />);
    expect(entry()).toBeNull();
  });

  it("is disabled until the person can send (not connected, or status still loading)", () => {
    access = { available: true, status: { canCapture: false } };
    const { unmount } = render(<FeedbackEditorEntry />);
    expect(entry().disabled).toBe(true);
    unmount();
    access = { available: true, status: null };
    render(<FeedbackEditorEntry />);
    expect(entry().disabled).toBe(true);
  });

  it("is disabled while the editor is busy", () => {
    render(<FeedbackEditorEntry busy />);
    expect(entry().disabled).toBe(true);
  });

  it("opens the report through the provider exactly once per press", async () => {
    render(<FeedbackEditorEntry />);
    await userEvent.click(entry());
    expect(openReport).toHaveBeenCalledTimes(1);
  });

  it("is nothing at all in the production stub", () => {
    expect(ProductionStub()).toBeNull();
  });
});
