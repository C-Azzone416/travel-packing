// Drawing on a screenshot (#266): the marks as plain data, and the pure steps that change them. Nothing here touches the DOM, a
// canvas or storage, so it is the same on a phone and a desktop. Every coordinate is in the screenshot's NATURAL pixels, so the
// marks mean the same thing at any preview size; the preview only converts a pointer position into one with `toNaturalPoint`.

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  left: number;
  top: number;
}

/** Four inks that stay apart on light and dark screens and for common colour blindness (red/yellow/blue/white; design may retune). */
export const INK_COLORS = [
  { id: "red", label: "Red", value: "#e5242b" },
  { id: "yellow", label: "Yellow", value: "#ffd60a" },
  { id: "blue", label: "Blue", value: "#1e6bff" },
  { id: "white", label: "White", value: "#ffffff" },
] as const;

export type InkColorId = (typeof INK_COLORS)[number]["id"];

export const DEFAULT_INK: InkColorId = "red";

export interface Stroke {
  color: InkColorId;
  /** The line width in natural pixels. */
  width: number;
  points: readonly Point[];
}

export interface Drawing {
  /** Finished strokes, oldest first. */
  strokes: readonly Stroke[];
  /** The stroke under the pointer right now, if any. */
  active: Stroke | null;
}

export const EMPTY_DRAWING: Drawing = { strokes: [], active: null };

/** Bounds, so a long scribble cannot grow without end: past them further input is ignored, not queued. */
export const MAX_STROKES = 100;
export const MAX_POINTS_PER_STROKE = 1500;
/** A point closer than this (natural pixels) to the last one adds nothing and is dropped. */
export const MIN_POINT_DISTANCE = 1.5;

const finite = (value: number) => Number.isFinite(value);

export function inkValue(id: InkColorId): string {
  return INK_COLORS.find((color) => color.id === id)?.value ?? INK_COLORS[0].value;
}

/** A line width that reads on this screenshot: about 0.6% of its shorter side, never thinner than 4 pixels. */
export function defaultStrokeWidth(natural: Size): number {
  const shorter = Math.min(natural.width, natural.height);
  return Math.max(4, Math.round(shorter * 0.006));
}

/**
 * Converts a pointer position (client coordinates) to a point in the screenshot's natural pixels. The preview shows the whole
 * picture scaled uniformly and centred in `rect` (like `object-fit: contain`), so any letterboxing is accounted for. The point is
 * clamped onto the picture; `inside` says whether the pointer was really over it. Null when either size is unusable.
 */
export function toNaturalPoint(
  client: Point,
  rect: Rect,
  natural: Size,
): { point: Point; inside: boolean } | null {
  const sizes = [rect.width, rect.height, natural.width, natural.height];
  if (!sizes.every((value) => finite(value) && value > 0)) return null;
  if (![client.x, client.y, rect.left, rect.top].every(finite)) return null;
  const scale = Math.min(rect.width / natural.width, rect.height / natural.height);
  const left = rect.left + (rect.width - natural.width * scale) / 2;
  const top = rect.top + (rect.height - natural.height * scale) / 2;
  const x = (client.x - left) / scale;
  const y = (client.y - top) / scale;
  const inside = x >= 0 && x <= natural.width && y >= 0 && y <= natural.height;
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);
  const tenth = (value: number) => Math.round(value * 10) / 10;
  return {
    point: { x: tenth(clamp(x, natural.width)), y: tenth(clamp(y, natural.height)) },
    inside,
  };
}

export const hasMarks = (drawing: Drawing): boolean =>
  drawing.strokes.length > 0 || drawing.active !== null;

/** Every stroke to draw, the one still being drawn included. */
export const allStrokes = (drawing: Drawing): readonly Stroke[] =>
  drawing.active ? [...drawing.strokes, drawing.active] : drawing.strokes;

export const strokeCount = (drawing: Drawing): number => allStrokes(drawing).length;

/** Starts a stroke at a point. A stroke still open is finished first. Ignored at the stroke limit or for a bad point. */
export function beginStroke(
  drawing: Drawing,
  ink: { color: InkColorId; width: number },
  point: Point,
): Drawing {
  if (!finite(point.x) || !finite(point.y) || !(ink.width > 0)) return drawing;
  const settled = endStroke(drawing);
  if (settled.strokes.length >= MAX_STROKES) return settled;
  return { ...settled, active: { color: ink.color, width: ink.width, points: [point] } };
}

/** Adds a point to the stroke under the pointer, unless it is a near-duplicate or the stroke is at its limit. */
export function extendStroke(drawing: Drawing, point: Point): Drawing {
  const { active } = drawing;
  if (!active || !finite(point.x) || !finite(point.y)) return drawing;
  if (active.points.length >= MAX_POINTS_PER_STROKE) return drawing;
  const last = active.points[active.points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) return drawing;
  return { ...drawing, active: { ...active, points: [...active.points, point] } };
}

/** Lifts the pointer: the stroke under it (a single tap is a dot) becomes a finished stroke. */
export function endStroke(drawing: Drawing): Drawing {
  return drawing.active ? { strokes: [...drawing.strokes, drawing.active], active: null } : drawing;
}

/** The pointer was interrupted (cancelled gesture): the open stroke is dropped, not kept half-drawn. */
export function cancelStroke(drawing: Drawing): Drawing {
  return drawing.active ? { ...drawing, active: null } : drawing;
}

/** Undo: takes back the stroke being drawn, or else the last finished one. */
export function undo(drawing: Drawing): Drawing {
  if (drawing.active) return { ...drawing, active: null };
  return drawing.strokes.length > 0
    ? { ...drawing, strokes: drawing.strokes.slice(0, -1) }
    : drawing;
}

/** Clear drawing: every mark gone. */
export function clearDrawing(drawing: Drawing): Drawing {
  return hasMarks(drawing) ? EMPTY_DRAWING : drawing;
}
