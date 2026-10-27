// The fake Framebriar service as a small HTTP process, for the e2e run only (#260). The app's SERVER now holds the enrollment and talks to
// Framebriar itself (#259), so a browser-side route (the old `routeFramebriar`) can no longer stand in for the service: the e2e build's
// server is pointed at this process instead (E2E_FRAMEBRIAR_PORT, src/server/feedback/e2e-upstream.ts), and a spec steers it over the
// control endpoints below through tests/e2e/helpers/feedback.ts. It listens on loopback only, speaks the same wire contract as the real
// service through src/test/fake-framebriar.ts, holds synthetic data only, and logs nothing.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import {
  createFakeFramebriar,
  FakeNetworkError,
  type FakeFailure,
  type FakeFramebriar,
  type FakeRoute,
} from "../../../src/test/fake-framebriar";
import { portFrom } from "./ports";

const port = portFrom(process.env.E2E_FRAMEBRIAR_PORT, 0);
let fake: FakeFramebriar = createFakeFramebriar();
let enrollmentMs: number | undefined;

const fresh = () => {
  fake = createFakeFramebriar(enrollmentMs === undefined ? {} : { enrollmentMs });
};

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

const send = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

async function control(request: IncomingMessage, response: ServerResponse, path: string) {
  const raw = request.method === "POST" ? (await readBody(request)).toString("utf8") : "";
  const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  switch (path) {
    case "health":
      return send(response, 200, { ok: true });
    case "reset":
      enrollmentMs = undefined;
      fresh();
      return send(response, 200, { ok: true });
    case "invite":
      return send(response, 200, { invitation: fake.issueInvitation() });
    case "fail-next":
      fake.failNext(body.route as FakeRoute, body.failure as FakeFailure, Number(body.times ?? 1));
      return send(response, 200, { ok: true });
    case "revoke-all":
      fake.revokeAll();
      return send(response, 200, { ok: true });
    case "offline":
      fake.setOffline(body.offline === true);
      return send(response, 200, { ok: true });
    case "enrollment-ms":
      enrollmentMs = Number(body.ms);
      fake.setEnrollmentMs(enrollmentMs);
      return send(response, 200, { ok: true });
    case "counts":
      return send(response, 200, {
        redeem: fake.count("redeem"),
        refresh: fake.count("refresh"),
        disconnect: fake.count("disconnect"),
        report: fake.count("report"),
        media: fake.count("media"),
      });
    case "delivered":
      return send(
        response,
        200,
        fake.delivered().map(({ report, media }) => ({ report, mediaBytes: media?.bytes ?? null })),
      );
    default:
      return send(response, 404, { error: "unknown control route" });
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname.startsWith("/__control/")) {
    await control(request, response, url.pathname.slice("/__control/".length)).catch(() =>
      send(response, 500, { error: "control failed" }),
    );
    return;
  }
  const method = request.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(request);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  try {
    const answer = await fake.handle(
      new Request(`http://127.0.0.1:${port}${url.pathname}${url.search}`, {
        method,
        headers,
        ...(body ? { body: new Uint8Array(body) } : {}),
      }),
    );
    response.writeHead(answer.status, Object.fromEntries(answer.headers));
    response.end(Buffer.from(await answer.arrayBuffer()));
  } catch (error) {
    // A simulated outage: the connection just drops, like a real network failure.
    if (error instanceof FakeNetworkError) request.socket.destroy();
    else send(response, 500, { error: "fake failed" });
  }
});

server.listen(port, "127.0.0.1");
