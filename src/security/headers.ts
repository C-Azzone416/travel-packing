// Security response headers for every route (#22, from the policy in #28). Plain data so a unit test can pin each value
// and an e2e test can check the real responses.
//
// The CSP allows inline scripts and styles because Next.js emits its own inline bootstrap script and the app uses inline
// styles; a nonce-based policy needs per-request middleware and is a follow-up. Everything else is closed: no foreign
// origins for scripts, styles, images, fonts, frames or connections (the geocoder and weather providers are only ever
// called by the server), no <object>, no framing at all, forms post only to this origin.

export interface HeaderRule {
  key: string;
  value: string;
}

export function contentSecurityPolicy(development: boolean): string {
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    // Next's dev server needs eval for fast refresh; production never does.
    ["script-src", development ? "'self' 'unsafe-inline' 'unsafe-eval'" : "'self' 'unsafe-inline'"],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self'"],
    ["connect-src", development ? "'self' ws: wss:" : "'self'"],
    ["frame-src", "'none'"],
    ["frame-ancestors", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join("; ");
}

export function securityHeaders(development: boolean): HeaderRule[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(development) },
    // Two years, subdomains too. Browsers ignore it over plain http, so it is harmless on localhost.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    // frame-ancestors is the modern control; this covers older browsers.
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ];
}
