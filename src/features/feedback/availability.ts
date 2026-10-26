export const LOCAL_FEEDBACK_ORIGIN = "http://localhost:8080";

/**
 * Runtime half of the local-only boundary. The build gate removes this feature altogether from hosted builds; this
 * exact-origin check prevents a development server on another host or port from starting the SDK. E2e builds are the
 * sole exception and route every SDK request to a synthetic in-process service.
 */
export function feedbackRuntimeAllowed(
  origin: string | null,
  development: boolean,
  e2eBuild: boolean,
): boolean {
  return e2eBuild || (development && origin === LOCAL_FEEDBACK_ORIGIN);
}

export const feedbackE2eBuild = process.env.NEXT_PUBLIC_E2E_BUILD === "1";

export function feedbackRuntimeEnabled(): boolean {
  return feedbackRuntimeAllowed(
    typeof window === "undefined" ? null : window.location.origin,
    process.env.NODE_ENV === "development",
    feedbackE2eBuild,
  );
}
