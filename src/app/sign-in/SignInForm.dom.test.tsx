// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signInAction = vi.fn();
vi.mock("./actions", () => ({ signInAction: (...args: unknown[]) => signInAction(...args) }));

import { SignInForm } from "./SignInForm";

beforeEach(() => signInAction.mockReset());

describe("SignInForm", () => {
  it("shows and hides the password", async () => {
    const user = userEvent.setup();
    render(<SignInForm />);
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("type")).toBe("password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.getAttribute("type")).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.getAttribute("type")).toBe("password");
  });

  it("submits the credentials to the server action and shows its error inline", async () => {
    signInAction.mockResolvedValue({ error: "Email or password is incorrect." });
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.type(screen.getByLabelText("Password"), "not-a-real-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Email or password is incorrect.",
    );
    expect(signInAction).toHaveBeenCalledTimes(1);
    const form = signInAction.mock.calls[0][1] as FormData;
    expect(form.get("email")).toBe("owner@example.test");
    expect(form.get("password")).toBe("not-a-real-password");
    expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("disables the form and shows progress while signing in", async () => {
    let finish: (state: { error: null }) => void = () => {};
    signInAction.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = userEvent.setup();
    render(<SignInForm />);
    await user.type(screen.getByLabelText("Email"), "owner@example.test");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    const busy = await screen.findByRole("button", { name: /Signing in/ });
    expect((busy as HTMLButtonElement).disabled).toBe(true);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByLabelText("Email") as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText("Password") as HTMLInputElement).disabled).toBe(true);

    finish({ error: null });
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Sign in" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });
});
