// The report proxy's input checks (#259). A reviewed report arrives as multipart/form-data with exactly two possible parts: `report`
// (JSON) and `media` (a PNG). Everything is bounded while it is read, not after: a body larger than the cap is refused as soon as
// it grows past it. The report's own claims are checked against the PNG's real size and SHA-256, and against the fixed game, so the
// browser cannot choose a destination, a game or a build scope. Nothing here keeps a byte after it returns.

import { createHash } from "node:crypto";
import { GAME_ID } from "./framebriar-client";

/** The SDK's reviewed-PNG limit. Vercel's own request cap can be lower; the route says so and a Preview check proves it. */
export const MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const MAX_REPORT_BYTES = 256 * 1024;
/** Multipart framing and the two part headers. */
const FRAMING_BYTES = 4 * 1024;
export const MAX_BODY_BYTES = MAX_REPORT_BYTES + MAX_MEDIA_BYTES + FRAMING_BYTES;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type ReportRefusal = "TOO_LARGE" | "UNSUPPORTED_MEDIA_TYPE" | "INVALID_REQUEST";

export interface ParsedReport {
  /** The report JSON exactly as it will be forwarded. */
  report: string;
  id: string;
  media: Uint8Array | null;
}

/** Reads a request body, refusing as soon as it passes `max` bytes (a missing or lying Content-Length does not matter). */
export async function readBounded(
  request: Request,
  max: number,
): Promise<Uint8Array | "TOO_LARGE" | "INVALID_REQUEST"> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d{1,12}$/.test(declared)) return "INVALID_REQUEST";
    if (Number(declared) > max) return "TOO_LARGE";
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return "TOO_LARGE";
      }
      chunks.push(value);
    }
  } catch {
    return "INVALID_REQUEST";
  }
  return Buffer.concat(chunks);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function parseReportRequest(request: Request): Promise<ParsedReport | ReportRefusal> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data;\s*boundary=[^\s;]{1,200}\s*$/i.test(type))
    return "UNSUPPORTED_MEDIA_TYPE";
  const body = await readBounded(request, MAX_BODY_BYTES);
  if (typeof body === "string") return body;

  let form: FormData;
  try {
    form = await new Response(Buffer.from(body), { headers: { "content-type": type } }).formData();
  } catch {
    return "INVALID_REQUEST";
  }
  const names = [...form.keys()];
  if (names.some((name) => name !== "report" && name !== "media")) return "INVALID_REQUEST";
  if (form.getAll("report").length !== 1 || form.getAll("media").length > 1)
    return "INVALID_REQUEST";

  const reportPart = form.get("report");
  if (!(reportPart instanceof File) || reportPart.type !== "application/json")
    return "INVALID_REQUEST";
  if (reportPart.size > MAX_REPORT_BYTES) return "TOO_LARGE";
  const text = await reportPart.text();
  let report: unknown;
  try {
    report = JSON.parse(text);
  } catch {
    return "INVALID_REQUEST";
  }
  if (!isRecord(report)) return "INVALID_REQUEST";
  // Scope: the one game, the one protocol version, a real report id and a well-formed build id. Framebriar re-validates the rest.
  if (report.v !== 1 || report.gameId !== GAME_ID) return "INVALID_REQUEST";
  if (typeof report.id !== "string" || !UUID.test(report.id)) return "INVALID_REQUEST";
  if (
    report.buildSha !== null &&
    !(typeof report.buildSha === "string" && /^[a-f0-9]{7,40}$/.test(report.buildSha))
  )
    return "INVALID_REQUEST";

  const mediaPart = form.get("media");
  const declared = report.media;
  if (mediaPart === null) {
    return declared === null || declared === undefined
      ? { report: text, id: report.id, media: null }
      : "INVALID_REQUEST";
  }
  if (!(mediaPart instanceof File) || mediaPart.type !== "image/png")
    return "UNSUPPORTED_MEDIA_TYPE";
  if (mediaPart.size > MAX_MEDIA_BYTES) return "TOO_LARGE";
  if (!isRecord(declared) || declared.type !== "image/png") return "INVALID_REQUEST";
  const bytes = Buffer.from(await mediaPart.arrayBuffer());
  if (bytes.length === 0 || bytes.length < PNG_SIGNATURE.length) return "INVALID_REQUEST";
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "INVALID_REQUEST";
  if (declared.bytes !== bytes.length) return "INVALID_REQUEST";
  if (declared.sha256 !== createHash("sha256").update(bytes).digest("hex"))
    return "INVALID_REQUEST";
  return { report: text, id: report.id, media: bytes };
}
