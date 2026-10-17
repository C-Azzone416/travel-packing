// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { TripsScreen } from "./TripsScreen";
import { TripsSourceProvider } from "./TripsSourceProvider";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

// The server actions are replaced by a stateful stand-in (in tests only; production reads the data layer).
const control = vi.hoisted(() => ({ failLoad: false }));
vi.mock("./actions", async () => {
  const { createMemoryTripsSource } = await import("./trips-source");
  const { sampleLifecycleState } = await import("./fixtures");
  const source = createMemoryTripsSource(sampleLifecycleState(), { now: () => Date.now() });
  const ok = async (pending: ReturnType<typeof source.load>) => ({
    ok: true as const,
    state: await pending,
  });
  return {
    loadTripsAction: async () =>
      control.failLoad ? { ok: false as const, code: "INTERNAL" as const } : ok(source.load()),
    archiveTripAction: (id: string) => ok(source.archive(id)),
    restoreTripAction: (id: string) => ok(source.restore(id)),
    removeTripAction: (id: string) => ok(source.remove(id)),
    undoRemoveTripAction: (id: string) => ok(source.undoRemove(id)),
  };
});

afterEach(() => {
  control.failLoad = false;
});

describe("TripsScreen", () => {
  it("reads and writes through the server actions", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 16, 12) });
    try {
      const user = userEvent.setup({ advanceTimers: () => {} });
      renderInApp(
        <TripsSourceProvider>
          <TripsScreen />
        </TripsSourceProvider>,
      );
      expect(await screen.findByRole("heading", { name: "San Diego" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Remove: San Diego" }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", { name: "Remove trip" }),
      );
      await waitFor(() => expect(screen.getByText("San Diego removed")).toBeTruthy());
      await user.click(screen.getByRole("button", { name: "Past & archive 1" }));
      expect(screen.getByRole("button", { name: "Undo remove: San Diego" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the error state with Retry when the data layer fails", async () => {
    control.failLoad = true;
    renderInApp(<TripsScreen />);
    expect(
      (await screen.findAllByRole("button", { name: /try again|retry/i })).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "San Diego" })).toBeNull();
  });
});
