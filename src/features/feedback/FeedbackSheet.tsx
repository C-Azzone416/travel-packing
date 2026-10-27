"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { feedbackBuildSha } from "./build-sha";
import { reportContext } from "./capture-policy";
import { useFeedbackAccess } from "./FeedbackAccess";
import { SCREENSHOT_SEND_LIMIT_BYTES, fitsSendLimit } from "./screenshot-limit";

export const NOTES_MAX = 2000;
const COUNTER_FROM = 1800;

/** The screenshot taken before the sheet opened (so the sheet is not in it). Null: this build has no screenshot option. */
export interface TakenScreenshot {
  blob: Blob | null;
}

export { SCREENSHOT_SEND_LIMIT_BYTES };

type Problem = "full" | "unavailable" | "uncertain" | null;

// Exact strings from design's #129 section 4. Apostrophes are typographic, like the rest of the app.
export const COPY = {
  title: "Send feedback",
  description: "Tell the developer what happened. Nothing is sent until you press Send.",
  notesLabel: "What happened?",
  notesHelp: "Please don’t include passwords, codes or personal details.",
  screenshotLabel: "Include a screenshot of this screen",
  screenshotNote: "It shows what’s on screen right now, including trip names and places.",
  screenshotFailed: "Couldn’t capture the screen. You can still send your notes.",
  screenshotTooLarge:
    "The screenshot is too large to send from here, so it isn’t included. Your notes still send.",
  thumbnailAlt: "Screenshot of the screen you were on",
  alsoSent: "Also sent: the app version and the name of the screen you were on.",
  offline: "You’re offline. It will be saved here and sent when you’re back online.",
  needNote: "Write a note to send.",
  saved: "Saved on this device",
  savedText: "It will send as soon as you’re online. You can close this.",
  received: "Received. Thank you.",
  receivedText: "The developer has your feedback.",
  receivedToast: "Your feedback was received. Thank you.",
  full: "Feedback is full: 10 reports are waiting to send from this device. Connect to the internet so they can send, then try again.",
  unavailable:
    "We couldn’t save this on your device. Storage is full or unavailable, so nothing was saved. Free up space and press Send again.",
  uncertain: "We couldn’t confirm it was saved. Press Send again. It won’t be duplicated.",
  // Some browsers (and private windows) cannot keep a picture on the device even when they can keep text.
  tryWithoutScreenshot:
    "If it keeps failing, untick the screenshot and press Send again. Your notes are kept.",
} as const;

const PROBLEM_TEXT: Record<Exclude<Problem, null>, string> = {
  full: COPY.full,
  unavailable: COPY.unavailable,
  uncertain: COPY.uncertain,
};

function subscribeOnline(notify: () => void): () => void {
  window.addEventListener("online", notify);
  window.addEventListener("offline", notify);
  return () => {
    window.removeEventListener("online", notify);
    window.removeEventListener("offline", notify);
  };
}

function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export interface FeedbackSheetProps {
  /** The route the person is on; only an approved code for it is ever put in the report. */
  pathname: string;
  screenshot: TakenScreenshot | null;
  /** The service has confirmed this report. */
  receivedId: string | null;
  onSaved: (id: string) => void;
  onClose: () => void;
}

