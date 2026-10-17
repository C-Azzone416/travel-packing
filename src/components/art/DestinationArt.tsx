"use client";

import Image from "next/image";
import { useState } from "react";
import { artworkFor } from "@/domain/destination-art";
import styles from "./DestinationArt.module.css";

export interface DestinationArtProps {
  /** Location ID from the picker. Unknown, custom or missing IDs use the fallback. */
  locationId: string | null | undefined;
  variant: "card" | "header";
  /** Eager-load. Only the first dashboard card and the trip header should set this. */
  priority?: boolean;
}

// Purely decorative: hidden from assistive tech, no alt text, no caption, and
// never a place for body text. If the image fails to load, the neutral surface
// stays at the same size.
export function DestinationArt({ locationId, variant, priority = false }: DestinationArtProps) {
  const art = artworkFor(locationId);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === art.src;
  const classes = [styles.visual, styles[variant], failed ? styles.failed : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={classes}
      data-art-key={art.key}
      data-art-failed={failed ? "true" : undefined}
      aria-hidden="true"
    >
      {failed ? null : (
        <Image
          className={styles.image}
          src={art.src}
          alt=""
          aria-hidden="true"
          fill
          sizes={
            variant === "header"
              ? "(min-width: 1120px) 1120px, 100vw"
              : "(min-width: 660px) 50vw, 100vw"
          }
          priority={priority}
          onError={() => setFailedSrc(art.src)}
        />
      )}
    </div>
  );
}
