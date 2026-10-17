import Link from "next/link";

export type SaveStatus = "saved" | "saving" | "error";

const COPY: Record<SaveStatus, { text: string; label: string; glyph: string }> = {
  saved: { text: "Saved", label: "Saved", glyph: "✓" },
  saving: { text: "Saving…", label: "Saving", glyph: "…" },
  error: { text: "Couldn't save · Retry", label: "Couldn't save, retry", glyph: "!" },
};

// Presentational slot from #31 (placement only). #19 owns the state, the retry
// sheet and the "Last saved" line. Saved/Saving open Settings, Error retries.
export function SaveChip({
  status = "saved",
  onRetry,
}: {
  status?: SaveStatus;
  onRetry?: () => void;
}) {
  const { text, label, glyph } = COPY[status];
  const content = (
    <>
      <span className="sync-icon" aria-hidden="true">
        {glyph}
      </span>
      <span>{text}</span>
    </>
  );
  return status === "error" ? (
    <button type="button" className="sync-chip error" aria-label={label} onClick={onRetry}>
      {content}
    </button>
  ) : (
    <Link href="/settings" className={`sync-chip ${status}`} aria-label={label}>
      {content}
    </Link>
  );
}
