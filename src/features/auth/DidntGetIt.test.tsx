// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { DidntGetIt } from "./DidntGetIt";

afterEach(cleanup);

const details = () => document.querySelector("details") as HTMLDetailsElement;

describe("DidntGetIt", () => {
  it("is a closed disclosure that opens on its summary", async () => {
    render(<DidntGetIt />);
    expect(details().open).toBe(false);
    await userEvent.click(screen.getByText("Didn’t get it?"));
    expect(details().open).toBe(true);
  });

  it("says the same three things about waiting, spam and the web address, and never whether a mail was sent", () => {
    render(<DidntGetIt />);
    const lines = [...document.querySelectorAll("li")].map((item) => item.textContent);
    expect(lines).toEqual([
      "It can take a couple of minutes. You can ask for another in a moment.",
      "Check your spam or junk folder.",
      "Open the link from the same web address you normally use for this app. A link opened from a different web address won’t work.",
    ]);
    expect(document.body.textContent).not.toMatch(/we sent|was sent|no account|not allowed/i);
  });

  it("names the Preview's web address when the server gives it", () => {
    render(<DidntGetIt host="travel-packing-preview.vercel.app" />);
    expect(document.body.textContent).toContain(
      "Open the link from the same web address you started on (travel-packing-preview.vercel.app). A link opened from a different web address won’t work.",
    );
  });
});
