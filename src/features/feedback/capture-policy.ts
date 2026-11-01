// What a feedback report may say about where the person was, and where it may be captured at all (#132, design's #129 section 0).
// Pure and free of the screenshot switch: the entry point, the sheet and the real capture code all use it, so the blocklist
// cannot be bypassed by a later entry point.

/**
 * Screens where nothing is ever captured: sign-in and account screens (credentials, codes, emails). Settings is not one of them
 * (#273): it is captured with its sensitive parts left out before the picture is made (capture-exclusion.ts).
 */
const BLOCKED: readonly RegExp[] = [
  /^\/sign-in(\/|$)/,
  /^\/sign-up(\/|$)/,
  /^\/verify(\/|$)/,
  /^\/forgot-password(\/|$)/,
  /^\/reset-password(\/|$)/,
  /^\/finish-setup(\/|$)/,
  /^\/access-denied(\/|$)/,
  // Account closure asks for the current password and the word DELETE (#273: these stay blocked while Settings opens up).
  /^\/close-account(\/|$)/,
];

export function captureBlocked(pathname: string): boolean {
  return BLOCKED.some((pattern) => pattern.test(pathname));
}

/**
 * An approved code for the screen, never the path itself: a path carries a trip id. Anything unrecognised is "other".
 */
export function sceneCode(pathname: string): string {
  if (pathname === "/") return "trips";
  if (pathname === "/trips/new") return "new-trip";
  if (/^\/trips\/[^/]+\/review$/.test(pathname)) return "review";
  if (/^\/trips\/[^/]+$/.test(pathname)) return "trip";
  if (pathname === "/staples") return "staples";
  return "other";
}

export type Platform = "phone" | "tablet" | "desktop";

/** A viewport class, not a size: 600px and 1024px are the shell's own breakpoints. */
export function viewportClass(width: number): Platform {
  if (width < 660) return "phone";
  if (width < 1024) return "tablet";
  return "desktop";
}

export interface ReportContextInput {
  pathname: string;
  viewportWidth: number;
  /** `(pointer: coarse)` matched: a touch screen. */
  coarsePointer: boolean;
  /** The 7 to 40 hex build the app was deployed from, or null. */
  buildSha: string | null;
  now: Date;
}

/** The capture-time context the SDK builds a report from: approved codes and numbers only (route name, viewport class, app version). */
export function reportContext({
  pathname,
  viewportWidth,
  coarsePointer,
  buildSha,
  now,
}: ReportContextInput) {
  return {
    gameId: "travel-packing",
    buildSha,
    scene: sceneCode(pathname),
    platform: viewportClass(viewportWidth),
    input: coarsePointer ? "touch" : "mouse",
    capturedAt: now.toISOString(),
    breadcrumbs: [] as never[],
    appVersion: buildSha ? buildSha.slice(0, 7) : "dev",
  };
}
