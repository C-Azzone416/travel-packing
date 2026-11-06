import type { ReactNode } from "react";

export interface AuthSuitcaseProps {
  children: ReactNode;
  sticker?: "ready" | "packed";
  lid?: "solid" | "lighter";
  banner?: ReactNode;
}

const CUBES = ["Clothing", "Toiletries", "Tech", "Documents", "Misc"] as const;

/**
 * The decorative suitcase shared by every signed-out screen (#424). The lid repeats the brand and carries no
 * information, so the whole decoration stays out of the accessibility tree; screen semantics remain in children.
 */
export function AuthSuitcase({
  children,
  sticker = "ready",
  lid = "solid",
  banner,
}: AuthSuitcaseProps) {
  return (
    <div className="auth-suitcase">
      <div className="auth-lid" data-lid={lid} aria-hidden="true">
        <p className="auth-lid-eyebrow">Packed Smart</p>
        <p className="auth-lid-headline">Every trip starts from your Staples.</p>
        <span className="auth-sticker" data-sticker={sticker}>
          {sticker === "ready" ? (
            <>
              <small>READY TO</small>
              <strong>GO!</strong>
            </>
          ) : (
            <>
              <small>ALL</small>
              <strong>PACKED!</strong>
            </>
          )}
        </span>
        <div className="auth-cubes">
          {CUBES.map((cube) => (
            <span className="auth-cube" data-cube={cube.toLowerCase()} key={cube}>
              <span className="auth-cube-label">{cube}</span>
            </span>
          ))}
        </div>
        <p className="auth-lid-footer">
          Your Staples, the weather and every cube, ready when you are.
        </p>
      </div>
      <div className="auth-panel">
        {banner}
        {children}
      </div>
    </div>
  );
}
