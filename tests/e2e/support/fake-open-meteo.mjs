// A local stand-in for Open-Meteo's geocoding API, for e2e only (never the real service: no network in
// tests). It answers from fixed synthetic places and records every query it receives, so a test can
// assert what the app sent and when it sent nothing.
import { createServer } from "node:http";

const PORT = Number(process.env.E2E_FAKE_GEO_PORT ?? 3102);

const PLACES = {
  london: [
    {
      id: 2643743,
      name: "London",
      latitude: 51.50853,
      longitude: -0.12574,
      country: "United Kingdom",
      country_code: "GB",
      admin1: "England",
      admin2: "Greater London",
      timezone: "Europe/London",
    },
    {
      id: 6058560,
      name: "London",
      latitude: 42.98339,
      longitude: -81.23304,
      country: "Canada",
      country_code: "CA",
      admin1: "Ontario",
      admin2: "Middlesex County",
      timezone: "America/Toronto",
    },
  ],
  // Two results that read identically, to prove the picker tells them apart.
  spring: [
    {
      id: 4250542,
      name: "Springfield",
      latitude: 39.80172,
      longitude: -89.64371,
      country: "United States",
      country_code: "US",
      admin1: "Illinois",
      admin2: "Sangamon County",
      timezone: "America/Chicago",
    },
    {
      id: 4887398,
      name: "Springfield",
      latitude: 41.84,
      longitude: -87.7,
      country: "United States",
      country_code: "US",
      admin1: "Illinois",
      admin2: "Cook County",
      timezone: "America/Chicago",
    },
  ],
};

PLACES.countryless = [
  {
    ...PLACES.london[0],
    id: 111,
    name: "Countryless",
    country: undefined,
    country_code: undefined,
  },
  { ...PLACES.london[0], id: 112, name: "Countryless" },
];

const queries = [];

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return send(200, { ok: true });
  if (url.pathname === "/__queries") return send(200, queries);
  if (url.pathname === "/__reset") {
    queries.length = 0;
    return send(200, { ok: true });
  }
  if (url.pathname !== "/v1/search") return send(404, {});
  const name = (url.searchParams.get("name") ?? "").toLowerCase();
  queries.push({
    params: Object.fromEntries(url.searchParams),
    headers: Object.keys(request.headers).sort(),
  });
  if (name === "boom") return send(500, { error: true });
  // A slow answer, so a test can look at the "Searching…" state.
  if (name === "slow") return setTimeout(() => send(200, { generationtime_ms: 0.1 }), 2500);
  const key = Object.keys(PLACES).find((candidate) => name.startsWith(candidate));
  // Like the real API, no match means no `results` key at all.
  return send(
    200,
    key ? { results: PLACES[key], generationtime_ms: 0.3 } : { generationtime_ms: 0.1 },
  );
}).listen(PORT, "127.0.0.1");
