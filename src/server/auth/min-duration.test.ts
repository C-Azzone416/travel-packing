import { describe, expect, it } from "vitest";
import { DEFAULT_FLOW_MIN_MS, flowMinimumMs, withMinimumDuration } from "./min-duration";

describe("flowMinimumMs", () => {
  it("defaults, accepts a whole number, and ignores anything else", () => {
    expect(flowMinimumMs({})).toBe(DEFAULT_FLOW_MIN_MS);
    expect(flowMinimumMs({ AUTH_FLOW_MIN_MS: "0" })).toBe(0);
    expect(flowMinimumMs({ AUTH_FLOW_MIN_MS: " 1200 " })).toBe(1200);
    for (const bad of ["", "abc", "-5", "1.5", "123456"]) {
      expect(flowMinimumMs({ AUTH_FLOW_MIN_MS: bad })).toBe(DEFAULT_FLOW_MIN_MS);
    }
    expect(flowMinimumMs({ AUTH_FLOW_MIN_MS: "99999" })).toBe(10_000);
  });
});

describe("withMinimumDuration", () => {
  function harness(workMs: number) {
    let at = 0;
    const slept: number[] = [];
    return {
      slept,
      run: (minimum: number, work?: () => Promise<string>) =>
        withMinimumDuration(
          work ??
            (async () => {
              at += workMs;
              return "done";
            }),
          minimum,
          () => at,
          async (ms) => {
            slept.push(ms);
            at += ms;
          },
        ),
    };
  }

  it("waits out the rest of the floor, so fast and slow work take the same time", async () => {
    const fast = harness(100);
    expect(await fast.run(800)).toBe("done");
    expect(fast.slept).toEqual([700]);
    const slow = harness(300);
    await slow.run(800);
    expect(slow.slept).toEqual([500]);
  });

  it("adds nothing when the work already took longer, or the floor is off", async () => {
    const long = harness(900);
    await long.run(800);
    expect(long.slept).toEqual([]);
    const off = harness(10);
    await off.run(0);
    expect(off.slept).toEqual([]);
  });

  it("still waits when the work throws, and rethrows", async () => {
    const t = harness(0);
    await expect(
      t.run(800, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(t.slept).toEqual([800]);
  });
});
