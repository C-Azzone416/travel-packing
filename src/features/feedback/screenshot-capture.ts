// The real screenshot capture (#130 seam, #132 body). It is compiled in ONLY when screenshots are switched on (Preview, local,
// e2e); in a Production build next.config.ts resolves this specifier to ./screenshot-capture.disabled.ts, so none of this code
// can reach the production bundle, and `npm run check:no-capture-in-build` fails the build if the marker below is found there.
// Import it as "@/features/feedback/screenshot-capture" (the exact specifier next.config.ts swaps); never by a relative path.
import { captureBlocked } from "./capture-policy";
import { captureReadiness, includeInCapture } from "./capture-exclusion";

/** Unique to this module: the production-build check looks for it. Keep it in sync with src/tooling/build-markers.ts. */
export const SCREENSHOT_CAPTURE_MARKER = "feedback-screenshot-capture";

export const screenshotCaptureAvailable: boolean = true;

/** The service accepts a PNG up to 8 MiB (the SDK's LIMITS.media). */
const MAX_BYTES = 8 * 1024 * 1024;
/** Full resolution first, then smaller until it fits. */
const PIXEL_RATIOS = [1, 0.5, 0.25] as const;

/**
 * What a capture came to. `private` is the one reason the sheet words differently ("something private is open on this screen"): a
 * sensitive dialog is open, or the parts that must be left out could not be proven to be (capture-exclusion.ts). `failed` is
 * everything else: a blocked screen, an image too large even when scaled down, or any error.
 */
export type CaptureResult = { kind: "ok"; blob: Blob } | { kind: "private" } | { kind: "failed" };

const FAILED: CaptureResult = { kind: "failed" };
const PRIVATE: CaptureResult = { kind: "private" };

/**
 * A PNG of what is on screen right now, with the sensitive parts left out before it is made, or no picture: a screen where capture
 * is blocked (the blocklist is enforced HERE, not only by hiding the button), a private surface open, an image too large even when
 * scaled down, or any failure. It never throws, so the review sheet can say why there is no screenshot and still send the notes.
 */
export async function captureScreenshot(): Promise<CaptureResult> {
  if (typeof window === "undefined" || captureBlocked(window.location.pathname)) return FAILED;
  // Settings and other screens that show something sensitive are captured with those parts left out (capture-exclusion.ts);
  // when that cannot be proven, there is no picture and the report goes as text only.
  if (!captureReadiness(document).ok) return PRIVATE;
  const root = document.documentElement;
  // The marker is part of this attribute's name, so a bundler cannot keep this function without it.
  root.setAttribute(`data-${SCREENSHOT_CAPTURE_MARKER}`, "");
  try {
    const { toBlob } = await import("html-to-image");
    for (const pixelRatio of PIXEL_RATIOS) {
      const blob = await toBlob(root, {
        pixelRatio,
        width: window.innerWidth,
        height: window.innerHeight,
        // The scrolled page is shifted with negative margins, NOT a transform (#296): a transform on the root makes it the
        // containing block of every fixed element, so a modal sheet (position: fixed) was placed against the whole document and
        // fell outside the picture whenever the page was scrolled. A margin moves the page's own content and leaves fixed
        // elements (sheets, their backdrop, toasts) where the viewport shows them.
        style: {
          marginTop: `${-window.scrollY}px`,
          marginLeft: `${-window.scrollX}px`,
        },
        // Asked before each node is cloned or its value read: marked regions and every password field never enter the picture.
        filter: includeInCapture,
      });
      // A sensitive dialog that opened while the picture was being made is not in a state anyone proved clean: no picture.
      if (!captureReadiness(document).ok) return PRIVATE;
      if (blob && blob.type === "image/png" && blob.size > 0 && blob.size <= MAX_BYTES) {
        return { kind: "ok", blob };
      }
      if (!blob) return FAILED;
    }
    return FAILED;
  } catch {
    return FAILED;
  } finally {
    root.removeAttribute(`data-${SCREENSHOT_CAPTURE_MARKER}`);
  }
}
