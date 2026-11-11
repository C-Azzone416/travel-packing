// @vitest-environment jsdom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import type { LifecycleState } from "@/domain/trip-lifecycle";
import { sampleLifecycleState } from "./fixtures";
import { HomePhone } from "./HomePhone";
import { createMemoryTripsSource } from "./trips-source";
import { TripsSourceProvider } from "./TripsSourceProvider";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn() }),
}));

const TODAY = "2026-10-16";
const LISBON = "Lisbon, Sep 2026, inked, 1 trip";

/** The sample's finished Lisbon trip, now Lisbon (PT) then Madrid (ES): two route stamps, so two label slots. */
function twoCountries(): LifecycleState {
  const state = sampleLifecycleState();
  const [hero, lisbon] = [state.trips[0], state.trips[1]];
  const base = lisbon.stops[0];
  const madrid = {
    ...base,
    location: { ...base.location, id: "es", city: "Madrid", country: "Spain", countryCode: "ES" },
  };
  return { ...state, trips: [hero, { ...lisbon, stops: [base, madrid] }] };
}

function setup() {
  const user = userEvent.setup();
  const state = twoCountries();
  const source = createMemoryTripsSource(state, { now: () => 1, today: () => TODAY });
  renderInApp(
    <TripsSourceProvider source={source}>
      <HomePhone
        trip={state.trips[0]}
        later={[]}
        state={state}
        today={TODAY}
        weather={{ phase: "none" }}
        map={null}
        busy={false}
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onRemove={vi.fn()}
        onOpenArchive={vi.fn()}
      />
    </TripsSourceProvider>,
  );
  return { user, source };
}

afterEach(() => window.history.replaceState(null, "", "/"));

const stickerCode = (name: string) =>
  screen.getByRole("button", { name }).querySelector("strong")?.getAttribute("data-text");

async function openEditor(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: /^Stamps/ }));
  await user.click(screen.getByRole("button", { name: LISBON }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
  );
  return screen.getByRole("dialog", { name: "Stamp label" });
}

async function saveCustom(user: ReturnType<typeof userEvent.setup>, group: RegExp, text: string) {
  const stamp = within(screen.getByRole("group", { name: group }));
  await user.click(stamp.getByRole("radio", { name: "Custom" }));
  const field = stamp.getByLabelText("Label");
  await user.clear(field);
  await user.type(field, text);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

describe("the phone Home's Stamps panel keeps what it saved", () => {
  it("shows a saved label after a pill change, and a later save keeps the other slot", async () => {
    const { user, source } = setup();
    await openEditor(user);
    await saveCustom(user, /Stamp 2/, "qqq");
    // Away and back: the panel is drawn again from the dashboard's older snapshot.
    await user.click(screen.getByRole("tab", { name: /^Pack/ }));
    await user.click(screen.getByRole("tab", { name: /^Stamps/ }));
    expect(source.snapshot().trips[1].stampLabels).toEqual([null, "QQQ"]);
    await user.click(screen.getByRole("button", { name: LISBON }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit stamp label" }),
    );
    // The editor starts from the confirmed labels, so Stamp 2 is still Custom.
    expect(
      within(screen.getByRole("group", { name: /Stamp 2/ })).getByLabelText("Label"),
    ).toHaveProperty("value", "QQQ");
    await saveCustom(user, /Stamp 1/, "abc");
    expect(source.snapshot().trips[1].stampLabels).toEqual(["ABC", "QQQ"]);
    expect(stickerCode(LISBON)).toBe("ABC");
  });
});

describe("phone Back with the stamp editor open", () => {
  it("closes the editor inside Stamps, keeps the panel and the draft's trip, and focuses the sticker", async () => {
    const { user, source } = setup();
    await user.click(screen.getByRole("tab", { name: /^Pack/ }));
    await openEditor(user);
    expect(new URLSearchParams(window.location.search).get("tab")).toBe("stamps");
    await act(async () => {
      window.history.back();
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Stamps/ }).getAttribute("aria-selected")).toBe("true");
    const sticker = screen.getByRole("button", { name: LISBON });
    expect(document.activeElement).toBe(sticker);
    expect(source.snapshot().trips[1].stampLabels ?? [null, null]).toEqual([null, null]);
  });

  it("does not leave a stray history entry behind when the editor is cancelled", async () => {
    const { user } = setup();
    await openEditor(user);
    const before = window.history.length;
    await user.keyboard("{Escape}");
    await act(async () => {
      await new Promise((done) => setTimeout(done, 20));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("tab", { name: /^Stamps/ }).getAttribute("aria-selected")).toBe("true");
    expect(window.history.length).toBeLessThanOrEqual(before);
  });
});
