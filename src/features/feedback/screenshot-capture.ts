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
 * A PNG of what is on screen right now, or null when nothing may or can be captured: a screen where capture is blocked (the
 * blocklist is enforced HERE, not only by hiding the button), an image too large even when scaled down, or any failure. It
 * never throws, so the review sheet can say "Couldn't capture the screen" and still send the notes.
 */
export async function captureScreenshot(): Promise<Blob | null> {
  if (typeof window === "undefined" || captureBlocked(window.location.pathname)) return null;
  // Settings and other screens that show something sensitive are captured with those parts left out (capture-exclusion.ts);
  // when that cannot be proven, there is no picture and the report goes as text only.
  if (!captureReadiness(document).ok) return null;
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
        style: {
          transformOrigin: "top left",
          transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        },
        // Asked before each node is cloned or its value read: marked regions and every password field never enter the picture.
        filter: includeInCapture,
      });
      // A sensitive dialog that opened while the picture was being made is not in a state anyone proved clean: no picture.
      if (!captureReadiness(document).ok) return null;
      if (blob && blob.type === "image/png" && blob.size > 0 && blob.size <= MAX_BYTES) return blob;
      if (!blob) return null;
    }
    return null;
  } catch {
    return null;
  } finally {
    root.removeAttribute(`data-${SCREENSHOT_CAPTURE_MARKER}`);
  }
}
