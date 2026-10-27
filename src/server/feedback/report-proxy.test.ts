import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_BODY_BYTES, parseReportRequest, readBounded } from "./report-proxy";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("data"),
]);
const report = (extra: Record<string, unknown> = {}) => ({
  v: 1,
  id: randomUUID(),
  gameId: "travel-packing",
  buildSha: null,
  media: null,
  ...extra,
});
const withMedia = (extra: Record<string, unknown> = {}) =>
  report({
    media: {
      type: "image/png",
      bytes: PNG.length,
      sha256: createHash("sha256").update(PNG).digest("hex"),
    },
    ...extra,
  });
const request = (form: FormData) => new Request("https://x.test/r", { method: "POST", body: form });
const file = (content: string | Uint8Array, name: string, type: string) =>
  new File([content as BlobPart], name, { type });

describe("readBounded", () => {
  it("returns an empty body for a request without one", async () => {
    expect(await readBounded(new Request("https://x.test/", { method: "POST" }), 10)).toEqual(
      new Uint8Array(),
    );
  });

  it("refuses a declared length over the cap or malformed, without reading", async () => {
    const huge = new Request("https://x.test/", {
      method: "POST",
      headers: { "content-length": "100" },
      body: "x",
    });
    expect(await readBounded(huge, 10)).toBe("TOO_LARGE");
    const odd = new Request("https://x.test/", {
      method: "POST",
      headers: { "content-length": "1e9" },
      body: "x",
    });
    expect(await readBounded(odd, 10)).toBe("INVALID_REQUEST");
  });

  it("counts the stream when no length is declared, and when it is read in pieces", async () => {
    const stream = (chunks: string[]) =>
      new Request("https://x.test/", {
        method: "POST",
        body: new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit);
    expect(
      Buffer.from((await readBounded(stream(["ab", "cd"]), 10)) as Uint8Array).toString(),
    ).toBe("abcd");
    expect(await readBounded(stream(["abcdef", "ghijkl"]), 10)).toBe("TOO_LARGE");
  });

  it("is invalid when the stream breaks", async () => {
    const broken = new Request("https://x.test/", {
      method: "POST",
      body: new ReadableStream({
        pull() {
          throw new Error("broken");
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(await readBounded(broken, 10)).toBe("INVALID_REQUEST");
  });
});

describe("parseReportRequest", () => {
  it("accepts a text report", async () => {
    const form = new FormData();
    const body = report();
    form.set("report", file(JSON.stringify(body), "r.json", "application/json"));
    expect(await parseReportRequest(request(form))).toEqual({
      report: JSON.stringify(body),
      id: body.id,
      media: null,
    });
  });

  it("accepts a report with a matching PNG, keeping the exact bytes", async () => {
    const form = new FormData();
    const body = withMedia({ buildSha: "abcdef1" });
    form.set("report", file(JSON.stringify(body), "r.json", "application/json"));
    form.set("media", file(PNG, "s.png", "image/png"));
    const parsed = await parseReportRequest(request(form));
    expect(typeof parsed).toBe("object");
    expect(Buffer.from((parsed as { media: Uint8Array }).media).equals(PNG)).toBe(true);
  });

  it("is unsupported when it is not multipart", async () => {
    expect(
      await parseReportRequest(new Request("https://x.test/", { method: "POST", body: "{}" })),
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
    expect(
      await parseReportRequest(
        new Request("https://x.test/", {
          method: "POST",
          headers: { "content-type": "multipart/form-data" },
          body: "x",
        }),
      ),
    ).toBe("UNSUPPORTED_MEDIA_TYPE");
  });

  it("is invalid when the multipart body does not parse", async () => {
    const bad = new Request("https://x.test/", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=zzz" },
      body: "this is not multipart",
    });
    expect(await parseReportRequest(bad)).toBe("INVALID_REQUEST");
  });

  it.each([
    ["no report", (form: FormData) => form.set("media", file(PNG, "s.png", "image/png"))],
    [
      "a report that is a plain field",
      (form: FormData) => form.set("report", JSON.stringify(report())),
    ],
    [
      "a report that is not JSON text",
      (form: FormData) => form.set("report", file("{", "r.json", "application/json")),
    ],
    [
      "a report that is an array",
      (form: FormData) => form.set("report", file("[]", "r.json", "application/json")),
    ],
    [
      "two reports",
      (form: FormData) => {
        form.append("report", file(JSON.stringify(report()), "a.json", "application/json"));
        form.append("report", file(JSON.stringify(report()), "b.json", "application/json"));
      },
    ],
    [
      "two screenshots",
      (form: FormData) => {
        form.set("report", file(JSON.stringify(withMedia()), "r.json", "application/json"));
        form.append("media", file(PNG, "a.png", "image/png"));
        form.append("media", file(PNG, "b.png", "image/png"));
      },
    ],
    [
      "a screenshot of the wrong size",
      (form: FormData) => {
        form.set(
          "report",
          file(
            JSON.stringify(
              withMedia({
                media: {
                  type: "image/png",
                  bytes: 3,
                  sha256: createHash("sha256").update(PNG).digest("hex"),
                },
              }),
            ),
            "r.json",
            "application/json",
          ),
        );
        form.set("media", file(PNG, "s.png", "image/png"));
      },
    ],
    [
      "a screenshot without a declared media block",
      (form: FormData) => {
        form.set(
          "report",
          file(
            JSON.stringify(report({ media: { type: "image/jpeg" } })),
            "r.json",
            "application/json",
          ),
        );
        form.set("media", file(PNG, "s.png", "image/png"));
      },
    ],
    [
      "a screenshot too small to be a PNG",
      (form: FormData) => {
        const tiny = Buffer.from([0x89, 0x50]);
        form.set(
          "report",
          file(
            JSON.stringify(
              report({
                media: {
                  type: "image/png",
                  bytes: 2,
                  sha256: createHash("sha256").update(tiny).digest("hex"),
                },
              }),
            ),
            "r.json",
            "application/json",
          ),
        );
        form.set("media", file(tiny, "s.png", "image/png"));
      },
    ],
    [
      "an unknown field",
      (form: FormData) => {
        form.set("report", file(JSON.stringify(report()), "r.json", "application/json"));
        form.set("destination", "https://evil.example");
      },
    ],
  ])("is invalid with %s", async (_name, build) => {
    const form = new FormData();
    build(form);
    expect(await parseReportRequest(request(form))).toBe("INVALID_REQUEST");
  });

  it("is too large when either part is over its own cap, even inside the body cap", async () => {
    const form = new FormData();
    form.set("report", file("x".repeat(300_000), "r.json", "application/json"));
    expect(await parseReportRequest(request(form))).toBe("TOO_LARGE");
    expect(MAX_BODY_BYTES).toBeGreaterThan(8 * 1024 * 1024);
  });

  it("is unsupported for a screenshot that is not declared image/png", async () => {
    const form = new FormData();
    form.set("report", file(JSON.stringify(withMedia()), "r.json", "application/json"));
    form.set("media", file(PNG, "s.jpg", "image/jpeg"));
    expect(await parseReportRequest(request(form))).toBe("UNSUPPORTED_MEDIA_TYPE");
  });
});
