// Strings that must never appear in a normal build, each unique to one module that must stay out of it. `source` is the
// file that holds the string, and build-markers.test.ts checks that it still does, so renaming or editing the string
// there cannot leave `check:no-e2e-in-build` looking for something that no longer exists.

export interface BuildMarker {
  name: string;
  text: string;
  source: string;
}

export const BUILD_MARKERS: readonly BuildMarker[] = [
  {
    name: "the e2e fake sign-in",
    text: "e2e-auth-session",
    source: "src/server/auth/e2e-provider.ts",
  },
  {
    name: "the e2e Postgres driver",
    text: "e2e-test-only-pg-driver",
    source: "src/server/db/e2e-driver.ts",
  },
  // The sample trips are for tests only; the dashboard reads real data.
  {
    name: "the dashboard sample-trip fixtures",
    text: "Lisbon, Lisbon District, Portugal",
    source: "src/features/trips/fixtures.ts",
  },
];
