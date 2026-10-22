import Link from "next/link";

/** The Staples | Saved lists switcher under the page head (#167, design §3). Two routes, so two links. */
export function StaplesTabs({ current }: { current: "staples" | "lists" }) {
  return (
    <nav className="trip-tabs staples-tabs" aria-label="Staples sections">
      <Link
        href="/staples"
        aria-current={current === "staples" ? "page" : undefined}
        className={current === "staples" ? "active" : ""}
      >
        Staples
      </Link>
      <Link
        href="/staples/lists"
        aria-current={current === "lists" ? "page" : undefined}
        className={current === "lists" ? "active" : ""}
      >
        Saved lists
      </Link>
    </nav>
  );
}
