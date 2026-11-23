// @vitest-environment jsdom
import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { deferPassiveEffects } from "@/test/deferred-passive-effects";
import { sampleLifecycleState } from "@/features/trips/fixtures";
import { createMemoryTripsSource } from "@/features/trips/trips-source";
import { TripsSourceProvider } from "@/features/trips/TripsSourceProvider";
import { StampsScreen } from "./StampsScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/stamps" }));

it("opens on the first activation after asynchronous load while scheduled passive work is deferred (#572)", async () => {
  const deferred = deferPassiveEffects();
  const push = vi.spyOn(history, "pushState");
  const src = createMemoryTripsSource(sampleLifecycleState(), {
    now: () => 1,
    today: () => "2026-10-16",
  });
  try {
    renderInApp(
      <TripsSourceProvider source={src}>
        <StampsScreen getToday={() => "2026-10-16"} />
      </TripsSourceProvider>,
    );
    const lisbon = await screen.findByRole("button", { name: "Lisbon, Sep 2026, inked, 1 trip" });
    // Match the original StampDetails first-click path: no user-event turn or effect-ready wait.
    expect(deferred.callbacks.length).toBeGreaterThan(0);
    expect(deferred.callbacks[0]).toEqual({
      priority: 3,
      source: expect.stringContaining("flushPassiveEffects"),
    });
    fireEvent.click(lisbon);
    expect(screen.queryByRole("dialog", { name: "Lisbon · Sep 2026" })).not.toBeNull();
    expect(push).toHaveBeenCalledTimes(1);
    expect(history.state.packingStampDetails).toEqual({
      owner: expect.any(String),
      key: "pt|lisbon",
    });
    fireEvent.click(lisbon);
    expect(push).toHaveBeenCalledTimes(1);
  } finally {
    deferred.release();
    push.mockRestore();
  }
});
