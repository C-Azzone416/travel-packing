// The versioned key ring that seals server-held Framebriar credentials (#259). Server-only; nothing here is imported by the
// browser, and nothing here returns, logs or throws a key, a credential or the environment value.
//
// FRAMEBRIAR_CREDENTIAL_KEYS is JSON: { "current": "k2", "keys": { "k1": "<base64 of 32 bytes>", "k2": "<base64 of 32 bytes>" } }.
// Every version in `keys` can OPEN; only `current` SEALS. After a rotation a row sealed under an older version is opened with
// that version and written back under the current one the next time it is used (see enrollment-service.ts).
// AES-256-GCM, a fresh 96-bit nonce per seal, and the owner, account generation and key version bound as additional
// authenticated data, so a ciphertext copied to another account or another key version does not open.
// A missing, malformed or wrong-sized ring is "unavailable": parse returns null and enrollment fails closed. The caller never
// learns why, so a bad value cannot leak through an error.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Doubles as the first element of every seal's additional authenticated data, so the string is in any build that can seal a
 * credential (it cannot be tree-shaken away) and a Production build check can look for it.
 */
export const FRAMEBRIAR_SERVER_MARKER = "framebriar-enrollment-server";

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const MAX_KEYS = 8;
const VERSION = /^[A-Za-z0-9_-]{1,16}$/;
const FORMAT = "v1";

export interface KeyRing {
  readonly current: string;
  readonly keys: ReadonlyMap<string, Buffer>;
}

/** What a sealed value is bound to: the account (owner and generation) it belongs to. */
export interface SealContext {
  ownerId: string;
  generation: string;
}

function decodeKey(value: unknown): Buffer | null {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const bytes = Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return bytes.length === KEY_BYTES ? bytes : null;
}

/** The ring from the environment value, or null when it is missing or invalid in any way. Never throws. */
export function parseKeyRing(raw: string | undefined): KeyRing | null {
  if (raw === undefined || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const names = Object.keys(record);
  if (names.length !== 2 || !names.includes("current") || !names.includes("keys")) return null;
  const { current, keys } = record;
  if (typeof current !== "string" || !VERSION.test(current)) return null;
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return null;
  const entries = Object.entries(keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_KEYS) return null;
  const decoded = new Map<string, Buffer>();
  for (const [version, value] of entries) {
    const key = decodeKey(value);
    if (!VERSION.test(version) || !key) return null;
    decoded.set(version, key);
  }
  return decoded.has(current) ? { current, keys: decoded } : null;
}

function aad(context: SealContext, keyVersion: string): Buffer {
  return Buffer.from(
    JSON.stringify([
      FRAMEBRIAR_SERVER_MARKER,
      FORMAT,
      context.ownerId,
      context.generation,
      keyVersion,
    ]),
    "utf8",
  );
}

/** Seals `plaintext` under the ring's current key. */
export function seal(
  ring: KeyRing,
  context: SealContext,
  plaintext: string,
): { keyVersion: string; sealed: string } {
  const key = ring.keys.get(ring.current) as Buffer;
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(context, ring.current));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const sealed = `${FORMAT}.${Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64url")}`;
  return { keyVersion: ring.current, sealed };
}

/** Opens a sealed value, or returns null for anything that does not authenticate (wrong key, version, owner, generation, tampering). */
export function open(
  ring: KeyRing,
  context: SealContext,
  keyVersion: string,
  sealed: string,
): string | null {
  const key = ring.keys.get(keyVersion);
  if (!key || !sealed.startsWith(`${FORMAT}.`)) return null;
  try {
    const bytes = Buffer.from(sealed.slice(FORMAT.length + 1), "base64url");
    if (bytes.length < NONCE_BYTES + TAG_BYTES) return null;
    const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, NONCE_BYTES));
    decipher.setAAD(aad(context, keyVersion));
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES));
    return Buffer.concat([
      decipher.update(bytes.subarray(NONCE_BYTES, bytes.length - TAG_BYTES)),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
