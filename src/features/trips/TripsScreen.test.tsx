// @vitest-environment jsdom
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { renderInApp } from "@/test/providers";
import { TripsScreen } from "./TripsScreen";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("TripsScreen", () => {
  it("wires the dashboard to an in-memory source seeded with the synthetic trips", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 16, 12) });
    try {
      const user = userEvent.setup({ advanceTimers: () => {} });
      renderInApp(<TripsScreen />);
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
});
