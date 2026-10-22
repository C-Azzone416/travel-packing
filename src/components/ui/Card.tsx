import type { HTMLAttributes } from "react";

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside";
  padded?: boolean;
}

export function Card({ as: Tag = "div", padded = false, className, ...rest }: CardProps) {
  const classes = ["card", padded ? "padded" : "", className].filter(Boolean).join(" ");
  return <Tag className={classes} {...rest} />;
}
