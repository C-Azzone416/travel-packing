import { Icon } from "@/components/ui/Icon";
import styles from "./PackedRibbon.module.css";

export interface PackedRibbonProps {
  /** Where the trip is on the way to Ready: "packed" is the gold "All packed", "ready" the green "Ready". */
  state: "open" | "packed" | "ready";
}

// The pill that hangs from the suitcase handle once everything is packed (spec #393 section 2.4). Nothing while the bag is still
// open. It drops in once; reduced motion shows it at once. The words are the whole message, so colour is never the only signal.
export function PackedRibbon({ state }: PackedRibbonProps) {
  if (state === "open") return null;
  return (
    <span
      className={styles.ribbon}
      data-tone={state === "ready" ? "good" : "gold"}
      data-packed-ribbon={state === "ready" ? "good" : "gold"}
    >
      {state === "ready" ? "Ready" : "All packed"}
      <Icon name="check" size={14} />
    </span>
  );
}
