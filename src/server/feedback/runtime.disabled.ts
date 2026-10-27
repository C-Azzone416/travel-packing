// What the Framebriar server routes are in every build that is not stable Preview, local development or the e2e build (#259):
// four handlers that answer 404 and import nothing, so no enrollment, key ring, database or Framebriar code is in the bundle.

const notFound = async (): Promise<Response> =>
  Response.json(
    { v: 1, error: "NOT_FOUND" },
    { status: 404, headers: { "cache-control": "no-store" } },
  );

export const feedbackRoutes = {
  status: notFound,
  redeem: notFound,
  disconnect: notFound,
  reports: notFound,
};
