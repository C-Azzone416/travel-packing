// Routes a Playwright page or context's Framebriar traffic into the fake service (#130), e2e only. Structural types
// stand in for Playwright's, so this file needs no Playwright import and is unit-tested like any other module.
import { FakeNetworkError, FRAMEBRIAR_ENDPOINT, type FakeFramebriar } from "./fake-framebriar";

export interface RoutedRequest {
  url(): string;
  method(): string;
  allHeaders(): Promise<Record<string, string>>;
  postDataBuffer(): Buffer | null;
}
export interface RouteLike {
  request(): RoutedRequest;
  fulfill(response: {
    status: number;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<void>;
  abort(reason?: string): Promise<void>;
}
export interface Routable {
  route(url: string, handler: (route: RouteLike) => Promise<void>): Promise<void>;
}

/** Everything the SDK sends goes to this one pinned address; the browser never reaches the real service. */
export async function routeFramebriar(target: Routable, fake: FakeFramebriar): Promise<void> {
  await target.route(`${new URL(FRAMEBRIAR_ENDPOINT).origin}/**`, async (route) => {
    const source = route.request();
    const method = source.method();
    const body = source.postDataBuffer();
    const request = new Request(source.url(), {
      method,
      headers: await source.allHeaders(),
      ...(body && method !== "GET" && method !== "HEAD" ? { body: new Uint8Array(body) } : {}),
    });
    try {
      const response = await fake.handle(request);
      await route.fulfill({
        status: response.status,
        headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()),
      });
    } catch (error) {
      if (error instanceof FakeNetworkError) await route.abort("failed");
      else throw error;
    }
  });
}
