import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTs,
  // reference/ is the read-only prototype, not shipped code.
  {
    ignores: [
      "reference/**",
      ".next/**",
      ".vercel/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "next-env.d.ts",
    ],
  },
  // All app logging goes through a closed-event logger or src/server/redact.ts (#22): no raw console calls, so a stray
  // console.log can't put a date, destination, item name or email into the logs. The sinks themselves and the seed
  // CLI's printed summary are the only places that touch the console.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/**/*.test.{ts,tsx}",
      "src/server/redact.ts",
      "src/server/auth/safe-log.ts",
      "src/server/data/safe-log.ts",
      "src/server/locations/search-handler.ts",
      "src/server/weather/safe-log.ts",
      "src/server/seed/cli.ts",
    ],
    rules: { "no-console": "error" },
  },
];

export default config;
