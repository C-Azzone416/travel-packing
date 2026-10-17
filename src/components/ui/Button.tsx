import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonStyle {
  variant?: ButtonVariant;
  small?: boolean;
  block?: boolean;
}

// Also used to style links as buttons: <Link className={buttonClassName(...)} />.
export function buttonClassName({
  variant = "primary",
  small = false,
  block = false,
}: ButtonStyle = {}): string {
  return [
    "button",
    variant === "primary" ? "" : variant,
    small ? "small" : "",
    block ? "block" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export type ButtonProps = ButtonStyle & ButtonHTMLAttributes<HTMLButtonElement>;

export function Button({
  variant,
  small,
  block,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  const classes = [buttonClassName({ variant, small, block }), className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...rest} />;
}
