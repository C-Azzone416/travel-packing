import { feedbackRoutes } from "@/server/feedback/runtime";

export const dynamic = "force-dynamic";
// A report with a screenshot uploads to Framebriar in two calls; leave room for a slow upstream.
export const maxDuration = 30;
export const POST = feedbackRoutes.reports;
