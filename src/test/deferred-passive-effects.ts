import { createRequire } from "node:module";
import { afterAll, expect } from "vitest";

type Callback = () => unknown;
type Scheduler = {
  unstable_scheduleCallback: (
    priority: number,
    callback: Callback,
    ...options: unknown[]
  ) => unknown;
};

// Install before Testing Library imports ReactDOM, which captures this Scheduler export.
// Inert unless a test explicitly holds passive work; rendering and history tasks keep running.
const scheduler = createRequire(import.meta.url)("scheduler") as Scheduler;
const schedule = scheduler.unstable_scheduleCallback;
let active: ReturnType<typeof deferPassiveEffects> | null = null;
const intercept: Scheduler["unstable_scheduleCallback"] = (priority, callback, ...options) => {
  if (active && callback.toString().includes("flushPassiveEffects")) {
    active.callbacks.push({ priority, source: callback.toString() });
    active.pending.push(() => schedule(priority, callback, ...options));
    return schedule(priority, () => null, ...options);
  }
  return schedule(priority, callback, ...options);
};

// Only these regression files change Scheduler; every other file keeps the original export.
const enabled = /\/(?:StampsReadiness|StampDetails)\.test\.tsx$/.test(
  expect.getState().testPath ?? "",
);
if (enabled) {
  scheduler.unstable_scheduleCallback = intercept;
  afterAll(() => {
    active?.release();
    scheduler.unstable_scheduleCallback = schedule;
  });
}

/** Defer actual already-scheduled passive flushes, never component refs/effects or rendering. */
export function deferPassiveEffects() {
  if (!enabled)
    throw new Error("Passive deferral is restricted to the Stamps readiness regressions");
  if (active) throw new Error("Passive work is already deferred");
  const deferred = {
    callbacks: [] as { priority: number; source: string }[],
    pending: [] as Callback[],
    release() {
      active = null;
      scheduler.unstable_scheduleCallback = schedule;
      for (const resume of deferred.pending.splice(0)) resume();
    },
  };
  active = deferred;
  return deferred;
}
