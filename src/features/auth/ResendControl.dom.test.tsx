// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResendControl } from "./ResendControl";
import type { ResendState } from "./state";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const tick = async (seconds: number) => {
  for (let i = 0; i < seconds; i += 1) {
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
  }
};
const status = () => screen.getByRole("status");
const answer = (state: Partial<ResendState>) =>
  vi.fn(async (previous: ResendState) => ({
    nonce: previous.nonce + 1,
    status: "sent" as const,
    cooldownSeconds: 30,
    ...state,
  }));

describe("ResendControl", () => {
  it("shows the gap as quiet, visual-only text and the button once it is over", async () => {
    render(<ResendControl kind="verify" action={answer({})} initialCooldown={3} />);
    const wait = screen.getByText("You can request another code in 3s");
    expect(wait.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button")).toBeNull();
    await tick(1);
    expect(screen.getByText("You can request another code in 2s")).toBeTruthy();
    await tick(2);
    expect(screen.getByRole("button", { name: "Send a new code" })).toBeTruthy();
    expect(screen.queryByText(/You can request another code in/)).toBeNull();
  });

  it("announces once when the gap ends, and never per tick or on first load", async () => {
    render(<ResendControl kind="verify" action={answer({})} initialCooldown={3} />);
    expect(status().textContent).toBe("");
    const seen: string[] = [];
    const watcher = new MutationObserver(() => seen.push(status().textContent ?? ""));
    watcher.observe(status(), { childList: true, characterData: true, subtree: true });
    await tick(3);
    await act(async () => {});
    watcher.disconnect();
    expect(seen.filter(Boolean)).toEqual(["You can request a new code now."]);
    expect(status().className).toContain("sr-only");
  });

  it("sends, starts the 30-second gap, and announces it once", async () => {
    const action = answer({});
    render(<ResendControl kind="verify" action={action} initialCooldown={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await act(async () => {});
    expect(action).toHaveBeenCalledTimes(1);
    expect(status().textContent).toBe("New code sent. You can request another in 30 seconds.");
    expect(screen.getByText("You can request another code in 30s")).toBeTruthy();
    await tick(30);
    expect(status().textContent).toBe("You can request a new code now.");
    expect(screen.getByRole("button", { name: "Send a new code" })).toBeTruthy();
  });

  it("keeps the button where the text was, so focus order does not jump", async () => {
    const { container } = render(
      <ResendControl kind="verify" action={answer({})} initialCooldown={1} />,
    );
    const form = container.querySelector("form");
    await tick(1);
    expect(container.querySelector("form")).toBe(form);
    expect(form?.querySelector("button")).not.toBeNull();
  });

  it("sends the address along when the page does not already know it", async () => {
    const action = answer({});
    render(<ResendControl kind="reset" action={action} email="a@example.test" />);
    fireEvent.click(screen.getByRole("button", { name: "Send it again" }));
    await act(async () => {});
    const form = action.mock.calls[0] as unknown as [ResendState, FormData];
    expect(form[1].get("email")).toBe("a@example.test");
    expect(status().textContent).toBe(
      "Reset link sent again. You can send it again in 30 seconds.",
    );
  });

  it("restarts the gap the server names when asked too soon", async () => {
    render(
      <ResendControl
        kind="verify"
        action={answer({ status: "cooldown", cooldownSeconds: 12 })}
        initialCooldown={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await act(async () => {});
    expect(screen.getByText("You can request another code in 12s")).toBeTruthy();
    expect(status().textContent).toBe("");
  });

  it.each([
    ["limited", "Too many requests. Try again in a few minutes."],
    ["error", "Something went wrong on our side. Try again in a moment."],
  ] as const)("shows a %s answer as visible text in the live region", async (kind, text) => {
    render(
      <ResendControl
        kind="verify"
        action={answer({ status: kind, cooldownSeconds: 0 })}
        initialCooldown={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Send a new code" }));
    await act(async () => {});
    expect(status().textContent).toBe(text);
    expect(status().className).not.toContain("sr-only");
    expect(screen.getByRole("button", { name: "Send a new code" })).toBeTruthy();
  });

  it("does not send twice while a send is in flight", async () => {
    let finish: (state: ResendState) => void = () => {};
    const action = vi.fn(() => new Promise<ResendState>((resolve) => (finish = resolve)));
    render(<ResendControl kind="verify" action={action} initialCooldown={0} />);
    const button = screen.getByRole("button", { name: "Send a new code" });
    fireEvent.click(button);
    await act(async () => {});
    fireEvent.click(button);
    await act(async () => {});
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => finish({ nonce: 1, status: "sent", cooldownSeconds: 30 }));
  });
});
