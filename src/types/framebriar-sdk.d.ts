// Types for the parts of the private @masra91/framebriar SDK (pinned in package.json) that this repo uses. The package
// ships plain .mjs without declarations; keep these to the real signatures (docs/general-feedback-v2.md in that repo).

declare module "@masra91/framebriar/protocol" {
  export const LIMITS: Readonly<{
    media: number;
    json: number;
    notes: number;
    queueItems: number;
    queueBytes: number;
  }>;
  export interface NormalizedReport {
    v: 1;
    id: string;
    gameId: string;
    buildSha: string | null;
    scene: string;
    sessionId: string;
    seed: string | null;
    platform: string;
    input: string;
    capturedAt: string;
    notes: string;
    breadcrumbs: { kind: string; atMs: number; code: string; value?: number }[];
    media: { type: string; bytes: number; sha256: string } | null;
    [key: string]: unknown;
  }
  export function normalizeReport(report: unknown): NormalizedReport;
  export function redact(value: unknown, max?: number): string;
  export class Fault extends Error {
    status: number;
  }
}

declare module "@masra91/framebriar/browser/feedback-runtime" {
  export const FEEDBACK_ENDPOINT: string;
}

declare module "@masra91/framebriar/browser/playtest-access" {
  export interface AccessStatus {
    state: string;
    connected: boolean;
    enrolled: boolean;
    canCapture: boolean;
    notice: "expired" | "access-required" | "connection-uncertain" | "migration-required" | null;
    expiresAt: string | null;
  }
  export interface EnrollmentStore {
    read(): Promise<{
      revision: number;
      session: { refreshToken: string; expiresAt: string } | null;
      notice?: { state: string; expiresAt: string | null; enrolled: boolean };
    }>;
    write(session: { refreshToken: string; expiresAt: string }, revision: number): Promise<boolean>;
    reset(options?: {
      expectedRevision?: number;
      notice?: { state: string; expiresAt?: string | null; enrolled?: boolean };
    }): Promise<number | null>;
    subscribe(listener: (revision: number) => void): () => void;
    close(): void;
  }
  export interface PlaytestAccess {
    readonly endpoint: string;
    status(): AccessStatus;
    subscribe(listener: (status: AccessStatus) => void): () => void;
    start(): Promise<AccessStatus>;
    stop(): void;
    connect(invitation: string): Promise<boolean>;
    getToken(): Promise<string | undefined>;
    disconnect(): Promise<{ forgotten: boolean; revoked: boolean | null }>;
    dispose(): void;
  }
  export function createPlaytestAccess(options: {
    gameId: string;
    buildSha?: string | null;
    endpoint?: string;
    origin?: string;
    store?: EnrollmentStore;
    fetchImpl?: typeof fetch;
    now?: () => number;
    setTimer?: typeof setTimeout;
    clearTimer?: typeof clearTimeout;
    events?: Pick<Window, "addEventListener" | "removeEventListener"> | null;
    retryDelay?: (ms: number) => Promise<void>;
    accessTimeoutMs?: number;
    onChange?: (status: AccessStatus) => void;
  }): PlaytestAccess;
}

declare module "@masra91/framebriar/browser/submit-feedback" {
  export class FeedbackSubmitError extends Error {
    constructor(code: string, message: string);
    code: string;
    retryAfterMs?: number;
  }
  export function sendPreparedFeedback(options: {
    report: unknown;
    media: Blob | null;
    endpoint: string;
    getToken: () => Promise<string | undefined>;
    onProgress?: (progress: { phase: string; reportId: string }) => void;
    signal?: AbortSignal;
  }): Promise<{ id: string; status: string; gameId: string }>;
}

declare module "@masra91/framebriar/browser/local-export" {
  import type { NormalizedReport } from "@masra91/framebriar/protocol";
  export interface PreparedFeedback {
    report: NormalizedReport;
    media: Blob | null;
    metadata: Blob;
    filenames: { media: string | null; metadata: string };
  }
  export function prepareLocalFeedback(options: {
    blob: Blob | null;
    captureContext: Record<string, unknown>;
    notes?: string;
  }): Promise<PreparedFeedback>;
}

declare module "@masra91/framebriar/browser/queue" {
  import type { NormalizedReport } from "@masra91/framebriar/protocol";
  /** The SDK's IndexedDB-backed report queue. The database is named `framebriar-v1-<scope>`. */
  export class OfflineQueue {
    constructor(
      scope: string,
      options?: { now?: () => number; indexedDB?: IDBFactory; timeoutMs?: number },
    );
    readonly name: string;
    all(): Promise<{ report: NormalizedReport; blob: Blob | null }[]>;
    clear(): Promise<unknown>;
  }
}

declare module "@masra91/framebriar/browser/durable-feedback" {
  import type { NormalizedReport } from "@masra91/framebriar/protocol";
  export interface OutboxStatus {
    state: string;
    items: number;
    bytes: number;
    maxItems: number;
    maxBytes: number;
    blocked?: number;
    retention: "until-delivered-or-cleared";
    migration?: unknown;
  }
  export interface DurableFeedback {
    status(): OutboxStatus;
    subscribe(listener: (status: OutboxStatus) => void): () => void;
    enqueue(options: {
      report: NormalizedReport;
      media: Blob | null;
      signal?: AbortSignal;
      includeDiagnostics?: boolean;
    }): Promise<{ id: string; gameId: string; status: "saved-local"; sent: false }>;
    start(): Promise<void>;
    resume(): Promise<void>;
    stop(): void;
    clear(): Promise<OutboxStatus>;
  }
  export function createDurableFeedback(options: {
    gameId: string;
    buildSha?: string | null;
    endpoint: string;
    getToken: () => Promise<string | undefined>;
    onReceipt?: (receipt: { id: string; gameId: string; status: string }) => void;
    onChange?: (status: OutboxStatus) => void;
    /** Injected so the outbox lives in one database per account (#260). Without it the SDK names the database from the endpoint. */
    queue?: import("@masra91/framebriar/browser/queue").OfflineQueue;
    /** Injected so reports go through the app's own authenticated route instead of the SDK's HTTPS + Bearer transport (#260). */
    send?: (options: {
      report: NormalizedReport;
      media: Blob | null;
      endpoint: string;
      getToken: () => Promise<string | undefined>;
      signal?: AbortSignal;
    }) => Promise<{ id: string; status: string; gameId: string }>;
  }): DurableFeedback;
}

declare module "html-to-image" {
  export function toBlob(
    node: HTMLElement,
    options?: Record<string, unknown>,
  ): Promise<Blob | null>;
}
