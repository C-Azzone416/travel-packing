"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { ModalSheet } from "@/components/ui/ModalSheet";
import { feedbackBuildSha } from "./build-sha";
import { reportContext } from "./capture-policy";
import { finalScreenshot } from "./annotation-final";
import type { Drawing } from "./annotation-model";
import { useFeedbackAccess } from "./FeedbackAccess";
import { ScreenshotEditor } from "./ScreenshotEditor";
import { useAnnotationDraft } from "./use-annotation-draft";
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
  screenshotHint: "Untick to send notes only.",
  // Design's #266 spec section 6: the existing sentence, then one new one.
  screenshotDrawNote:
    "Anything you draw is part of the picture that’s sent. Nothing is sent until you press Send.",
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

/** Sizes are decimal megabytes with one decimal, like the byte limit (design's #266 spec section 5). */
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;

export const SHOT_PROBLEM_COPY = {
  marks: (bytes: number) =>
    `Your screenshot with marks is ${megabytes(bytes)}, over the 4.0 MB limit, so it wasn’t sent. Nothing was shrunk or cropped. Press Undo or Clear drawing to remove marks, or untick the screenshot to send your notes only.`,
  alone: (bytes: number) =>
    `This screenshot is ${megabytes(bytes)}, over the 4.0 MB limit, so it can’t be sent. Untick the screenshot to send your notes only.`,
  failed:
    "We couldn’t add your marks to the screenshot, so nothing was sent. Try again, or untick the screenshot to send your notes only.",
} as const;

type ShotProblem = { kind: "marks" | "alone"; bytes: number } | { kind: "failed" };

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

/**
 * Keeps the sheet inside the part of the screen that is actually visible. With the software keyboard open a phone's visual
 * viewport is much shorter than the layout viewport, so the sheet follows it (`--feedback-vh`) and its pinned footer stays on screen.
 */
function useVisualViewportHeight() {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const apply = () =>
      root.style.setProperty("--feedback-vh", `${viewport?.height ?? window.innerHeight}px`);
    apply();
    viewport?.addEventListener("resize", apply);
    viewport?.addEventListener("scroll", apply);
    return () => {
      viewport?.removeEventListener("resize", apply);
      viewport?.removeEventListener("scroll", apply);
      root.style.removeProperty("--feedback-vh");
    };
  }, []);
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
  const { scopeKey } = useFeedbackAccess();
  const taken = screenshot?.blob ?? null;
  // A screenshot over the limit stays ticked and says so; Send waits until it is unticked (nothing is shrunk, cropped or swapped).
  const aloneTooLarge = taken !== null && !fitsSendLimit(taken.size);
  const [include, setInclude] = useState(taken !== null);
  const [phase, setPhase] = useState<"form" | "saving" | "saved">("form");
  const [problem, setProblem] = useState<Problem>(null);
  // What was refused at Send, and for which marks and tick: it is not shown for a drawing or tick that has since changed.
  const [refused, setRefused] = useState<{
    problem: ShotProblem;
    drawing: Drawing;
    include: boolean;
  } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const attempt = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const prepared = useRef<Awaited<ReturnType<typeof prepareReport>> | null>(null);
  const preparedFrom = useRef<{ drawing: Drawing; include: boolean } | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const draft = useAnnotationDraft(scopeKey);
  useVisualViewportHeight();

  const shotProblem: ShotProblem | null =
    refused && refused.drawing === draft.drawing && refused.include === include
      ? refused.problem
      : include && taken && aloneTooLarge
        ? { kind: "alone", bytes: taken.size }
        : null;
  const showEditor = include && taken !== null && !aloneTooLarge;

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
    setRefused(null);
    setPhase("saving");
    try {
      // The same prepared report (and id) is reused when the last save could not be confirmed, so a retry cannot duplicate it,
      // unless the marks or the tick changed since: then it is a different report and is prepared again.
      const was = preparedFrom.current;
      if (was && (was.drawing !== draft.drawing || was.include !== include))
        prepared.current = null;
      if (!prepared.current) {
        // The picture that goes out is decided here, BEFORE anything reaches the route or the outbox.
        const shot = await finalScreenshot({ include, original: taken, drawing: draft.drawing });
        if (mine !== attempt.current) return;
        if (shot.kind === "too-large" || shot.kind === "failed") {
          setRefused({
            problem:
              shot.kind === "failed"
                ? { kind: "failed" }
                : { kind: shot.annotated ? "marks" : "alone", bytes: shot.bytes },
            drawing: draft.drawing,
            include,
          });
          setPhase("form");
          requestAnimationFrame(() => alertRef.current?.scrollIntoView?.({ block: "nearest" }));
          return;
        }
        preparedFrom.current = { drawing: draft.drawing, include };
        prepared.current = await prepareReport({
          notes: trimmed,
          screenshot: shot.kind === "ready" ? shot.blob : null,
          context: reportContext({
            pathname,
            viewportWidth: window.innerWidth,
            coarsePointer: window.matchMedia?.("(pointer: coarse)").matches ?? false,
            buildSha: feedbackBuildSha(process.env.NEXT_PUBLIC_BUILD_SHA),
            now: new Date(),
          }),
        });
      }
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
              {problem === "unavailable" && include && taken ? (
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
              onFocus={(event) => event.currentTarget.scrollIntoView?.({ block: "nearest" })}
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
              {taken ? (
                <>
                  <div className="feedback-shot-head">
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
                    <span className="tiny muted">{COPY.screenshotHint}</span>
                  </div>
                  {showEditor ? (
                    <ScreenshotEditor blob={taken} draft={draft} disabled={phase === "saving"} />
                  ) : null}
                  {shotProblem ? (
                    <div className="feedback-problem" role="alert" ref={alertRef}>
                      <p className="field-error">
                        <span aria-hidden="true">⚠ </span>
                        {shotProblem.kind === "failed"
                          ? SHOT_PROBLEM_COPY.failed
                          : SHOT_PROBLEM_COPY[shotProblem.kind](shotProblem.bytes)}
                      </p>
                    </div>
                  ) : null}
                  {include ? (
                    <p className="tiny muted">
                      {COPY.screenshotNote} {COPY.screenshotDrawNote}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="feedback-check">
                    <input type="checkbox" checked={false} disabled readOnly />
                    <span>{COPY.screenshotLabel}</span>
                  </label>
                  <p className="tiny muted">{COPY.screenshotFailed}</p>
                </>
              )}
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
