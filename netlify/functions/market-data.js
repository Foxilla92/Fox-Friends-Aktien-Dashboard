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

function parseInput(input) {
  if (!input.includes(":")) return { symbol: input, exchange: "" };
  const [prefix, symbol] = input.split(":", 2);
  const aliases = {
    NASDAQ: "NASDAQ",
    NYSE: "NYSE",
    XETR: "XETRA",
    XETRA: "XETRA",
    LSE: "LSE"
  };
  return { symbol, exchange: aliases[prefix] || prefix };
}

function tradingViewPrefix(exchange) {
  const aliases = {
    NASDAQ: "NASDAQ",
    NYSE: "NYSE",
    XETRA: "XETR",
    LSE: "LSE",
    AMEX: "AMEX"
  };
  return aliases[exchange] || exchange;
}

async function fetchTwelveSeries(symbol, interval, outputsize, apiKey, exchange = "") {
  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("interval", interval);
  url.searchParams.set("outputsize", String(outputsize));
  url.searchParams.set("order", "ASC");
  url.searchParams.set("apikey", apiKey);
  if (exchange) url.searchParams.set("exchange", exchange);

  const upstream = await fetch(url);
  const text = await upstream.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Twelve Data lieferte eine ungültige Antwort (HTTP ${upstream.status}).`);
  }

  if (!upstream.ok || data.status === "error" || !Array.isArray(data.values)) {
    const error = new Error(data.message || `Keine Kursdaten für ${symbol}.`);
    error.httpStatus = upstream.status;
    throw error;
  }
  return data;
}


function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeCalendarRows(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["earnings", "data", "values", "calendar", "result"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function parseEventDate(row) {
  const raw =
    row?.date ||
    row?.datetime ||
    row?.report_date ||
    row?.earnings_date ||
    row?.fiscal_date ||
    row?.time;
  if (!raw) return null;
  const date = new Date(String(raw).length === 10 ? `${raw}T12:00:00Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchUpcomingEarnings(symbol, apiKey, exchange = "") {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 180);

  const url = new URL("https://api.twelvedata.com/earnings_calendar");
  url.searchParams.set("symbol", symbol);
  url.searchParams.set("start_date", isoDate(start));
  url.searchParams.set("end_date", isoDate(end));
  url.searchParams.set("apikey", apiKey);
  if (exchange) url.searchParams.set("exchange", exchange);

  const upstream = await fetch(url);
  const text = await upstream.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { available: false, reason: `Ungültige Earnings-Antwort (HTTP ${upstream.status}).` };
  }

  if (!upstream.ok || data?.status === "error") {
    return {
      available: false,
      reason: data?.message || `Earnings nicht verfügbar (HTTP ${upstream.status}).`
    };
  }

  const rows = normalizeCalendarRows(data)
    .map(row => ({ row, date: parseEventDate(row) }))
    .filter(item => item.date && item.date >= start)
    .sort((a, b) => a.date - b.date);

  if (!rows.length) {
    return { available: true, next: null };
  }

  const next = rows[0].row;
  const nextDate = rows[0].date;
  const session =
    next?.time ||
    next?.release_time ||
    next?.hour ||
    next?.when ||
    "";

  return {
    available: true,
    next: {
      date: isoDate(nextDate),
      session: String(session || ""),
      estimate: next?.eps_estimate ?? next?.estimate ?? next?.estimated_eps ?? null,
      currency: next?.currency ?? null
    }
  };
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
  const rawSymbol = String(params.symbol || "").trim().toUpperCase();
  const interval = String(params.interval || "1h");

  if (!rawSymbol) {
    return response(200, {
      status: "ok",
      message: "Fox & Friends Backend läuft.",
      apiKeyConfigured: true,
      resolutionMode: "single-attempt"
    });
  }

  if (!SYMBOL_PATTERN.test(rawSymbol)) {
    return response(400, { status: "error", message: "Ungültiges Aktiensymbol." });
  }
  if (!ALLOWED_INTERVALS.has(interval)) {
    return response(400, { status: "error", message: "Ungültiger Zeitraum." });
  }

  const parsed = parseInput(rawSymbol);

  try {
    // Nur EIN Handelsplatzversuch pro Aktie:
    // - ohne Präfix lässt Twelve Data selbst den besten Treffer wählen
    // - mit Präfix wird genau dieser Handelsplatz verwendet
    const [intraday, daily, earnings] = await Promise.all([
      fetchTwelveSeries(parsed.symbol, interval, 450, apiKey, parsed.exchange),
      fetchTwelveSeries(parsed.symbol, "1day", 300, apiKey, parsed.exchange),
      fetchUpcomingEarnings(parsed.symbol, apiKey, parsed.exchange)
    ]);

    const resolvedExchange =
      intraday?.meta?.exchange ||
      daily?.meta?.exchange ||
      parsed.exchange ||
      "";

    const resolvedSymbol =
      intraday?.meta?.symbol ||
      daily?.meta?.symbol ||
      parsed.symbol;

    const tradingViewSymbol = resolvedExchange
      ? `${tradingViewPrefix(resolvedExchange)}:${resolvedSymbol}`
      : resolvedSymbol;

    return response(200, {
      status: "ok",
      requestedSymbol: rawSymbol,
      resolvedSymbol,
      resolvedExchange,
      tradingViewSymbol,
      intraday,
      daily,
      earnings,
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
