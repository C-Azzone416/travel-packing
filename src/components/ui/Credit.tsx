import type { ReactNode } from "react";

/** One piece of a credit sentence: plain text, or a link the data provider requires. */
export type CreditPart = string | { text: string; href: string };

/**
 * A data provider's required credit, as a sentence with real links (CC BY 4.0 asks for a link next to the data).
 * Links open in a new tab, are underlined so colour is never the only cue, and keep the surrounding text size.
 */
export function Credit({ parts }: { parts: readonly CreditPart[] }): ReactNode {
  return (
    <span className="credit">
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer">
            {part.text}
          </a>
        ),
      )}
    </span>
  );
}
