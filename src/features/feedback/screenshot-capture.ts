// The real screenshot capture (#130 seam, #132 body). It is compiled in ONLY when screenshots are switched on (Preview, local,
// e2e); in a Production build next.config.ts resolves this specifier to ./screenshot-capture.disabled.ts, so none of this code
// can reach the production bundle, and `npm run check:no-capture-in-build` fails the build if the marker below is found there.
// Import it as "@/features/feedback/screenshot-capture" (the exact specifier next.config.ts swaps); never by a relative path.

/** Unique to this module: the production-build check looks for it. Keep it in sync with src/tooling/build-markers.ts. */
export const SCREENSHOT_CAPTURE_MARKER = "feedback-screenshot-capture";

export const screenshotCaptureAvailable: boolean = true;

/** A reviewed PNG of the page, or null when the person declines. #132 implements the capture. */
export async function captureScreenshot(): Promise<Blob | null> {
  // The marker lives in the function body (not only in a constant) so a bundler cannot drop it while keeping the function.
  throw new Error(`${SCREENSHOT_CAPTURE_MARKER}: added with the capture flow (#132)`);
}
