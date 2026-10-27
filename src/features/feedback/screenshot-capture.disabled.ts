// What "@/features/feedback/screenshot-capture" resolves to when screenshots are off (always, in Production). It can never
// capture anything and holds none of the real module's code. Its exports must match the real module (screenshot-capture.test.ts).

export const screenshotCaptureAvailable: boolean = false;

export async function captureScreenshot(): Promise<Blob | null> {
  return null;
}
