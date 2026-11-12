// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { TripsDashboard } from "@/features/trips/TripsDashboard";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { TripScreen } from "@/features/trip/TripScreen";
import { StampsScreen } from "./StampsScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const TODAY = () => "2026-10-16";
const LISBON = "Lisbon, Sep 2026, inked, 1 trip";
const MADRID = "Madrid, Sep 2026, inked, 1 trip";

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function setup() {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const sample = sampleLifecycleState();
  const lisbon = sample.trips[1];
  const base = lisbon.stops[0];
  const madrid = {
    ...base,
    location: { ...base.location, id: "es", city: "Madrid", country: "Spain", countryCode: "ES" },
  };
  const source = createMemoryTripsSource(
    { ...sample, trips: [sample.trips[0], { ...lisbon, stops: [base, madrid] }] },
    { now: () => 5_000 },
  );
  const real = source.setStampLabels.bind(source);
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const write = vi
    .spyOn(source, "setStampLabels")
    .mockImplementationOnce(() => Promise.reject(new Error("down")))
    .mockImplementationOnce(async (...args) => {
      await gate;
      return real(...args);
    });
  return { source, write, release: () => release(), user: userEvent.setup() };
}

async function failThenRetry(ctx: ReturnType<typeof setup>) {
  const { user, source } = ctx;
  renderInApp(
    <TripsSourceProvider source={source}>
      <ShellWithSource source={source} />
    </TripsSourceProvider>,
  );
  await user.click(await screen.findByRole("tab", { name: /^Stamps/ }));
  await user.click(await screen.findByRole("button", { name: LISBON }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
  );
  await typeLabel(user, /Stamp 2/, "qqq");
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByText(/Couldn’t save the stamp/);
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  // Client-side navigation to the Stamps screen; the top bar's Retry is still the one from Home.
  await user.click(screen.getByRole("button", { name: "Go to Stamps" }));
  await screen.findByRole("heading", { name: "Stamps", level: 1 });
  await user.click(await screen.findByRole("button", { name: "Not saved, retry" }));
  await user.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(ctx.write).toHaveBeenCalledTimes(2));
}

/** The root layout's lifetime: the providers stay, the screen is swapped by client-side navigation. */
function ShellWithSource({ source }: { source: ReturnType<typeof createMemoryTripsSource> }) {
  const [screenName, setScreen] = useState<"home" | "stamps">("home");
  return (
    <>
      <button onClick={() => setScreen("stamps")}>Go to Stamps</button>
      {screenName === "home" ? (
        <TripsDashboard source={source} getToday={TODAY} />
      ) : (
        <StampsScreen getToday={TODAY} />
      )}
    </>
  );
}

async function typeLabel(user: ReturnType<typeof userEvent.setup>, stamp: RegExp, text: string) {
  const group = within(screen.getByRole("group", { name: stamp }));
  await user.click(group.getByRole("radio", { name: "Custom" }));
  await user.clear(group.getByLabelText("Label"));
  await user.type(group.getByLabelText("Label"), text);
}

const code = (name: string) =>
  screen.getByRole("button", { name }).querySelector("strong")?.getAttribute("data-text");

describe("a Retry that lands after navigating to the Stamps screen", () => {
  it("shows the retried label at once, and the next edit keeps it", async () => {
    const ctx = setup();
    await failThenRetry(ctx);
    ctx.release();
    await waitFor(() => expect(code(MADRID)).toBe("QQQ"));
    await ctx.user.click(screen.getByRole("button", { name: LISBON }));
    await ctx.user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    await typeLabel(ctx.user, /Stamp 1/, "abc");
    await ctx.user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ctx.write).toHaveBeenLastCalledWith("lisbon", "ABC", "QQQ");
    expect(ctx.source.snapshot().trips[1].stampLabels).toEqual(["ABC", "QQQ"]);
  });

  it("blocks an edit submitted while the Retry is still pending", async () => {
    const ctx = setup();
    await failThenRetry(ctx);
    await ctx.user.click(screen.getByRole("button", { name: LISBON }));
    await ctx.user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    expect((screen.getByRole("button", { name: "Saving…" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(ctx.write).toHaveBeenCalledTimes(2);
    await act(async () => ctx.release());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Saving…" })).toBeNull());
    await typeLabel(ctx.user, /Stamp 1/, "abc");
    await ctx.user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(ctx.source.snapshot().trips[1].stampLabels).toEqual(["ABC", "QQQ"]);
  });
});

/** The Trip page and the Stamps screen in one app shell (the root layout's lifetime; the screen is swapped). */
function TripThenStamps() {
  const [screenName, setScreen] = useState<"trip" | "stamps">("trip");
  return (
    <>
      <button onClick={() => setScreen("stamps")}>Go to Stamps</button>
      {screenName === "trip" ? (
        <TripScreen tripId="san-diego" />
      ) : (
        <StampsScreen getToday={TODAY} />
      )}
    </>
  );
}

describe("a Trip-page label save is recorded for the Stamps screen", () => {
  it("Stamps shows the saved label over the copy it loaded before, and the next Stamps edit keeps it", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    const sample = sampleLifecycleState();
    const sanDiego = sample.trips[0];
    const base = sanDiego.stops[0];
    const madrid = {
      ...base,
      location: { ...base.location, id: "es", city: "Madrid", country: "Spain", countryCode: "ES" },
    };
    const memory = createMemoryTripsSource(
      { ...sample, trips: [{ ...sanDiego, stops: [base, madrid] }, sample.trips[1]] },
      { now: () => 5_000 },
    );
    // The copy a screen loaded before the Trip-page save: the Stamps screen loads it after the save.
    const frozen = memory.snapshot();
    const source = { ...memory, load: async () => frozen };
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={source}>
        <TripThenStamps />
      </TripsSourceProvider>,
    );

    await screen.findByRole("heading", { name: "Pack mode", level: 1 });
    await user.click(screen.getByRole("button", { name: "Edit stamp" }));
    await typeLabel(user, /Stamp 1/, "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Go to Stamps" }));
    await screen.findByRole("heading", { name: "Stamps", level: 1 });
    const button = await screen.findByRole("button", { name: /^San Diego/ });
    expect(button.querySelector("strong")?.getAttribute("data-text")).toBe("ABC");

    await user.click(button);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    await typeLabel(user, /Stamp 2/, "xyz");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(source.snapshot().trips[0].stampLabels).toEqual(["ABC", "XYZ"]);
  });
});