// The review sheet (#132, design's #129 section 4). Send commits to this device first ("Saved on this device"); delivery is
// a separate, later step ("Received"). Everything that ends up in the report is shown here or listed under "Also sent".
export function FeedbackSheet({
  pathname,
  screenshot,
  receivedId,
  onSaved,
  onClose,
}: FeedbackSheetProps) {
  const { prepareReport, saveReport } = useFeedbackAccess();
  const online = useOnline();
  const [notes, setNotes] = useState("");
  // A screenshot over the sendable size is treated like one that could not be taken: not offered, never shrunk.
  const taken = screenshot?.blob ?? null;
  const tooLarge = taken !== null && !fitsSendLimit(taken.size);
  const blob = tooLarge ? null : taken;
  const [include, setInclude] = useState(blob !== null);
  const [phase, setPhase] = useState<"form" | "saving" | "saved">("form");
  const [problem, setProblem] = useState<Problem>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const attempt = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const prepared = useRef<Awaited<ReturnType<typeof prepareReport>> | null>(null);

  const thumbnail = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (thumbnail ? URL.revokeObjectURL(thumbnail) : undefined), [thumbnail]);

  const trimmed = notes.trim();
  const received = savedId !== null && receivedId === savedId;

  function cancel() {
    // A save that has not committed is abandoned and a late answer is ignored; one that has committed already belongs to the outbox.
    attempt.current += 1;
    abort.current?.abort();
    onClose();
  }

  async function send() {
    if (!trimmed || phase === "saving") return;
    const mine = ++attempt.current;
    const controller = new AbortController();
    abort.current = controller;
    setProblem(null);
    setPhase("saving");
    try {
      // The same prepared report (and id) is reused when the last save could not be confirmed, so a retry cannot duplicate it.
      prepared.current ??= await prepareReport({
        notes: trimmed,
        screenshot: include ? blob : null,
        context: reportContext({
          pathname,
          viewportWidth: window.innerWidth,
          coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
          buildSha: feedbackBuildSha(process.env.NEXT_PUBLIC_BUILD_SHA),
          now: new Date(),
        }),
      });
      const outcome = await saveReport(prepared.current, controller.signal);
      if (mine !== attempt.current) return;
      if (outcome.ok) {
        prepared.current = null;
        setSavedId(outcome.id);
        setPhase("saved");
        onSaved(outcome.id);
        return;
      }
      if (outcome.reason === "cancelled") return;
      if (outcome.reason !== "uncertain") prepared.current = null;
      setProblem(outcome.reason);
    } catch {
      if (mine !== attempt.current) return;
      prepared.current = null;
      setProblem("unavailable");
    }
    setPhase("form");
  }

  async function copyNotes() {
    try {
      await navigator.clipboard.writeText(notes);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const announcement = received ? "Received." : phase === "saved" ? "Saved on this device." : "";

  return (
    <ModalSheet
      open
      title={COPY.title}
      description={COPY.description}
      onClose={cancel}
      dismissOnBackdrop={false}
      actions={
        phase === "saved" ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
            <Button onClick={send} disabled={!trimmed} aria-busy={phase === "saving"}>
              {phase === "saving" ? "Saving…" : "Send"}
            </Button>
          </>
        )
      }
    >
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {phase === "saved" ? (
        <div className="feedback-result">
          <h3>{received ? COPY.received : COPY.saved}</h3>
          <p>{received ? COPY.receivedText : COPY.savedText}</p>
        </div>
      ) : (
        <div className="feedback-form">
          {problem ? (
            <div className="feedback-problem" role="alert">
              <p className="field-error">
                <span aria-hidden="true">⚠ </span>
                {PROBLEM_TEXT[problem]}
              </p>
              {problem === "unavailable" && include && blob ? (
                <p className="tiny muted">{COPY.tryWithoutScreenshot}</p>
              ) : null}
              {problem === "unavailable" ? (
                <Button variant="ghost" small onClick={copyNotes}>
                  {copied ? "Copied" : "Copy my notes"}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="feedback-notes">{COPY.notesLabel}</label>
            <textarea
              id="feedback-notes"
              data-modal-autofocus
              rows={4}
              maxLength={NOTES_MAX}
              value={notes}
              aria-describedby="feedback-notes-help"
              disabled={phase === "saving"}
              onChange={(event) => {
                prepared.current = null;
                setNotes(event.target.value);
              }}
            />
            <p id="feedback-notes-help" className="tiny muted">
              {COPY.notesHelp}
              {notes.length > COUNTER_FROM ? (
                <span className="feedback-counter">
                  {" "}
                  {notes.length.toLocaleString("en-US")} / {NOTES_MAX.toLocaleString("en-US")}
                </span>
              ) : null}
            </p>
          </div>
          {screenshot ? (
            <div className="feedback-shot">
              {blob ? (
                <>
                  <label className="feedback-check">
                    <input
                      type="checkbox"
                      checked={include}
                      disabled={phase === "saving"}
                      onChange={(event) => {
                        prepared.current = null;
                        setInclude(event.target.checked);
                      }}
                    />
                    <span>{COPY.screenshotLabel}</span>
                  </label>
                  {include && thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not a remote image
                    <img className="feedback-thumb" src={thumbnail} alt={COPY.thumbnailAlt} />
                  ) : null}
                  <p className="tiny muted">{COPY.screenshotNote}</p>
                </>
              ) : (
                <label className="feedback-check">
                  <input type="checkbox" checked={false} disabled readOnly />
                  <span>{COPY.screenshotLabel}</span>
                </label>
              )}
              {!blob ? (
                <p className="tiny muted">
                  {tooLarge ? COPY.screenshotTooLarge : COPY.screenshotFailed}
                </p>
              ) : null}
            </div>
          ) : null}
          <p className="tiny muted">{COPY.alsoSent}</p>
          {!online ? <p className="tiny">{COPY.offline}</p> : null}
          {!trimmed ? <p className="tiny muted">{COPY.needNote}</p> : null}
        </div>
      )}
    </ModalSheet>
  );
}
