// @vitest-environment jsdom
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { automaticStamps, type StampLabels } from "@/domain/stamps";
import type { TripStop } from "@/domain/trip-stops";
import { EditStampSheet } from "./EditStampSheet";

const stop = (
  city: string,
  country: string,
  countryCode: string,
  airportCode?: string,
): TripStop => ({
  location: { id: city, city, region: "", country, countryCode, label: city },
  arrive: "2030-05-01",
  leave: "2030-05-04",
  ...(airportCode ? { airportCode } : {}),
});
const TWO = [stop("Lisbon", "Portugal", "PT"), stop("Madrid", "Spain", "ES")];
const ONE_AIRPORT = [stop("Lisbon", "Portugal", "PT", "LIS")];
const ONE_PLACE = [stop("Zermatt", "Switzerland", "CH")];
const NO_COUNTRY = [stop("Nowhere", "", "")];

function setup(
  props: {
    stops?: TripStop[];
    saved?: StampLabels;
    saving?: boolean;
    failed?: boolean;
  } = {},
) {
  const stops = props.stops ?? TWO;
  const onSave = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = renderInApp(
    <EditStampSheet
      automatic={automaticStamps(stops)}
      stops={stops}
      saved={props.saved}
      departure="2030-05-01"
      saving={props.saving ?? false}
      failed={props.failed}
      onClose={onClose}
      onSave={onSave}
    />,
  );
  return { user, onSave, onClose, ...view };
}
const block = (n: number, mode: string) =>
  screen.getByRole("group", { name: `Stamp ${n}, ${mode}` });
const tag = (n: number, mode: string) => block(n, mode).querySelector(".stamp-tag")?.textContent;
// The app shell has its own (empty) alert regions; the sheet's own message is the one with this class.
const fieldError = () =>
  screen.queryAllByRole("alert").find((entry) => entry.classList.contains("field-error")) ?? null;
const save = () => screen.getByRole("button", { name: "Save" });

