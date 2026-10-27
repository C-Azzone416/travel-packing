export const LOCAL_FEEDBACK_ORIGIN = "http://localhost:8080";
export const PREVIEW_FEEDBACK_ORIGIN = "https://travel-packing-preview.vercel.app";

/**
 * Runtime half of the deployment boundary. The build gate removes this feature altogether from Production; this
 * exact-origin check prevents an arbitrary Vercel deployment URL or a development server on another host/port from
 * starting the SDK. E2e builds are the sole exception and route every SDK request to a synthetic in-process service.
 */
export function feedbackRuntimeAllowed(
  origin: string | null,
  development: boolean,
  previewBuild: boolean,
  e2eBuild: boolean,
): boolean {
  return (
    e2eBuild ||
    (development && origin === LOCAL_FEEDBACK_ORIGIN) ||
    (previewBuild && origin === PREVIEW_FEEDBACK_ORIGIN)
  );
}

export const feedbackE2eBuild = process.env.NEXT_PUBLIC_E2E_BUILD === "1";
export const feedbackPreviewBuild = process.env.NEXT_PUBLIC_FEEDBACK_PREVIEW_BUILD === "1";

export function feedbackRuntimeEnabled(): boolean {
  return feedbackRuntimeAllowed(
    typeof window === "undefined" ? null : window.location.origin,
    process.env.NODE_ENV === "development",
    feedbackPreviewBuild,
    feedbackE2eBuild,
  );
}
