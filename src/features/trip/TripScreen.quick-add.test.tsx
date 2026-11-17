// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource, type TripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { renderInApp } from "@/test/providers";
import { TripScreen } from "./TripScreen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/trips/san-diego",
  useRouter: () => ({ push: vi.fn() }),
}));

const realMatchMedia = window.matchMedia;
beforeEach(() => {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  window.matchMedia = realMatchMedia;
  vi.clearAllMocks();
});

function memory() {
  let counter = 0;
  return createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    newId: () => `new-${++counter}`,
    today: () => "2026-10-16",
  });
}

const panel = () => document.querySelector("[data-cube]") as HTMLElement;

async function retryFromChip(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^(Not saved, retry|Saving)/ }));
  await user.click(
    within(await screen.findByRole("dialog", { name: "Couldn’t save" })).getByRole("button", {
      name: "Retry",
    }),
  );
}

describe("shared quick-add writes (#512)", () => {
  it("surfaces a reused write rejection, then Retry sends once more and succeeds", async () => {
    const base = memory();
    let rejectShared: (reason: Error) => void = () => {};
    const shared = new Promise<never>((_resolve, reject) => (rejectShared = reject));
    const addItem = vi.fn(async (...args: Parameters<typeof base.addItem>) => {
      if (addItem.mock.calls.length === 1) throw new Error("initial offline");
      if (addItem.mock.calls.length === 2) return shared;
      return base.addItem(...args);
    });
    const source = { ...base, addItem } as unknown as TripsSource;
    const user = userEvent.setup();
    renderInApp(
      <TripsSourceProvider source={source}>
        <TripScreen tripId="san-diego" />
      </TripsSourceProvider>,
    );

    await screen.findByRole("heading", { name: "Packing", level: 1 });
    await user.click(within(panel()).getByRole("button", { name: "Add an item to Clothing" }));
    const field = within(panel()).getByPlaceholderText("+ Add an item");
    await user.type(field, "Sun hat{Enter}");
    expect((await within(panel()).findByRole("alert")).textContent).toBe(
      "Couldn’t add it. Nothing was changed.",
    );

    await user.type(field, "{Enter}");
    await waitFor(() => expect(addItem).toHaveBeenCalledTimes(2));
    await retryFromChip(user);
    expect(addItem).toHaveBeenCalledTimes(2);
    rejectShared(new Error("shared offline"));
    expect((await within(panel()).findByRole("alert")).textContent).toBe(
      "Couldn’t add it. Nothing was changed.",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Not saved, retry" })).toBeTruthy(),
    );

    await retryFromChip(user);
    await waitFor(() => expect(within(panel()).getByText("Sun hat")).toBeTruthy());
    expect(addItem).toHaveBeenCalledTimes(3);
  });
});
