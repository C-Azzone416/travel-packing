import Link from "next/link";

export type SaveStatus = "saved" | "saving" | "error";

const COPY: Record<SaveStatus, { text: string; label: string; glyph: string }> = {
  saved: { text: "Saved", label: "Saved", glyph: "✓" },
  saving: { text: "Saving…", label: "Saving", glyph: "●" },
  error: { text: "Not saved · Retry", label: "Couldn't save, retry", glyph: "!" },
};

// The top-bar chip from #31. Saved/Saving open Settings (where "Last saved" lives); Error opens the retry sheet, so
// recovery is one tap from any screen.
export function SaveChip({
  status = "saved",
  onOpenError,
}: {
  status?: SaveStatus;
  onOpenError?: () => void;
}) {
  const { text, label, glyph } = COPY[status];
  const content = (
    <>
      <span className="sync-icon" aria-hidden="true">
        {glyph}
      </span>
      <span className="sync-text">{text}</span>
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
