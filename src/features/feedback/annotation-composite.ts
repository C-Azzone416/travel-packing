// Puts the reviewed marks onto the reviewed screenshot (#266), at Send and nowhere else. The result is a new PNG at the picture's
// own natural size: never scaled down, cropped or re-encoded smaller to fit a limit (the size check is the caller's, see
// annotation-final.ts). Canvas and image decoding are passed in so this is testable without a browser and has no hidden state.
import { inkValue, type Size, type Stroke } from "./annotation-model";

/** A pixel budget past which a canvas cannot be relied on to exist; such a picture is reported as failed, never resized. */
export const MAX_COMPOSITE_PIXELS = 40_000_000;
export const MAX_COMPOSITE_SIDE = 16_384;

export interface DrawingSurface {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void;
  arc(x: number, y: number, radius: number, start: number, end: number): void;
  stroke(): void;
  fill(): void;
  drawImage(image: unknown, x: number, y: number): void;
  lineCap: string;
  lineJoin: string;
  lineWidth: number;
  strokeStyle: string;
  fillStyle: string;
}

export interface CompositeCanvas {
  context(): DrawingSurface | null;
  toPng(): Promise<Blob | null>;
}

export interface DecodedImage extends Size {
  image: unknown;
  close(): void;
}

export interface CompositeDeps {
  decode(blob: Blob): Promise<DecodedImage | null>;
  createCanvas(width: number, height: number): CompositeCanvas | null;
}

export type CompositeResult = { kind: "ok"; blob: Blob } | { kind: "failed" };

function drawStroke(surface: DrawingSurface, stroke: Stroke) {
  const color = inkValue(stroke.color);
  const [first, ...rest] = stroke.points;
  if (!first) return;
  surface.save();
  surface.strokeStyle = color;
  surface.fillStyle = color;
  surface.lineWidth = stroke.width;
  surface.lineCap = "round";
  surface.lineJoin = "round";
  if (rest.length === 0) {
    // A tap is a dot as wide as the line.
    surface.beginPath();
    surface.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2);
    surface.fill();
  } else {
    // Curve through the midpoints, so a quick stroke is smooth rather than a polyline of straight pieces.
    surface.beginPath();
    surface.moveTo(first.x, first.y);
    for (let index = 0; index < rest.length - 1; index += 1) {
      const point = rest[index];
      const next = rest[index + 1];
      surface.quadraticCurveTo(point.x, point.y, (point.x + next.x) / 2, (point.y + next.y) / 2);
    }
    const last = rest[rest.length - 1];
    surface.lineTo(last.x, last.y);
    surface.stroke();
  }
  surface.restore();
}

/** The reviewed screenshot with the strokes drawn on it, as a PNG at the picture's natural size. */
export async function compositeMarks(
  source: Blob,
  strokes: readonly Stroke[],
  deps: CompositeDeps = browserCompositeDeps,
): Promise<CompositeResult> {
  let decoded: DecodedImage | null = null;
  try {
    decoded = await deps.decode(source);
    if (!decoded) return { kind: "failed" };
    const { width, height } = decoded;
    const sane =
      Number.isInteger(width) &&
      Number.isInteger(height) &&
      width > 0 &&
      height > 0 &&
      width <= MAX_COMPOSITE_SIDE &&
      height <= MAX_COMPOSITE_SIDE &&
      width * height <= MAX_COMPOSITE_PIXELS;
    if (!sane) return { kind: "failed" };
    const canvas = deps.createCanvas(width, height);
    const surface = canvas?.context();
    if (!canvas || !surface) return { kind: "failed" };
    surface.drawImage(decoded.image, 0, 0);
    for (const stroke of strokes) drawStroke(surface, stroke);
    const blob = await canvas.toPng();
    return blob && blob.size > 0 ? { kind: "ok", blob } : { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    decoded?.close();
  }
}

/** The browser's own decoding and canvas. Reached only in the real sheet; tests pass their own. */
export const browserCompositeDeps: CompositeDeps = {
  async decode(blob) {
    const bitmap = await createImageBitmap(blob);
    return {
      image: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close(),
    };
  },
  createCanvas(width, height) {
    const element = document.createElement("canvas");
    element.width = width;
    element.height = height;
    return {
      context: () => element.getContext("2d") as unknown as DrawingSurface | null,
      toPng: () => new Promise((resolve) => element.toBlob(resolve, "image/png")),
    };
  },
};
