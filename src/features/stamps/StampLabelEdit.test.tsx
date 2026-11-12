// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
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
    await waitFor(() => expect(setLabels).toHaveBeenCalledWith("lisbon", "ABC", "ZZZ"));
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

  it("tracks the write: a failed save blocks Save with the top-bar note, and Retry replays the read and write", async () => {
    let calls = 0;
    const { user, src } = open(withTrip(lisbon()));
    const real = src.setStampLabels.bind(src);
    vi.spyOn(src, "setStampLabels").mockImplementation((...args) => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error("down")) : real(...args);
    });
    await user.click(await screen.findByRole("button", { name: LISBON }));
    await user.click(edit(screen.getByRole("dialog")));
    await user.click(screen.getByRole("radio", { name: "Custom" }));
    const input = screen.getByLabelText("Label");
    await user.clear(input);
    await user.type(input, "qq1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const editor = await screen.findByRole("dialog", { name: "Stamp label" });
    await waitFor(() =>
      expect(within(editor).getAllByText(LABEL_FAILED).length).toBeGreaterThan(0),
    );
    expect(within(editor).getByRole("alert").textContent).toContain("Couldn’t save the stamp");
    expect(within(editor).getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(
      true,
    );
    await user.click(within(editor).getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Not saved, retry" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(calls).toBe(2));
    await waitFor(() =>
      expect(screen.getByRole("article", { name: /Selected trip/ }).textContent).toContain("QQ1"),
    );
  });
});
