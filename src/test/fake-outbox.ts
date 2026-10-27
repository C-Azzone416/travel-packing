// A controllable stand-in for the SDK's durable outbox, for the feedback component tests (#132, #260). It records the account key the
// provider named it with, so a test can see which account an outbox belongs to, and it lets a test push a status or a receipt.
import { act } from "@testing-library/react";
import { vi } from "vitest";
import type { DurableFeedback, OutboxStatus } from "@masra91/framebriar/browser/durable-feedback";
import type { CreateOutbox, OutboxArguments } from "@/features/feedback/FeedbackAccess";

export const OUTBOX_STATUS: OutboxStatus = {
  state: "available",
  items: 0,
  bytes: 0,
  maxItems: 10,
  maxBytes: 32 * 1024 * 1024,
  retention: "until-delivered-or-cleared",
};

type Enqueue = DurableFeedback["enqueue"];

export function createFakeOutbox(enqueue?: Enqueue) {
  let listener: ((status: OutboxStatus) => void) | undefined;
  let onReceipt: ((receipt: { id: string }) => void) | undefined;
  const created: OutboxArguments[] = [];
  const box = {
    status: () => OUTBOX_STATUS,
    subscribe: vi.fn((fn: (status: OutboxStatus) => void) => {
      listener = fn;
      return () => {
        listener = undefined;
      };
    }),
    enqueue: vi.fn<Enqueue>(
      enqueue ??
        (async ({ report }) => ({
          id: report.id,
          gameId: "travel-packing",
          status: "saved-local" as const,
          sent: false as const,
        })),
    ),
    start: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    stop: vi.fn(),
    clear: vi.fn(async () => OUTBOX_STATUS),
  };
  const create: CreateOutbox = vi.fn(async (options: OutboxArguments) => {
    created.push(options);
    onReceipt = options.onReceipt;
    return box as unknown as DurableFeedback;
  });
  return {
    box,
    create,
    created,
    status: (next: Partial<OutboxStatus>) => act(() => listener?.({ ...OUTBOX_STATUS, ...next })),
    receive: (id: string) => act(() => onReceipt?.({ id })),
  };
}

export type FakeOutbox = ReturnType<typeof createFakeOutbox>;
