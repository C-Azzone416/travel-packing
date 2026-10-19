// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotForm } from "./ForgotForm";
import { InvalidLinkView } from "./InvalidLinkView";
import { ResetForm } from "./ResetForm";
import { SignUpForm } from "./SignUpForm";
import { VerifyForm, onlyDigits } from "./VerifyForm";
import { INITIAL_FORGOT, INITIAL_FORM, type ForgotState, type FormState } from "./state";

afterEach(cleanup);

const form = (changes: Partial<FormState> = {}): FormState => ({ ...INITIAL_FORM, ...changes });
const resend = vi.fn(async () => ({ nonce: 1, status: "sent" as const, cooldownSeconds: 30 }));

describe("SignUpForm", () => {
  const render_ = (action = vi.fn(async () => form())) => {
    render(<SignUpForm action={action} />);
    return action;
  };

  it("is a titled card with labelled email and new-password fields, the rule, and a way back", () => {
    render_();
    expect(screen.getByRole("heading", { level: 1, name: "Create your account" })).toBeTruthy();
    expect(screen.getByText(/6-digit code to confirm your address/)).toBeTruthy();
    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.type).toBe("email");
    expect(email.autocomplete).toBe("email");
    expect(email.getAttribute("autocapitalize")).toBe("none");
    expect(email.getAttribute("spellcheck")).toBe("false");
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    expect(password.autocomplete).toBe("new-password");
    expect(password.getAttribute("aria-describedby")).toBe("password-hint");
    expect(document.getElementById("password-hint")?.textContent).toBe("At least 8 characters.");
    expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/sign-in");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("submits the fields and shows field problems under their fields, linked and marked invalid", async () => {
    const action = render_(
      vi.fn(async () =>
        form({
          email: "typed@example.test",
          fieldErrors: {
            email: "Enter a valid email address.",
            password: "Password must be at least 8 characters.",
          },
        }),
      ),
    );
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("Email"), "typed@example.test");
    await user.type(screen.getByLabelText("Password"), "x");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    const sent = action.mock.calls[0] as unknown as [FormState, FormData];
    expect(sent[1].get("email")).toBe("typed@example.test");
    expect(sent[1].get("password")).toBe("x");

    const email = screen.getByLabelText("Email") as HTMLInputElement;
    expect(email.getAttribute("aria-invalid")).toBe("true");
    expect(email.getAttribute("aria-describedby")).toContain("email-error");
    expect(document.getElementById("email-error")?.textContent).toContain(
      "Enter a valid email address.",
    );
    expect(email.value).toBe("typed@example.test");
    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("aria-describedby")).toContain("password-error");
    // Focus goes to the first invalid field, and no form-level alert is added for a field problem.
    expect(document.activeElement).toBe(email);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a form-level problem once, as an alert above the button", async () => {
    render_(vi.fn(async () => form({ error: "Too many requests. Try again in a few minutes." })));
    await userEvent.setup().click(screen.getByRole("button", { name: "Create account" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Too many requests. Try again in a few minutes.");
    expect(
      alert.compareDocumentPosition(screen.getByRole("button", { name: "Create account" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("never disables the button, and says 'Working…' only after a noticeable wait", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let finish: (state: FormState) => void = () => {};
      render_(vi.fn(() => new Promise<FormState>((resolve) => (finish = resolve))));
      fireEvent.click(screen.getByRole("button", { name: "Create account" }));
      await act(async () => {});
      const button = screen.getByRole("button", { name: "Create account" }) as HTMLButtonElement;
      expect(button.disabled).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(399);
      });
      expect(screen.queryByText("Working…")).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(2);
      });
      const busy = screen.getByRole("button", { name: /Working…/ }) as HTMLButtonElement;
      expect(busy.disabled).toBe(false);
      expect(busy.getAttribute("aria-busy")).toBe("true");
      expect(document.querySelector("form")?.getAttribute("aria-busy")).toBe("true");
      await act(async () => finish(form()));
      expect(screen.getByRole("button", { name: "Create account" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("VerifyForm", () => {
  const props = (changes: Partial<Parameters<typeof VerifyForm>[0]> = {}) => ({
    email: "owner@example.test" as string | null,
    initialCooldown: 0,
    verifyAction: vi.fn(async () => form()),
    resendAction: resend,
    ...changes,
  });

  it("says where the code went without saying whether the address works", () => {
    render(<VerifyForm {...props()} />);
    expect(screen.getByRole("heading", { level: 1, name: "Check your email" })).toBeTruthy();
    expect(
      screen.getByText(
        "If owner@example.test can be used to sign up, we've sent it a 6-digit code. It expires in 10 minutes.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: "Use a different email" }).getAttribute("href")).toBe(
      "/sign-up",
    );
  });

  it("has ONE code input that suits autofill, paste and a phone keypad", () => {
    render(<VerifyForm {...props()} />);
    const code = screen.getByLabelText("6-digit code") as HTMLInputElement;
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(code.autocomplete).toBe("one-time-code");
    expect(code.inputMode).toBe("numeric");
    expect(code.maxLength).toBe(6);
    expect(code.pattern).toBe("[0-9]*");
    expect(code.className).toContain("code-input");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("strips anything but digits from what is typed or pasted", async () => {
    expect(onlyDigits("12 34-56")).toBe("123456");
    expect(onlyDigits("123456789")).toBe("123456");
    expect(onlyDigits("abc")).toBe("");
    render(<VerifyForm {...props()} />);
    const code = screen.getByLabelText("6-digit code") as HTMLInputElement;
    fireEvent.change(code, { target: { value: "12 3-4x56" } });
    expect(code.value).toBe("123456");
  });

  it("cleans a pasted code before the length limit can cut a digit off it", () => {
    render(<VerifyForm {...props()} />);
    const code = screen.getByLabelText("6-digit code") as HTMLInputElement;
    for (const pasted of ["123 456", "123-456", " 1 2 3 4 5 6 ", "code: 123456"]) {
      fireEvent.paste(code, { clipboardData: { getData: () => pasted } });
      expect(code.value).toBe("123456");
      code.value = "";
    }
  });

  it("does not submit on its own: the person taps Verify", async () => {
    const verifyAction = vi.fn(async () => form());
    render(<VerifyForm {...props({ verifyAction })} />);
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await act(async () => {});
    expect(verifyAction).not.toHaveBeenCalled();
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify" }));
    const sent = verifyAction.mock.calls[0] as unknown as [FormState, FormData];
    expect(sent[1].get("code")).toBe("123456");
    expect(sent[1].get("email")).toBeNull();
  });

  it("puts a wrong-code problem under the input and keeps focus there with the text selected", async () => {
    const verifyAction = vi.fn(async () =>
      form({
        code: "111111",
        fieldErrors: {
          code: "That code isn't right or has expired. Check it, or send a new code.",
        },
      }),
    );
    render(<VerifyForm {...props({ verifyAction })} />);
    const code = screen.getByLabelText("6-digit code") as HTMLInputElement;
    fireEvent.change(code, { target: { value: "111111" } });
    const select = vi.spyOn(code, "select");
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify" }));
    expect(code.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("code-error")?.textContent).toContain(
      "isn't right or has expired",
    );
    expect(document.activeElement).toBe(code);
    expect(select).toHaveBeenCalled();
    // The refused code is still there (React clears an uncontrolled form after an action).
    expect(code.value).toBe("111111");
  });

  it("asks for the address too when the page does not know it, and sends it", async () => {
    const verifyAction = vi.fn(async () => form());
    render(<VerifyForm {...props({ email: null, verifyAction })} />);
    expect(screen.getByRole("heading", { level: 1, name: "Confirm your email" })).toBeTruthy();
    await userEvent.setup().type(screen.getByLabelText("Email"), "owner@example.test");
    fireEvent.change(screen.getByLabelText("6-digit code"), { target: { value: "123456" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Verify" }));
    const sent = verifyAction.mock.calls[0] as unknown as [FormState, FormData];
    expect(sent[1].get("email")).toBe("owner@example.test");
  });

  it("starts with the resend gap already running when a code was just sent", () => {
    render(<VerifyForm {...props({ initialCooldown: 25 })} />);
    expect(screen.getByText("You can request another code in 25s")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Send a new code" })).toBeNull();
  });
});

describe("ForgotForm", () => {
  const forgot = (changes: Partial<ForgotState> = {}): ForgotState => ({
    ...INITIAL_FORGOT,
    ...changes,
  });

  it("asks for an email and nothing else", () => {
    render(<ForgotForm action={vi.fn(async () => forgot())} resendAction={resend} />);
    expect(screen.getByRole("heading", { level: 1, name: "Reset your password" })).toBeTruthy();
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Send reset link" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe(
      "/sign-in",
    );
  });

  it("replaces the form with 'Check your email' and moves focus to the new heading", async () => {
    const action = vi.fn(async () =>
      forgot({ sent: { email: "any@example.test", cooldownSeconds: 30 } }),
    );
    render(<ForgotForm action={action} resendAction={resend} />);
    await userEvent.setup().type(screen.getByLabelText("Email"), "any@example.test");
    await userEvent.setup().click(screen.getByRole("button", { name: "Send reset link" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Check your email" });
    expect(
      screen.getByText(
        "If there's an account for any@example.test, we've sent a link to reset your password. It expires in 1 hour.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText("You can send it again in 30s")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" })).toBeTruthy();
  });

  it("shows only a bad address or a cap as problems", async () => {
    render(
      <ForgotForm
        action={vi.fn(async () =>
          forgot({ fieldErrors: { email: "Enter a valid email address." } }),
        )}
        resendAction={resend}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Send reset link" }));
    expect((await screen.findByLabelText("Email")).getAttribute("aria-invalid")).toBe("true");
  });
});

describe("ResetForm", () => {
  it("has one new-password field with its rule, the Show toggle, and the token as a hidden field", async () => {
    const action = vi.fn(async () => form());
    render(<ResetForm token="fake-token-one" action={action} />);
    expect(screen.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeTruthy();
    const password = screen.getByLabelText("New password") as HTMLInputElement;
    expect(password.autocomplete).toBe("new-password");
    expect(screen.queryByLabelText(/confirm/i)).toBeNull();
    expect(document.getElementById("password-hint")?.textContent).toBe("At least 8 characters.");
    const toggle = screen.getByRole("button", { name: "Show password" });
    await userEvent.setup().click(toggle);
    expect(password.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    await userEvent.setup().type(password, "a-new-password");
    await userEvent.setup().click(screen.getByRole("button", { name: "Update password" }));
    const sent = action.mock.calls[0] as unknown as [FormState, FormData];
    expect(sent[1].get("token")).toBe("fake-token-one");
    expect(sent[1].get("password")).toBe("a-new-password");
  });

  it("shows a password problem under the field", async () => {
    render(
      <ResetForm
        token="fake-token-one"
        action={vi.fn(async () =>
          form({ fieldErrors: { password: "Password must be at least 8 characters." } }),
        )}
      />,
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Update password" }));
    const field = await screen.findByLabelText("New password");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(within(document.body).getByText(/at least 8 characters\./)).toBeTruthy();
  });
});

describe("InvalidLinkView", () => {
  it("has no form: only a way to get a new link and a way back", () => {
    render(<InvalidLinkView />);
    expect(screen.getByRole("heading", { level: 1, name: "This link isn’t valid" })).toBeTruthy();
    expect(
      screen.getByText("It may have expired or already been used. Request a new one."),
    ).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.querySelector("form")).toBeNull();
    expect(screen.getByRole("link", { name: "Send a new reset link" }).getAttribute("href")).toBe(
      "/forgot-password",
    );
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe(
      "/sign-in",
    );
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });
});
