"use strict";

const ALLOWED_INTERVALS = new Set(["30min", "1h", "2h", "4h", "1day"]);
const SYMBOL_PATTERN = /^[A-Z0-9:._-]{1,40}$/;

function response(statusCode, body, cache = false) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Cache-Control": cache
        ? "public, max-age=60, s-maxage=300, stale-while-revalidate=60"
        : "no-store"
    },
    body: JSON.stringify(body)
  };
}

async function fetchTwelveSeries(symbol, interval, outputsize, apiKey) {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("order", "ASC");
  url.searchParams.set("apikey", apiKey);

  const upstream = await fetch(url);
  const text = await upstream.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Twelve Data lieferte eine ungültige Antwort (HTTP ${upstream.status}).`);
  }

  if (!upstream.ok || data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(data.message || `Keine Kursdaten für ${symbol}.`);
  }
  return data;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return response(200, { ok: true });
  if (event.httpMethod !== "GET") {
    return response(405, { status: "error", message: "Nur GET-Anfragen sind erlaubt." });
  }

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    return response(500, {
      status: "error",
      message: "In Netlify fehlt die Umgebungsvariable TWELVE_DATA_API_KEY."
    });
  }

  const params = event.queryStringParameters || {};
  const symbol = String(params.symbol || "").trim().toUpperCase();
  const interval = String(params.interval || "1h");

  // Opening the function URL without parameters acts as a health check.
  if (!symbol) {
    return response(200, {
      status: "ok",
      message: "Fox & Friends Backend läuft.",
      apiKeyConfigured: true
    });
  }

  if (!SYMBOL_PATTERN.test(symbol)) {
    return response(400, { status: "error", message: "Ungültiges Aktiensymbol." });
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return response(400, { status: "error", message: "Ungültiger Zeitraum." });
  }

  try {
    const [intraday, daily] = await Promise.all([
      fetchTwelveSeries(symbol, interval, 450, apiKey),
      fetchTwelveSeries(symbol, "1day", 300, apiKey)
    ]);

    return response(200, {
      status: "ok",
      symbol,
      interval,
      intraday,
      daily,
      fetchedAt: new Date().toISOString()
    }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Datenfehler.";
    const rateLimited = /credit|current minute|rate limit|too many/i.test(message);
    const paidPlan = /available starting with|upgrade|grow|venture|pro plan/i.test(message);

    return response(rateLimited ? 429 : 502, {
      status: "error",
      code: paidPlan ? "PLAN_REQUIRED" : rateLimited ? "RATE_LIMIT" : "UPSTREAM_ERROR",
      message
    });
  }
};
