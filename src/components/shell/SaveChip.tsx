import Link from "next/link";

export type SaveStatus = "idle" | "saved" | "saving" | "error";

const COPY: Record<
  Exclude<SaveStatus, "idle">,
  { text: string; compactText?: string; label: string; glyph: string }
> = {
  saved: { text: "Saved", label: "Saved", glyph: "✓" },
  saving: { text: "Saving…", label: "Saving", glyph: "●" },
  error: {
    text: "Not saved · Retry",
    compactText: "Retry",
    label: "Not saved, retry",
    glyph: "!",
  },
};

// The top-bar chip from #31. Saved/Saving open Settings (where "Last saved" lives); Error opens the retry sheet, so
// recovery is one tap from any screen.
export function SaveChip({
  status = "idle",
  onOpenError,
}: {
  status?: SaveStatus;
  onOpenError?: () => void;
}) {
  if (status === "idle") return null;
  const { text, compactText, label, glyph } = COPY[status];
  const content = (
    <>
      <span className="sync-icon" aria-hidden="true">
        {glyph}
      </span>
      <span className="sync-text">{text}</span>
      {compactText ? (
        <span className="sync-text-compact" aria-hidden="true">
          {compactText}
        </span>
      ) : null}
    </>
  );
  return status === "error" ? (
    <button type="button" className="sync-chip error" aria-label={label} onClick={onOpenError}>
      {content}
    </button>
  ) : (
    <Link href="/settings" className={`sync-chip ${status}`} aria-label={label}>
      {content}
    </Link>
  );
}
