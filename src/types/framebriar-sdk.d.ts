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
