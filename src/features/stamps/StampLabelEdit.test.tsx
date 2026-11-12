// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useSaveStatus } from "@/components/shell/SaveStatus";
import { renderInApp } from "@/test/providers";
import { SAMPLE_LOCATIONS } from "@/features/trips/fixtures";
import { buildTrip, emptyLifecycleState } from "@/domain/trip-lifecycle";
import type { TripConfig } from "@/domain/trip";
import type { LifecycleTrip } from "@/domain/trip-lifecycle";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { StampsScreen } from "./StampsScreen";
import { LABEL_FAILED, LABEL_ROUTE, LABEL_SAVING, StampLabelAction } from "./StampLabelEdit";

vi.mock("next/navigation", () => ({ usePathname: () => "/stamps" }));

const TODAY = "2026-10-16";
const CONFIG: TripConfig = {
  laundry: false,
  spare: true,
  niceAttire: false,
  occasionCount: 1,
  reuseNice: false,
  returnOutfit: true,
};
const LISBON = "Lisbon, Sep 2026, inked, 1 trip";

function lisbon(): LifecycleTrip {
  return buildTrip(
    "Lisbon",
    SAMPLE_LOCATIONS["pt-lisbon"],
    "2026-09-03",
    "2026-09-07",
    CONFIG,
    [],
    {
      newId: () => "lisbon",
      today: TODAY,
    },
  );
}
/** Lisbon then San Diego: two countries, so two automatic stamps (PRT, USA) and two editable slots. */
function twoCountries(): LifecycleTrip {
  const base = lisbon();
  const [first] = base.stops;
  return {
    ...base,
    stops: [
      { ...first, leave: "2026-09-05" },
      { ...first, location: SAMPLE_LOCATIONS["us-ca-san-diego"], arrive: "2026-09-05" },
    ],
  };
}
function withTrip(...trips: LifecycleTrip[]) {
  return { ...emptyLifecycleState(), trips };
}

let write: { resolve: () => void; reject: (error: Error) => void } | null = null;
function Trigger() {
  const { track } = useSaveStatus();
  return (
    <button
      type="button"
      onClick={() =>
        void track(
          () =>
            new Promise<void>((resolve, reject) => {
              write = { resolve, reject };
            }),
        ).catch(() => undefined)
      }
    >
      Start other write
    </button>
  );
}

function open(state = withTrip(lisbon()), patch: Partial<TripsSource> = {}) {
  const user = userEvent.setup();
  const base = createMemoryTripsSource(state, { now: () => 1, today: () => TODAY });
  const src = { ...base, ...patch } as TripsSource;
  renderInApp(
    <TripsSourceProvider source={src}>
      <Trigger />
      <StampsScreen getToday={() => TODAY} />
    </TripsSourceProvider>,
  );
  return { user, src };
}
const edit = (scope: HTMLElement | Document = document) =>
  within(scope as HTMLElement).getByRole("button", { name: "Edit stamp label" });

