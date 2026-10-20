// @vitest-environment jsdom
// Weather while shaping a new trip: the states around the card (turned on later, offline, unavailable, a failed
// opt-in) and what Save sends. The opt-in happy path is in TripFlow.test.tsx.
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StopWeather } from "@/domain/weather/types";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "./fixtures";
import { TripFlow } from "./TripFlow";
import { TripsSourceProvider } from "./TripsSourceProvider";
import { createMemoryTripsSource, type TripsSource } from "./trips-source";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/new",
  useRouter: () => ({ push }),
}));

const stops: StopWeather[] = [
  {
    stopIndex: 0,
    status: "ok",
    days: [
      {
        date: "2026-11-13",
        stopIndex: 0,
        source: "typical",
        highC: 14,
        lowC: 6,
        precipProbability: 0.8,
        precipMm: 4,
        snowCm: 0,
        uvIndexMax: null,
        sunshineHours: 2,
      },
    ],
  },
];

interface Options {
  optedIn?: boolean;
  preview?: unknown;
  previewThrows?: boolean;
  updateFails?: boolean;
  allowCustom?: boolean;
}

function setup(options: Options = {}) {
  push.mockClear();
  const memory = createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => "new",
    today: () => "2026-10-16",
  });
  let optedIn = options.optedIn ?? false;
  const previewDraft = vi.fn(async () => {
    if (options.previewThrows) throw new Error("no");
    return options.preview ?? { kind: "ready", stops };
  });
  const updateSettings = vi.fn(async (change: { weatherOptIn?: boolean }) => {
    if (options.updateFails) throw new Error("no");
    optedIn = change.weatherOptIn ?? optedIn;
    return { weatherOptIn: optedIn, temperatureUnit: "F" as const };
  });
  const createTripWithReview = vi.fn(async (draft: Parameters<typeof memory.createTrip>[0]) =>
    memory.createTrip(draft),
  );
  const source = {
    ...memory,
    weather: {
      getSettings: async () => ({ weatherOptIn: optedIn, temperatureUnit: "F" as const }),
      updateSettings,
      getTripWeather: vi.fn(),
      previewDraft,
      createTripWithReview,
      listSuggestions: vi.fn().mockResolvedValue([]),
      applyReview: vi.fn(),
    },
  } as unknown as TripsSource;
  const user = userEvent.setup();
  renderInApp(
    <TripsSourceProvider source={source}>
      <TripFlow allowCustom={options.allowCustom} getToday={() => "2026-10-16"} />
    </TripsSourceProvider>,
  );
  return { user, previewDraft, updateSettings, createTripWithReview, memory };
}

async function toShape(user: ReturnType<typeof userEvent.setup>, place = "lisbon") {
  await user.type(screen.getByRole("combobox", { name: "Destination search" }), place);
  await user.click(within(screen.getByRole("listbox")).getAllByRole("option")[0]);
  fireEvent.change(screen.getByLabelText("Leave"), { target: { value: "2026-11-12" } });
  fireEvent.change(screen.getByLabelText("Return"), { target: { value: "2026-11-16" } });
  await user.click(screen.getByRole("button", { name: "Continue to packing preferences" }));
  await screen.findByRole("heading", { name: "Shape the list" });
}

describe("weather on Shape the list", () => {
  it("Turn on after Not now opts in and previews the weather", async () => {
    const { user, previewDraft, updateSettings } = setup();
    await toShape(user);
    await user.click(await screen.findByRole("button", { name: "Not now" }));
    expect(await screen.findByText("Weather is off")).toBeTruthy();
    expect(previewDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(updateSettings).toHaveBeenLastCalledWith({ weatherOptIn: true }));
    expect(await screen.findByText("Weather is shaping this list")).toBeTruthy();
    expect(screen.getByText("Forecast and typical conditions are reflected below.")).toBeTruthy();
  });

  it("a failed opt-in says so and changes nothing", async () => {
    const { user, previewDraft } = setup({ updateFails: true });
    await toShape(user);
    await user.click(await screen.findByRole("button", { name: "Get weather" }));
    expect(await screen.findByText("Couldn’t update weather. Nothing was changed.")).toBeTruthy();
    expect(previewDraft).not.toHaveBeenCalled();
    expect(screen.getByText("Everyday tops", { selector: "strong" })).toBeTruthy();
  });

  it.each([
    ["offline", { kind: "offline" }, "You’re offline"],
    ["unavailable", { kind: "unavailable" }, "Weather isn’t available"],
  ])("a %s preview keeps the standard list and offers Try again", async (_name, preview, title) => {
    const { user, previewDraft } = setup({ optedIn: true, preview });
    await toShape(user);
    expect(await screen.findByText(title)).toBeTruthy();
    expect(screen.getByText("Everyday tops", { selector: "strong" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(previewDraft).toHaveBeenCalledTimes(2));
  });

  it("a preview that fails to load leaves the list as it was", async () => {
    const { user } = setup({ optedIn: true, previewThrows: true });
    await toShape(user);
    expect(await screen.findByText("Weather isn’t available")).toBeTruthy();
    expect(screen.getByText("Everyday tops", { selector: "strong" })).toBeTruthy();
  });

  it("shows no weather card for a custom destination", async () => {
    const { user, previewDraft } = setup({ optedIn: true, allowCustom: true });
    await user.type(
      screen.getByRole("combobox", { name: "Destination search" }),
      "Grandma's cabin",
    );
    await user.click(within(screen.getByRole("listbox")).getByRole("option"));
    fireEvent.change(screen.getByLabelText("Leave"), { target: { value: "2026-11-12" } });
    fireEvent.change(screen.getByLabelText("Return"), { target: { value: "2026-11-14" } });
    await user.click(screen.getByRole("button", { name: "Continue to packing preferences" }));
    await screen.findByRole("heading", { name: "Shape the list" });
    expect(screen.queryByText("Get weather for your stops?")).toBeNull();
    expect(previewDraft).not.toHaveBeenCalled();
  });

  it("Save sends the clothing split with its rule signature, never raw weather", async () => {
    const { user, createTripWithReview } = setup({ optedIn: true });
    await toShape(user);
    await screen.findByText("Weather is shaping this list");
    await user.click(screen.getByRole("button", { name: "Save trip" }));
    await waitFor(() => expect(createTripWithReview).toHaveBeenCalledTimes(1));
    const accepted = (
      createTripWithReview.mock.calls[0] as unknown as [unknown, { kind: string }[]]
    )[1];
    expect(accepted.map((change) => change.kind)).toContain("split");
    expect(JSON.stringify(accepted)).not.toMatch(/highC|lowC|precip/);
    expect(push).toHaveBeenCalledWith("/");
  });
});
