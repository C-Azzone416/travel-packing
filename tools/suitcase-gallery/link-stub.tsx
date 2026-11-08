// next/link needs the Next router; the gallery is plain React, so it gets an anchor with the same props that matter.
import type { AnchorHTMLAttributes } from "react";

export default function Link({
  href,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return <a href={href} {...rest} />;
}