describe("Edit stamp label (#494)", () => {
  it("is offered on the details sheet and on the selected card, and opens the editor", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: LISBON }));
    const card = screen.getByRole("article", { name: /Selected trip/ });
    expect(edit(card).getAttribute("aria-disabled")).toBeNull();
    await user.click(edit(screen.getByRole("dialog")));
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(edit(card));
    expect(screen.getByRole("dialog", { name: "Stamp label" })).toBeTruthy();
  });

  it("hides the action when the trip has no stop", () => {
    renderInApp(<StampLabelAction trip={{ ...lisbon(), stops: [] }} onEdit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Edit stamp label" })).toBeNull();
  });

  it("shows the route line, disabled, for a sticker whose code comes from a later stop", async () => {
    const base = lisbon();
    const [first] = base.stops;
    const stop = (city: string, arrive: string) => ({
      ...first,
      location: { ...first.location, city, id: city },
      arrive,
    });
    const trip = {
      ...base,
      stops: [stop("Porto", "2026-09-03"), stop("Faro", "2026-09-04"), stop("Lagos", "2026-09-05")],
    };
    const { user, src } = open(withTrip(trip));
    const setLabels = vi.spyOn(src, "setStampLabels");
    await user.click(await screen.findByRole("button", { name: /^Lagos, Sep 2026/ }));
    const button = edit(screen.getByRole("dialog"));
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(within(screen.getByRole("dialog")).getByText(LABEL_ROUTE)).toBeTruthy();
    await user.click(button);
    expect(screen.queryByRole("dialog", { name: "Stamp label" })).toBeNull();
    expect(setLabels).not.toHaveBeenCalled();
  });

  it("is disabled while another write is pending, says why, and enables again after it succeeds", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(screen.getByRole("button", { name: "Start other write" }));
    const dialog = screen.getByRole("dialog", { name: "Lisbon · Sep 2026" });
    const button = edit(dialog);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(within(dialog).getAllByText(LABEL_SAVING).length).toBeGreaterThan(0);
    await user.click(button);
    expect(screen.queryByRole("dialog", { name: "Stamp label" })).toBeNull();
    await act(async () => write?.resolve());
    await waitFor(() => expect(edit(dialog).getAttribute("aria-disabled")).toBeNull());
    expect(within(dialog).getByRole("status").textContent).toBe(
      "Stamp label editing available again.",
    );
  });

  it("is disabled after a failed write until the top bar Retry succeeds", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(screen.getByRole("button", { name: "Start other write" }));
    await act(async () => write?.reject(new Error("down")));
    const dialog = screen.getByRole("dialog", { name: "Lisbon · Sep 2026" });
    await waitFor(() =>
      expect(within(dialog).getAllByText(LABEL_FAILED).length).toBeGreaterThan(0),
    );
    expect(edit(dialog).getAttribute("aria-disabled")).toBe("true");
    // The sheet is modal; reach the chip through the DOM as the person would after closing it.
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await act(async () => write?.resolve());
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await waitFor(() =>
      expect(edit(screen.getByRole("dialog")).getAttribute("aria-disabled")).toBeNull(),
    );
  });

  it("saves fresh server values for the slot the person did not touch", async () => {
    const trip = {
      ...twoCountries(),
      stampLabels: ["AAA", null] as [string | null, string | null],
    };
    const { user, src } = open(withTrip(trip));
    const setLabels = vi.spyOn(src, "setStampLabels");
    await user.click(await screen.findByRole("button", { name: /^Lisbon, Sep 2026/ }));
    await user.click(edit(screen.getByRole("dialog")));
    // The server gains a slot 2 label after the screen loaded.
    await src.setStampLabels("lisbon", "AAA", "ZZZ");
    setLabels.mockClear();
    const group = screen.getByRole("group", { name: "Stamp 1, custom" });
    const input = within(group).getByLabelText("Label");
    await user.clear(input);
    await user.type(input, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(setLabels).toHaveBeenCalledWith("lisbon", "ABC", "ZZZ", [true, false]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stamp label" })).toBeNull());
  });

  it("updates the sticker from the server result after a save", async () => {
    const { user } = open();
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(edit(screen.getByRole("dialog")));
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const input = screen.getByLabelText("Label");
    await user.clear(input);
    await user.type(input, "xy9");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(screen.getByRole("article", { name: /Selected trip/ }).textContent).toContain("XY9"),
    );
  });

  it("keeps the draft after a failed save and offers one Try again inside the editor, with no Cancel", async () => {
    let calls = 0;
    const trip = {
      ...twoCountries(),
      stampLabels: ["AAA", null] as [string | null, string | null],
    };
    const { user, src } = open(withTrip(trip));
    const real = src.setStampLabels.bind(src);
    vi.spyOn(src, "setStampLabels").mockImplementation((...args) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("down")) : real(...args);
    });
    await user.click(await screen.findByRole("button", { name: /^Lisbon, Sep 2026/ }));
    await user.click(edit(screen.getByRole("dialog")));
    const input = within(screen.getByRole("group", { name: "Stamp 1, custom" })).getByLabelText(
      "Label",
    );
    await user.clear(input);
    await user.type(input, "qq1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const editor = await screen.findByRole("dialog", { name: "Stamp label" });
    const retry = await within(editor).findByRole("button", { name: "Try again" });
    expect(within(editor).getByRole("alert").textContent).toContain("Your changes are kept");
    expect(within(editor).queryByText(LABEL_FAILED)).toBeNull();
    expect(within(editor).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect((input as HTMLInputElement).value).toBe("QQ1");
    // Another session changes slot 2 before the retry: the retry reads again.
    await real("lisbon", "AAA", "ZZZ");
    await user.click(retry);
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Stamp label" })).toBeNull());
    expect(await src.getTrip("lisbon")).toMatchObject({ stampLabels: ["QQ1", "ZZZ"] });
  });

  it("says Saving, not the failure, while the retry is in flight, and fails again cleanly", async () => {
    const { user, src } = open(withTrip(lisbon()));
    let gate: (() => void) | null = null;
    let calls = 0;
    vi.spyOn(src, "setStampLabels").mockImplementation(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("down"));
      return new Promise((_, reject) => {
        gate = () => reject(new Error("still down"));
      });
    });
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(edit(screen.getByRole("dialog")));
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const input = screen.getByLabelText("Label");
    await user.clear(input);
    await user.type(input, "qq1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const editor = await screen.findByRole("dialog", { name: "Stamp label" });
    await user.click(await within(editor).findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(within(editor).getByText(LABEL_SAVING)).toBeTruthy());
    expect(
      within(editor).getByRole("button", { name: "Try again" }).getAttribute("aria-disabled"),
    ).toBe("true");
    expect(within(editor).queryByRole("alert")).toBeNull();
    // The visible draft is the retried payload: the fields are read-only while it is pending.
    expect((within(editor).getByLabelText("Label") as HTMLInputElement).readOnly).toBe(true);
    await act(async () => (gate as (() => void) | null)?.());
    expect(await within(editor).findByRole("button", { name: "Try again" })).toBeTruthy();
    expect(
      within(editor).getByRole("button", { name: "Try again" }).getAttribute("aria-disabled"),
    ).toBeNull();
  });

  it("does not send an untouched slot as automatic: a stored code equal to the automatic one stays the server's", async () => {
    // A route change can leave slot 2's stored label equal to its new automatic code (USA).
    const trip = {
      ...twoCountries(),
      stampLabels: ["AAA", "USA"] as [string | null, string | null],
    };
    const { user, src } = open(withTrip(trip));
    const setLabels = vi.spyOn(src, "setStampLabels");
    await user.click(await screen.findByRole("button", { name: /^Lisbon, Sep 2026/ }));
    await user.click(edit(screen.getByRole("dialog")));
    // Another session saved ZZZ in slot 2 after this editor opened.
    await src.setStampLabels("lisbon", "AAA", "ZZZ");
    setLabels.mockClear();
    const input = within(screen.getByRole("group", { name: "Stamp 1, custom" })).getByLabelText(
      "Label",
    );
    await user.clear(input);
    await user.type(input, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(setLabels).toHaveBeenCalledWith("lisbon", "ABC", "ZZZ", [true, false]),
    );
  });

  it("the selected card follows the selected sticker: a route-derived one is disabled, and no editable stamp hides it", async () => {
    const base = lisbon();
    const [first] = base.stops;
    const stop = (city: string, arrive: string, extra = {}) => ({
      ...first,
      location: { ...first.location, city, id: city, ...extra },
      arrive,
    });
    const porto = {
      ...base,
      stops: [stop("Lisbon", "2026-09-03"), stop("Porto", "2026-09-05")],
    };
    const { user } = open(withTrip(porto));
    await user.click(await screen.findByRole("button", { name: /^Porto, Sep 2026/ }));
    await user.keyboard("{Escape}");
    const card = screen.getByRole("article", { name: /Selected trip/ });
    expect(edit(card).getAttribute("aria-disabled")).toBe("true");
    expect(within(card).getByText(LABEL_ROUTE)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /^Lisbon, Sep 2026/ }));
    await user.keyboard("{Escape}");
    expect(edit(card).getAttribute("aria-disabled")).toBeNull();
  });

  it("hides the action for a stop with no country and no airport stamp", () => {
    const base = lisbon();
    const nowhere = {
      ...base,
      stops: base.stops.map((stop) => ({
        ...stop,
        airportCode: undefined,
        location: { ...stop.location, countryCode: "", country: "" },
      })),
    };
    renderInApp(<StampLabelAction trip={nowhere} onEdit={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Edit stamp label" })).toBeNull();
  });

  it("takes focus before opening from the card, so Escape returns to the card action", async () => {
    const { user } = open();
    const sticker = await screen.findByRole("button", { name: LISBON });
    sticker.focus();
    const card = screen.getByRole("article", { name: /Selected trip/ });
    fireEvent.click(edit(card));
    await user.keyboard("{Escape}");
    expect(document.activeElement).toBe(edit(card));
  });
});
