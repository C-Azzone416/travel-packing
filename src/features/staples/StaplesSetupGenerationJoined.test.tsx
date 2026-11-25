// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMigratedDb, resetData } from "../../server/db/__fixtures__/db";
import {
  createFakeAuth,
  makeContext,
  OWNER,
  signedInAs,
  seedTrip,
} from "../../server/data/__fixtures__/seed";
import type { Db } from "../../server/db/retention";
import type { DataContext } from "../../server/data/context";
import type { StaplesSetupResult } from "../trips/trip-actions";
import * as service from "../../server/data/service";
import { StaplesSetupGate, type StaplesSetupActions } from "./StaplesSetupGate";

let current: DataContext;
vi.mock("../../server/data/runtime", () => ({ getDataContext: async () => current }));
vi.mock("next/navigation", () => ({ usePathname: () => "/staples", redirect: vi.fn() }));
import {
  getStaplesSetupAction,
  saveStaplesSetupAction,
  skipStaplesSetupAction,
  dismissStaplesReminderAction,
} from "../trips/trip-actions";

let ctx: Awaited<ReturnType<typeof createMigratedDb>>;
beforeAll(async () => {
  ctx = await createMigratedDb();
  const auth = createFakeAuth();
  signedInAs(auth, OWNER);
  current = makeContext(ctx.db as unknown as Db, auth);
});
afterAll(async () => {
  await ctx.client.close();
});
beforeEach(async () => {
  await resetData(ctx.client);
});

const snapshot = async () => ({
  staples: (await ctx.client.query("select * from staples order by id")).rows,
  users: (await ctx.client.query("select * from users order by id")).rows,
  trips: (await ctx.client.query("select * from trips order by id")).rows,
  trip_items: (await ctx.client.query("select * from trip_items order by id")).rows,
});

it.each(["fresh", "reject", "completed"] as const)(
  "actual Gate/action/migrated PGlite: pre-Save background %s retains intent and rejects stale Save with no raw content/flags/timestamps/trip changes",
  async (outcome) => {
    const seed = {
      semanticId: "underwear",
      name: "Underwear",
      qty: 4,
      category: "Clothing",
      cadence: "per day",
      packLast: false,
    };
    const first = await service.upsertStapleChecked(current, { staple: seed, expected: null });
    if (!first.ok) throw new Error(first.error.code);
    await seedTrip(ctx.db as unknown as Db, OWNER.userId);
    const save = vi.fn(saveStaplesSetupAction);
    const api = {
      get: getStaplesSetupAction,
      save,
      skip: skipStaplesSetupAction,
      dismiss: dismissStaplesReminderAction,
    };
    const view = render(
      <StaplesSetupGate actions={api}>
        <div>Saved navigation</div>
      </StaplesSetupGate>,
    );
    const user = userEvent.setup();
    const box = await screen.findByRole("checkbox", { name: "Underwear" });
    await user.click(screen.getByRole("checkbox", { name: "Socks" }));
    const changed = await service.upsertStapleChecked(current, {
      staple: { ...seed, qty: 9 },
      expected: first.data[0].revision,
    });
    expect(changed.ok).toBe(true);
    expect(
      (
        await service.upsertStapleChecked(current, {
          staple: { ...seed, semanticId: "scarf", name: "Scarf" },
          expected: null,
        })
      ).ok,
    ).toBe(true);
    if (outcome === "completed") {
      // Arrange another client's completion, before capturing the full no-write oracle.
      await ctx.client.query(
        "update users set staples_setup_state = 'completed', staples_reminder_dismissed = true",
      );
    }
    const before = await snapshot();
    const get = vi.fn<StaplesSetupActions["get"]>(async () => {
      if (outcome === "reject") throw new Error("background transport offline");
      return getStaplesSetupAction();
    });
    view.rerender(
      <StaplesSetupGate actions={{ ...api, get }}>
        <div>Saved navigation</div>
      </StaplesSetupGate>,
    );
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await act(async () => {
      await get.mock.results[0].value.catch(() => undefined);
    });
    expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(box);
    expect((screen.getByRole("checkbox", { name: "Socks" }) as HTMLInputElement).checked).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "Save 2 Staples" }));
    await act(async () => {
      await save.mock.results[0].value;
    });
    const after = await snapshot();
    console.log(
      "JOINED_REAL_ACTION_RESULT",
      JSON.stringify({
        outcome,
        result: await save.mock.results[0].value,
        args: save.mock.calls[0],
        before,
        after,
      }),
    );
    // Preserve the original QA's complete comparison and original captured argument oracle.
    expect(after).toEqual(before);
    expect(await save.mock.results[0].value).toEqual({ ok: false, code: "STALE" });
    expect(save.mock.calls[0][1]).toEqual([
      { semanticId: "underwear", revision: first.data[0].revision },
    ]);
    expect(save.mock.calls[0][0]).toEqual([
      expect.objectContaining({ id: "underwear", qty: 4 }),
      expect.objectContaining({ id: "socks", qty: 1 }),
    ]);
    expect(screen.queryByText("Saved navigation")).toBeNull();
    expect(screen.getByRole("button", { name: "Reload and discard changes" })).toBeTruthy();
  },
);

it("actual unknown-commit Retry reuses both arguments, remains stale after another writer, then explicit review alone resets", async () => {
  let committed: StaplesSetupResult | undefined;
  let attempts = 0;
  const save = vi.fn<StaplesSetupActions["save"]>(async (values, baseline) => {
    const result = await saveStaplesSetupAction(values, baseline);
    if (++attempts === 1) {
      committed = result;
      throw new Error("fixture discards committed action response");
    }
    return result;
  });
  const get = vi.fn(getStaplesSetupAction);
  const view = render(
    <StaplesSetupGate
      actions={{ get, save, skip: skipStaplesSetupAction, dismiss: dismissStaplesReminderAction }}
    >
      <div>Saved navigation</div>
    </StaplesSetupGate>,
  );
  const user = userEvent.setup();
  const original = await screen.findByRole("checkbox", { name: "Underwear" });
  await user.click(original);
  await user.click(screen.getByRole("button", { name: "Save 1 Staples" }));
  await screen.findByRole("button", { name: "Try save again" });
  expect(committed?.ok).toBe(true);
  if (!committed?.ok) throw new Error("first save did not commit");
  const stored = committed.staples[0];
  expect(
    (
      await service.upsertStapleChecked(current, {
        staple: { semanticId: stored.id, ...stored, qty: 9 },
        expected: stored.revision,
      })
    ).ok,
  ).toBe(true);
  const before = await snapshot();
  await user.click(screen.getByRole("button", { name: "Try save again" }));
  await screen.findByRole("button", { name: "Reload and discard changes" });
  expect(await save.mock.results[1].value).toEqual({ ok: false, code: "STALE" });
  expect(await snapshot()).toEqual(before);
  expect(save.mock.calls[1][0]).toBe(save.mock.calls[0][0]);
  expect(save.mock.calls[1][1]).toBe(save.mock.calls[0][1]);
  expect(get).toHaveBeenCalledTimes(1);
  get.mockRejectedValueOnce(new Error("explicit review offline"));
  await user.click(screen.getByRole("button", { name: "Reload and discard changes" }));
  await screen.findByRole("button", { name: "Try again" });
  expect(screen.getByRole("checkbox", { name: "Underwear" })).toBe(original);
  expect((original as HTMLInputElement).disabled).toBe(true);
  await user.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByText("Saved navigation");
  expect(document.body.contains(original)).toBe(false);
  expect(get).toHaveBeenCalledTimes(3);
  view.unmount();
});
