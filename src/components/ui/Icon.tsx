import type { ReactNode } from "react";

// The Suitcase icon registry (#381; build spec on #376, part 1 section 4). Outline, 24px grid, stroke 2, round caps and
// joins, live area 3 to 21: the same convention as shell/NavIcon. Every icon draws in currentColor, so the caller sets
// the colour. Icons are decorative (aria-hidden); a control that holds only an icon needs its own accessible name.
export const ICON_SHAPES = {
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  cloud: <path d="M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.6 4.2 4.2 0 0 0 7 18z" />,
  rain: (
    <>
      <path d="M7 15h10a3.5 3.5 0 0 0 .4-6.97A5.5 5.5 0 0 0 6.7 7.6 3.7 3.7 0 0 0 7 15z" />
      <path d="m8 18-1 2M12 18l-1 2M16 18l-1 2" />
    </>
  ),
  umbrella: (
    <>
      <path d="M3 12a9 9 0 0 1 18 0z" />
      <path d="M12 12v6a2 2 0 0 1-4 0" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  pencil: (
    <>
      <path d="m4 20 1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="m14 7 3 3" />
    </>
  ),
  caretDown: <path d="m6 9 6 6 6-6" />,
  caretUp: <path d="m6 15 6-6 6 6" />,
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof ICON_SHAPES;

export function Icon({
  name,
  size = 16,
  className,
}: {
  name: IconName;
  /** Rendered width and height in CSS px. */
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-icon={name}
    >
      {ICON_SHAPES[name]}
    </svg>
  );
}
