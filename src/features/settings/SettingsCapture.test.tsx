// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toSvg } from "html-to-image";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { captureReadiness, includeInCapture } from "@/features/feedback/capture-exclusion";
import { SaveStatusProvider } from "@/components/shell/SaveStatus";
import { ToastProvider } from "@/components/ui/Toast";
import { SettingsScreen } from "./SettingsScreen";

// The real Settings page, rendered with synthetic canaries, put through the real html-to-image clone with the capture's own filter
// (#273): what ends up in the picture's source is what could ever be in the picture.
const EMAIL = "settings.canary@example.invalid";
const PASSWORD = "SETTINGS-PASSWORD-CANARY-31c0";
const ORDINARY = "Weather for my trips";

beforeAll(() => {
  vi.stubGlobal("SVGImageElement", class {});
});

function mount(email: string | null = EMAIL) {
  return render(
    <ToastProvider>
      <SaveStatusProvider>
        <SettingsScreen
          email={email}
          signOut={async () => {}}
          initialWeather={{ weatherOptIn: false, temperatureUnit: "F" }}
          updateWeather={async () => ({
            ok: true as const,
            settings: { weatherOptIn: false, temperatureUnit: "F" as const },
          })}
          initialAppearance="base"
          updateAppearance={async (appearance) => ({ ok: true as const, appearance })}
          accountClosureEnabled
          closeAccount={async () => ({ error: null, fieldErrors: {} })}
        />
      </SaveStatusProvider>
    </ToastProvider>,
  );
}

const sourceOf = async (root: HTMLElement) =>
  decodeURIComponent(
    await toSvg(root, { width: 400, height: 800, skipFonts: true, filter: includeInCapture }),
  );

describe("the Settings page as a screenshot sees it", () => {
  it("shows the address on the page, and leaves the whole row out of the clone while the rest stays", async () => {
    const view = mount();
    expect(screen.getByText(EMAIL)).toBeTruthy();
    const source = await sourceOf(view.container);
    expect(source).not.toContain(EMAIL);
    // The label goes with it: nothing is left dangling, and nothing is painted over (design's #273 spec section 3).
    expect(source).not.toContain("Signed in as");
    expect(source).toContain("Account");
    expect(source).toContain("Sign out");
    expect(source).toContain(ORDINARY);
    expect(source).toContain("Appearance");
  });

  it("is provably clean: the identity region carries its exclusion", () => {
    mount();
    expect(captureReadiness(document)).toEqual({ ok: true });
  });

  it("has no identity region (and nothing to exclude) when no address is known", () => {
    mount(null);
    expect(document.querySelector("[data-feedback-identity]")).toBeNull();
    expect(captureReadiness(document).ok).toBe(true);
  });

  it("is not provable if the address's exclusion were ever taken off", () => {
    mount();
    document
      .querySelector("[data-feedback-exclude='account-identity']")
      ?.removeAttribute("data-feedback-exclude");
    expect(captureReadiness(document)).toEqual({ ok: false, reason: "unproven-exclusion" });
  });

  it("allows no picture at all while the Close account sheet is open", async () => {
    mount();
    expect(captureReadiness(document).ok).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    expect(screen.getByRole("dialog", { name: "Close your account?" })).toBeTruthy();
    expect(captureReadiness(document)).toEqual({ ok: false, reason: "sensitive-surface-open" });
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(captureReadiness(document).ok).toBe(true);
  });

  it("would leave the Close account form and its password out of a clone even if one were taken", async () => {
    mount();
    await userEvent.click(screen.getByRole("button", { name: "Close account" }));
    await userEvent.type(screen.getByLabelText("Current password"), PASSWORD);
    const source = await sourceOf(document.body);
    expect(source).not.toContain(PASSWORD);
    expect(source).not.toContain("Current password");
    expect(source).not.toContain("Type DELETE to confirm");
  });
});
