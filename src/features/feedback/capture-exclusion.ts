// What a screenshot may never contain (#273). The picture is made by cloning the page's DOM and rasterising the clone, so the only
// safe place to keep something out is BEFORE the clone: a node the filter below rejects is never cloned (nor its children), and its
// value is never read, so it cannot exist in any PNG, preview, annotation, outbox entry or upload. Nothing here hides pixels that
// were already captured (no blur, overlay or opacity), and nothing keeps a copy of the unsanitised page.
//
// The contract for the rest of the app:
// - `data-feedback-exclude` on an element keeps that element and everything inside it out of every screenshot.
// - Every `input[type=password]` is out, whatever else is or is not marked.
// - `data-feedback-sensitive-portal` on something that exists only while a sensitive dialog or popover is open means "do not
//   capture at all while this is open": the capture returns null and the sheet falls back to text only.
// - A screen that shows an account identity says so (`data-feedback-identity` on its region); if that region has no exclusion
//   marker, the capture cannot prove the identity is out and returns null.
// This module is only imported by screenshot-capture.ts, which Production builds replace with a stub, so none of it reaches
// Production (capture-exclusion.test.ts fails if anything else imports it). The attribute NAMES below are plain strings that the
// ordinary screens carry in every build; they do nothing without this module.

export const EXCLUDE_ATTRIBUTE = "data-feedback-exclude";
export const SENSITIVE_PORTAL_ATTRIBUTE = "data-feedback-sensitive-portal";
/** On the region of a screen that shows who is signed in: it must contain an element carrying `account-identity` below. */
export const IDENTITY_REGION_ATTRIBUTE = "data-feedback-identity";
export const IDENTITY_EXCLUDE_VALUE = "account-identity";

const isElement = (node: Node): node is Element => node.nodeType === 1;

function isPasswordInput(element: Element): boolean {
  if (element.localName !== "input") return false;
  // Both the live property and the attribute: a type set either way, in any case, is a password.
  const live = (element as HTMLInputElement).type;
  const written = element.getAttribute("type");
  return [live, written].some((type) => type?.trim().toLowerCase() === "password");
}

/**
 * The capture's `filter`: false means "leave this node out" and is asked before the library clones it, copies its value or reads
 * its children. Text, comments and anything that is not an element are never sensitive on their own (their parent is).
 */
export function includeInCapture(node: Node): boolean {
  if (!isElement(node)) return true;
  if (node.hasAttribute(EXCLUDE_ATTRIBUTE)) return false;
  if (node.hasAttribute(SENSITIVE_PORTAL_ATTRIBUTE)) return false;
  return !isPasswordInput(node);
}

export type CaptureReadiness =
  { ok: true } | { ok: false; reason: "sensitive-surface-open" | "unproven-exclusion" };

/**
 * Whether the page is in a state where a screenshot can be proven clean. Fails closed: a marked sensitive portal that is open, or
 * an identity region whose exclusion marker is missing, means no picture at all (the report goes as text only).
 */
export function captureReadiness(doc: Document): CaptureReadiness {
  if (doc.querySelector(`[${SENSITIVE_PORTAL_ATTRIBUTE}]`)) {
    return { ok: false, reason: "sensitive-surface-open" };
  }
  for (const region of doc.querySelectorAll(`[${IDENTITY_REGION_ATTRIBUTE}]`)) {
    const proven =
      region.getAttribute(EXCLUDE_ATTRIBUTE) === IDENTITY_EXCLUDE_VALUE ||
      region.querySelector(`[${EXCLUDE_ATTRIBUTE}="${IDENTITY_EXCLUDE_VALUE}"]`) !== null;
    if (!proven) return { ok: false, reason: "unproven-exclusion" };
  }
  return { ok: true };
}
