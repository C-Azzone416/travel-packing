// Closed, content-free diagnostics for the server-to-Framebriar delivery boundary.
// Keep this schema deliberately small: report contents, identifiers, credentials,
// request metadata and raw errors must never enter this logger.

export type FeedbackUpstreamPhase = "metadata" | "media";
export type FeedbackUpstreamOutcome =
  "ok" | "refused" | "timeout" | "network" | "upstream" | "invalid-response";

export interface FeedbackUpstreamDiagnostic {
  phase: FeedbackUpstreamPhase;
  outcome: FeedbackUpstreamOutcome;
  elapsedMs: number;
  status?: number;
}

export type FeedbackLogSink = (line: string) => void;

const defaultSink: FeedbackLogSink = (line) => console.info(line);
const PHASES = new Set<unknown>(["metadata", "media"] satisfies FeedbackUpstreamPhase[]);
const OUTCOMES = new Set<unknown>([
  "ok",
  "refused",
  "timeout",
  "network",
  "upstream",
  "invalid-response",
] satisfies FeedbackUpstreamOutcome[]);

const boundedElapsed = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(60_000, Math.round(value))) : 0;

const boundedStatus = (value: number | undefined): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 599
    ? value
    : undefined;

export function logFeedbackUpstream(
  diagnostic: FeedbackUpstreamDiagnostic,
  sink: FeedbackLogSink = defaultSink,
): void {
  try {
    if (!PHASES.has(diagnostic.phase) || !OUTCOMES.has(diagnostic.outcome)) return;
    const status = boundedStatus(diagnostic.status);
    sink(
      JSON.stringify({
        scope: "feedback",
        event: "framebriar_upstream",
        phase: diagnostic.phase,
        outcome: diagnostic.outcome,
        elapsedMs: boundedElapsed(diagnostic.elapsedMs),
        ...(status === undefined ? {} : { status }),
      }),
    );
  } catch {
    // Diagnostics are best-effort and must never change delivery or retry behavior.
  }
}
