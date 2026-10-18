"use client";

import { useState } from "react";
import { themeFor, type ThemeId } from "@/domain/themes";
import styles from "./DestinationArt.module.css";

export interface DestinationArtProps {
  /** The trip's theme (#48). Missing or unknown themes show Travel. */
  theme: ThemeId | null | undefined;
  variant: "card" | "header";
  /** Eager-load. Only the first dashboard card and the trip header should set this. */
  priority?: boolean;
}

// Purely decorative: hidden from assistive tech, no alt text, no caption, and never a place for body text. If the
// image fails to load, the neutral surface stays at the same size. Themes are SVG, so this is a plain <img>: the
// image optimizer refuses SVG, and there is nothing to optimize.
export function DestinationArt({ theme, variant, priority = false }: DestinationArtProps) {
  const art = themeFor(theme);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === art.src;
  const classes = [styles.visual, styles[variant], failed ? styles.failed : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-art-key={art.id}
      data-art-failed={failed ? "true" : undefined}
      aria-hidden="true"
    >
      {failed ? null : (
        // eslint-disable-next-line @next/next/no-img-element -- SVG: the image optimizer refuses it
        <img
          className={styles.image}
          src={art.src}
          alt=""
          aria-hidden="true"
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "auto"}
          decoding="async"
          onError={() => setFailedSrc(art.src)}
        />
      )}
    </div>
  );
}