describe("EditStampSheet", () => {
  it("is a dialog named Stamp label with one block per stamp the route has, each starting Automatic", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
    expect(
      screen.getByText(
        "Choose what each stamp says on this trip. Automatic labels come from your route.",
      ),
    ).toBeTruthy();
    expect(block(1, "automatic")).toBeTruthy();
    expect(block(2, "automatic")).toBeTruthy();
    expect(tag(1, "automatic")).toBe("Automatic");
    expect(
      within(block(1, "automatic")).getByText("PRT, the country code for Portugal"),
    ).toBeTruthy();
    expect(within(block(2, "automatic")).getByText("ESP, the country code for Spain")).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Stamp 1 label mode" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Stamp 2 label mode" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset to automatic" })).toBeNull();
  });

  it("shows one block for a one-stamp route and says where an airport or place label comes from", () => {
    const airport = setup({ stops: ONE_AIRPORT });
    expect(screen.queryByRole("group", { name: /Stamp 2/ })).toBeNull();
    expect(screen.getByText("LIS, the largest airport near Lisbon")).toBeTruthy();
    airport.unmount();
    setup({ stops: ONE_PLACE });
    expect(screen.getByText("CHE, the country code for Switzerland")).toBeTruthy();
  });

  it("a route with no country has no automatic label and still offers one Custom stamp", async () => {
    const { user, onSave } = setup({ stops: NO_COUNTRY });
    expect(screen.getByText("No automatic label (this route has no country).")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /Stamp 2/ })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("");
    await user.type(screen.getByLabelText("Label"), "abc");
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith("ABC", null);
  });

  it("Save is off until something changes", async () => {
    const { user } = setup();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await user.click(within(block(1, "automatic")).getByRole("radio", { name: "Custom" }));
    // Custom starts from the label it shows now, which is what Automatic already says.
    expect((screen.getByLabelText("Label") as HTMLInputElement).value).toBe("PRT");
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await user.clear(screen.getByLabelText("Label"));
    await user.type(screen.getByLabelText("Label"), "xyz");
    expect((save() as HTMLButtonElement).disabled).toBe(false);
  });

  it("switching to Custom prefills the label, uppercases and strips spaces as you type, and shows it live", async () => {
    const { user, onSave } = setup();
    await user.click(within(block(1, "automatic")).getByRole("radio", { name: "Custom" }));
    expect(tag(1, "custom")).toBe("Custom");
    const field = screen.getByLabelText("Label") as HTMLInputElement;
    expect(field.maxLength).toBe(3);
    expect(field.getAttribute("autocapitalize")).toBe("characters");
    expect(field.getAttribute("autocomplete")).toBe("off");
    expect(field.getAttribute("spellcheck")).toBe("false");
    await user.clear(field);
    await user.type(field, "a b");
    expect(field.value).toBe("AB");
    await user.type(field, "7");
    expect(field.value).toBe("AB7");
    // The preview shows the custom text, not the automatic one (it is decorative: the block names it).
    expect(document.querySelector(".stamp-preview")?.textContent).toContain("AB7");
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith("AB7", null);
  });

  it("shows the error on blur for a short label, and Save refuses until it is fixed", async () => {
    const { user, onSave } = setup();
    await user.click(within(block(2, "automatic")).getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "ab");
    await user.tab();
    const alert = fieldError()!;
    expect(alert.textContent).toBe("Use exactly 3 letters or numbers (A–Z, 0–9).");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toContain(alert.id);
    // A label that is not valid cannot be saved; the message says why, and fixing it turns Save back on.
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await user.click(save());
    expect(onSave).not.toHaveBeenCalled();
    await user.type(field, "c");
    expect(fieldError()).toBeNull();
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(null, "ABC");
  });

  it("refuses non-ASCII text on Save (the field is never transliterated)", async () => {
    const { user, onSave } = setup();
    await user.click(within(block(1, "automatic")).getByRole("radio", { name: "Custom" }));
    const field = screen.getByLabelText("Label");
    await user.clear(field);
    await user.type(field, "ÀBC");
    await user.tab();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    await user.click(save());
    expect(onSave).not.toHaveBeenCalled();
    expect(fieldError()?.textContent).toContain("Use exactly 3");
  });

  it("a blank custom label is refused rather than saved as nothing", async () => {
    const { user, onSave } = setup({ saved: ["ABC", null] });
    await user.clear(screen.getByLabelText("Label"));
    await user.tab();
    expect((save() as HTMLButtonElement).disabled).toBe(true);
    expect(fieldError()).toBeTruthy();
    await user.click(save());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("a saved override opens in Custom with its text, and Reset to automatic selects Automatic and saves null", async () => {
    const { user, onSave } = setup({ saved: ["ABC", "XYZ"] });
    expect(block(1, "custom")).toBeTruthy();
    expect((screen.getAllByLabelText("Label")[0] as HTMLInputElement).value).toBe("ABC");
    const resets = screen.getAllByRole("button", { name: "Reset to automatic" });
    expect(resets).toHaveLength(2);
    await user.click(resets[0]);
    expect(block(1, "automatic")).toBeTruthy();
    expect(screen.getByText("PRT, the country code for Portugal")).toBeTruthy();
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(null, "XYZ");
  });

  it("choosing Automatic and saving clears the override, and a custom label equal to the automatic one saves as null", async () => {
    const first = setup({ saved: ["ABC", null] });
    await first.user.click(within(block(1, "custom")).getByRole("radio", { name: "Automatic" }));
    await first.user.click(save());
    expect(first.onSave).toHaveBeenCalledWith(null, null);
    first.unmount();

    const second = setup({ saved: ["ABC", null] });
    await second.user.clear(screen.getByLabelText("Label"));
    await second.user.type(screen.getByLabelText("Label"), "prt");
    await second.user.click(save());
    expect(second.onSave).toHaveBeenCalledWith(null, null);
  });

  it("Cancel closes without saving", async () => {
    const { user, onSave, onClose } = setup({ saved: ["ABC", null] });
    await user.click(within(block(1, "custom")).getByRole("radio", { name: "Automatic" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("while saving the button says so and cannot be pressed; a failure says Nothing changed", () => {
    setup({ saved: ["ABC", null], saving: true, failed: true });
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(fieldError()?.textContent).toContain("Nothing changed");
  });
});
