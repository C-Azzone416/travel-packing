"use client";

import { useEffect, useState } from "react";

/** The root font size the layout is drawn for. Anything larger counts as zoomed text. */
const BASE_FONT_PX = 16;

/**
 * Whether the person has enlarged the text (browser text size, or an OS "larger text" setting that scales the root font).
 * The phone Packing view uses it to leave its fixed-height layout for natural flow (#376 part 3 section 4): a screen that is
 * exactly one viewport tall cannot hold 200% text. A hidden 1rem probe is watched, because a change of the root font size
 * resizes it (no resize event fires for that). False where `ResizeObserver` does not exist.
 */
export function useTextZoomed(): boolean {
  const [zoomed, setZoomed] = useState(false);
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:-9999px;top:0;width:1rem;height:1px;visibility:hidden;pointer-events:none";
    document.body.appendChild(probe);
    const read = () => setZoomed(probe.getBoundingClientRect().width > BASE_FONT_PX + 0.5);
    const observer = new ResizeObserver(read);
    observer.observe(probe);
    read();
    return () => {
      observer.disconnect();
      probe.remove();
    };
  }, []);
  return zoomed;
}
