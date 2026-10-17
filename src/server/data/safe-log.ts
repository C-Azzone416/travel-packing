// Data-layer logging: a closed set of event codes and nothing else, so trip dates, destinations, item names,
// and database error text cannot reach the logs by construction.

import type { ErrorCode } from "./result";

export type DataEvent = `error:${ErrorCode}` | "ensure-user" | "ensure-default-staples";
export type DataLogSink = (line: string) => void;

const defaultSink: DataLogSink = (line) => console.info(line);
let sink: DataLogSink = defaultSink;

/** Test hook: capture log lines. Call with no argument to restore the default. */
export function setDataLogSink(next?: DataLogSink): void {
  sink = next ?? defaultSink;
}

export function logDataEvent(event: DataEvent): void {
  sink(JSON.stringify({ scope: "data", event }));
}
