"use client";

import { useEffect, useRef, useState } from "react";

// Text that wraps freely on a wide screen and is cut to two lines on a phone, with a "More" button only when it really
// is cut (design #108 §6). The overflow is measured from the browser's own layout, so a short reason never shows a
// button. `limited` is the CSS line cap (phone widths only, in globals.css); the button reads `aria-expanded`.
export function ClampedText({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cut, setCut] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    // The observer reports once when it starts watching and again whenever the size changes (a rotated phone, a
    // wider window), so the answer is never stale. Nothing is measured while the text is open: it fits by then.
    const observer = new ResizeObserver(() => {
      if (!element.classList.contains("open"))
        setCut(element.scrollHeight > element.clientHeight + 1);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <>
      <span
        ref={ref}
        className={["clamped", open ? "open" : "", className].filter(Boolean).join(" ")}
      >
        {text}
      </span>
      {cut || open ? (
        <button
          type="button"
          className="more-button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </>
  );
}
