"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Sticker } from "@/features/stamps/StampsScreen";
import { markWelcomeSeen, readWelcomeSeen, type WelcomeHomeModel } from "./welcome-home";
import styles from "./WelcomeHomeCard.module.css";

/** How long the sticker takes to ink (spec #393 section 2.3). */
export const INK_MS = 600;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The Welcome home card (#410): shown once after a trip, above the Home. Its first-stop sticker starts dashed and inks over
 * 600 ms (no animation under reduced motion, where it is solid at once). Dismissing it, or opening Stamps from it, keeps it
 * away on this device. It is drawn only after the trips have loaded in the browser, so reading storage here cannot disagree
 * with the server's markup.
 */
export function WelcomeHomeCard({ model }: { model: WelcomeHomeModel }) {
  const [hidden, setHidden] = useState(() => readWelcomeSeen().includes(model.tripId));
  const [inked, setInked] = useState(reducedMotion);
  const [announced, setAnnounced] = useState(inked);

  // The dashed state must be painted before the transition to the inked one starts.
  useEffect(() => {
    if (inked) return;
    const frame = requestAnimationFrame(() => setInked(true));
    return () => cancelAnimationFrame(frame);
  }, [inked]);
  // The status line is read once, after the 600 ms.
  useEffect(() => {
    if (announced) return;
    const done = window.setTimeout(() => setAnnounced(true), INK_MS);
    return () => window.clearTimeout(done);
  }, [announced]);

  if (hidden) return null;
  const dismiss = () => {
    markWelcomeSeen(model.tripId);
    setHidden(true);
  };

  return (
    <div className={styles.wrap}>
      <section className={styles.card} aria-label="Welcome home" data-welcome-home>
        <span className={styles.press} data-inked={inked || undefined}>
          <Sticker sticker={{ ...model.sticker, upcoming: !inked }} className={styles.sticker} />
        </span>
        <div className={styles.copy}>
          <p className={styles.eyebrow}>WELCOME HOME</p>
          <h2 id="welcome-home-title" className={styles.title}>
            {model.title}
          </h2>
          <p className={styles.line}>{model.line}</p>
        </div>
        <div className={styles.actions}>
          <Link
            className={styles.see}
            href={`/stamps?trip=${model.tripId}`}
            onClick={() => markWelcomeSeen(model.tripId)}
          >
            See stamps
          </Link>
          <button type="button" className={styles.close} aria-label="Dismiss" onClick={dismiss}>
            <Icon name="close" size={18} />
          </button>
        </div>
        <p className="sr-only" role="status">
          {announced ? model.announcement : ""}
        </p>
      </section>
    </div>
  );
}
