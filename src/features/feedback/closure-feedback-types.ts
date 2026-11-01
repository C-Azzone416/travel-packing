import type { ReactNode } from "react";

// What Close account needs from feedback (#261). Types only, with no copy: hosted builds replace the feedback modules with an inert stub
// (feedback.disabled.tsx), and the Close account sheet must compile against both.

/** What Continue hands to the confirmation step. */
export interface ClosureContinue {
  /** The access could not be ended (only this app's copy was erased); it stops on its own at Framebriar's deadline. */
  unrevocable: boolean;
  /** That deadline, when the status showed it before disconnecting. */
  deadline: string | null;
}

export interface ClosureFeedback {
  /** Whether feedback must be disconnected first: "checking" until the server has answered, then "required" or "none". */
  needs: "checking" | "required" | "none";
  /** Unsent reports on this device (waiting plus blocked). */
  unsent: number;
  /** Remember this account's outbox as the one being closed (cleared at confirmed closure only). */
  rememberOutbox(): void;
  /** The attempt did not end in closure: forget it. */
  forgetOutbox(): void;
  /** Ask the server again what this account holds. */
  refresh(): Promise<void>;
  /** The lines the confirmation step adds: the leftover-access note after an unrevocable disconnect, and the unsent note when step 1 was skipped. */
  notes(carried: ClosureContinue | null, hadStepOne: boolean): ReactNode;
  /** The Disconnect step's content and footer, ready for the sheet. */
  step: { title: string; description: string; body: ReactNode; actions: ReactNode; busy: boolean };
}

export const NO_CLOSURE_FEEDBACK: ClosureFeedback = {
  needs: "none",
  unsent: 0,
  rememberOutbox: () => undefined,
  forgetOutbox: () => undefined,
  refresh: async () => undefined,
  notes: () => null,
  step: { title: "", description: "", body: null, actions: null, busy: false },
};
