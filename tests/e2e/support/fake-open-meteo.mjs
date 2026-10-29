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

// ---- Weather (forecast + archive), for the weather e2e. Synthetic: no real place or date is represented.
// A place's weather is chosen by its rounded latitude. "base" gives the first London (51.51) hot and dry
// and the second (42.98) cool and rainy; "dry" makes both hot and dry, which is the "changed forecast" of the
// review-sheet scenario (the rain gear is no longer called for). Every request is recorded so a test can prove what was (not) sent.
const HOT_DRY = { high: 30, low: 20, prob: 0, mm: 0, uv: 9, sun: 11 * 3600 };
const COOL_WET = { high: 15, low: 8, prob: 80, mm: 6, uv: 2, sun: 3 * 3600 };
const weatherCalls = [];
const weatherState = { variant: "base", fail: false };

// #303: "varied" changes day by day (rain on every third day, snow on every fifth, odd highs), and "scorching" is
// hot enough for three-digit Fahrenheit, so the daily rows are exercised with more than one kind of day.
const SCORCHING = { high: 40, low: 31, prob: 0, mm: 0, uv: 11, sun: 12 * 3600 };

function profileFor(latitude) {
  const first = Math.abs(Number(latitude) - 51.51) < 0.5;
  if (weatherState.variant === "scorching") return SCORCHING;
  const hot = weatherState.variant === "dry" || first;
  return hot ? HOT_DRY : COOL_WET;
}

function* days(start, end) {
  const last = Date.parse(`${end}T00:00:00Z`);
  for (let at = Date.parse(`${start}T00:00:00Z`); at <= last; at += 86_400_000) {
    yield new Date(at).toISOString().slice(0, 10);
  }
}

function weatherBody(url, forecast) {
  const profile = profileFor(url.searchParams.get("latitude"));
  const dates = [...days(url.searchParams.get("start_date"), url.searchParams.get("end_date"))];
  const varied = weatherState.variant === "varied";
  const ordinal = (date) => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  const rainy = (date) => varied && ordinal(date) % 3 === 0;
  const snowy = (date) => varied && ordinal(date) % 5 === 0;
  const daily = {
    time: dates,
    temperature_2m_max: dates.map((date) => profile.high + (varied ? ordinal(date) % 6 : 0)),
    temperature_2m_min: dates.map((date) => profile.low + (varied ? ordinal(date) % 4 : 0)),
    precipitation_sum: dates.map((date) => (rainy(date) ? 6 : profile.mm)),
    snowfall_sum: dates.map((date) => (snowy(date) ? 2 : 0)),
    sunshine_duration: dates.map(() => profile.sun),
  };
  if (forecast) {
    daily.precipitation_probability_max = dates.map((date) =>
      rainy(date) ? 70 : varied ? 15 : profile.prob,
    );
    daily.uv_index_max = dates.map(() => profile.uv);
  }
  return { daily };
}

createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://127.0.0.1:${PORT}`);
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (url.pathname === "/health") return send(200, { ok: true });
  if (url.pathname === "/__queries") return send(200, queries);
  if (url.pathname === "/__weather-calls") return send(200, weatherCalls);
  if (url.pathname === "/__weather-reset") {
    weatherCalls.length = 0;
    weatherState.variant = "base";
    weatherState.fail = false;
    return send(200, { ok: true });
  }
  if (url.pathname === "/__weather-set") {
    if (url.searchParams.has("variant")) weatherState.variant = url.searchParams.get("variant");
    if (url.searchParams.has("fail")) weatherState.fail = url.searchParams.get("fail") === "1";
    return send(200, weatherState);
  }
  if (url.pathname === "/v1/forecast" || url.pathname === "/v1/archive") {
    weatherCalls.push({
      path: url.pathname,
      params: Object.fromEntries(url.searchParams),
      headers: Object.keys(request.headers).sort(),
    });
    if (weatherState.fail) return send(500, { error: true });
    return send(200, weatherBody(url, url.pathname === "/v1/forecast"));
  }
  if (url.pathname === "/__reset") {
    queries.length = 0;
    return send(200, { ok: true });
  }
  if (url.pathname === "/v1/get") {
    // Like the real get-by-id endpoint: one place object, or a client error for an unknown id.
    const wanted = url.searchParams.get("id");
    const place = Object.values(PLACES)
      .flat()
      .find((candidate) => String(candidate.id) === wanted);
    return place ? send(200, place) : send(404, { error: true });
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
