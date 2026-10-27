// Wires the Framebriar enrollment routes to the real auth runtime, database and Framebriar client (#259). This module (and with it
// the whole server feedback path) is compiled in ONLY for stable Preview, local development and the synthetic e2e build:
// next.config.ts resolves this exact specifier to runtime.disabled.ts everywhere else, so a Production build has no active
// Framebriar server path (scripts/check-no-feedback-in-build.ts looks for FRAMEBRIAR_SERVER_MARKER).

import "server-only";
import { getAuth } from "@/server/auth/auth-runtime";
import { getAppDb } from "@/server/db/app-db";
import { createEnrollmentService, type EnrollmentService } from "./enrollment-service";
import { e2eUpstreamFetch } from "./e2e-upstream";
import { createFramebriarClient } from "./framebriar-client";
import { createFeedbackRoutes } from "./routes";

// In the synthetic e2e build the client talks to a local fake instead of the real service (null, so the default, everywhere else).
const client = createFramebriarClient({ fetchImpl: e2eUpstreamFetch() ?? undefined });
let service: EnrollmentService | undefined;

async function getService(): Promise<EnrollmentService | null> {
  const db = await getAppDb();
  if (!db) return null;
  service ??= createEnrollmentService({ db, client });
  return service;
}

export const feedbackRoutes = createFeedbackRoutes({ getAuth, getService, client });
