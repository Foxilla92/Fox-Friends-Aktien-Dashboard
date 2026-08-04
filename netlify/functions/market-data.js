"use strict";

const { readJson, writeJson } = require("./github-store");

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
  const aliases = { NASDAQ:"NASDAQ", NYSE:"NYSE", XETR:"XETRA", XETRA:"XETRA", LSE:"LSE" };
  return { symbol, exchange: aliases[prefix] || prefix };
}

function tradingViewPrefix(exchange) {
  const aliases = { NASDAQ:"NASDAQ", NYSE:"NYSE", XETRA:"XETR", LSE:"LSE", AMEX:"AMEX" };
  return aliases[exchange] || exchange;
}

function berlinDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function safeKey(value) {
  return String(value || "").replace(/[^A-Z0-9._-]/gi, "_");
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
  try { data = JSON.parse(text); }
  catch { throw new Error(`Twelve Data lieferte eine ungültige Antwort (HTTP ${upstream.status}).`); }

  if (!upstream.ok || data.status === "error" || !Array.isArray(data.values)) {
    throw new Error(data.message || `Keine Kursdaten für ${symbol}.`);
  }
  return data;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeCalendarRows(data) {
  if (Array.isArray(data)) return data;
  for (const key of ["earnings","data","values","calendar","result"]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

function parseEventDate(row) {
  const raw = row?.date || row?.datetime || row?.report_date || row?.earnings_date || row?.fiscal_date || row?.time;
  if (!raw) return null;
  const date = new Date(String(raw).length === 10 ? `${raw}T12:00:00Z` : raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function fetchUpcomingEarnings(symbol, apiKey, exchange = "") {
  const start = new Date();
  start.setUTCHours(0,0,0,0);
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
  try { data = JSON.parse(text); }
  catch { return { available:false, reason:`Ungültige Earnings-Antwort (HTTP ${upstream.status}).` }; }

  if (!upstream.ok || data?.status === "error") {
    return { available:false, reason:data?.message || `Earnings nicht verfügbar (HTTP ${upstream.status}).` };
  }

  const rows = normalizeCalendarRows(data)
    .map(row => ({ row, date: parseEventDate(row) }))
    .filter(item => item.date && item.date >= start)
    .sort((a,b) => a.date - b.date);

  if (!rows.length) return { available:true, next:null };
  const next = rows[0].row;
  return {
    available:true,
    next:{
      date:isoDate(rows[0].date),
      session:String(next?.time || next?.release_time || next?.hour || next?.when || ""),
      estimate:next?.eps_estimate ?? next?.estimate ?? next?.estimated_eps ?? null,
      currency:next?.currency ?? null
    }
  };
}

async function readAuxCache(parsed) {
  const path = `shared/cache/${safeKey(parsed.exchange || "AUTO")}_${safeKey(parsed.symbol)}.json`;
  const stored = await readJson(path);
  return { path, cache: stored.data || {} };
}

async function writeAuxCache(path, cache, symbol) {
  try {
    await writeJson(path, cache, `Tagesdaten-Cache aktualisieren: ${symbol}`);
  } catch (error) {
    console.warn("Hilfscache konnte nicht gespeichert werden:", error.message);
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return response(200, { ok:true });
  if (event.httpMethod !== "GET") return response(405, { status:"error", message:"Nur GET-Anfragen sind erlaubt." });

  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return response(500, { status:"error", message:"In Netlify fehlt TWELVE_DATA_API_KEY." });

  const params = event.queryStringParameters || {};
  const rawSymbol = String(params.symbol || "").trim().toUpperCase();
  const interval = String(params.interval || "1h");
  const mode = String(params.mode || "full");

  if (!rawSymbol) return response(200, {
    status:"ok",
    message:"Fox & Friends Backend läuft.",
    apiKeyConfigured:true,
    cacheMode:"daily-and-earnings"
  });
  if (!SYMBOL_PATTERN.test(rawSymbol)) return response(400, { status:"error", message:"Ungültiges Aktiensymbol." });
  if (!ALLOWED_INTERVALS.has(interval)) return response(400, { status:"error", message:"Ungültiger Zeitraum." });

  const parsed = parseInput(rawSymbol);
  const today = berlinDate();

  try {
    const { path, cache } = await readAuxCache(parsed);

    let daily = cache.dailyDate === today ? cache.daily : null;
    let earnings = cache.earningsDate === today ? cache.earnings : null;
    let intraday = null;
    let creditsUsed = 0;

    if (!daily) {
      daily = await fetchTwelveSeries(parsed.symbol, "1day", 300, apiKey, parsed.exchange);
      creditsUsed += 1;
    }

    if (mode !== "benchmark") {
      intraday = await fetchTwelveSeries(parsed.symbol, interval, 450, apiKey, parsed.exchange);
      creditsUsed += 1;

      if (!earnings) {
        earnings = await fetchUpcomingEarnings(parsed.symbol, apiKey, parsed.exchange);
        creditsUsed += 1;
      }
    }

    if (cache.dailyDate !== today || (mode !== "benchmark" && cache.earningsDate !== today)) {
      await writeAuxCache(path, {
        dailyDate: today,
        daily,
        earningsDate: mode !== "benchmark" ? today : cache.earningsDate || null,
        earnings: mode !== "benchmark" ? earnings : cache.earnings || null
      }, rawSymbol);
    }

    const meta = intraday?.meta || daily?.meta || {};
    const resolvedExchange = meta.exchange || parsed.exchange || "";
    const resolvedSymbol = meta.symbol || parsed.symbol;
    const tradingViewSymbol = resolvedExchange
      ? `${tradingViewPrefix(resolvedExchange)}:${resolvedSymbol}`
      : resolvedSymbol;

    return response(200, {
      status:"ok",
      requestedSymbol:rawSymbol,
      resolvedSymbol,
      resolvedExchange,
      tradingViewSymbol,
      intraday,
      daily,
      earnings: mode !== "benchmark" ? earnings : null,
      cacheInfo:{
        date:today,
        dailyFromCache:cache.dailyDate === today,
        earningsFromCache:mode !== "benchmark" ? cache.earningsDate === today : null,
        creditsUsed
      },
      fetchedAt:new Date().toISOString()
    }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unbekannter Datenfehler.";
    const rateLimited = /credit|current minute|rate limit|too many/i.test(message);
    const paidPlan = /available starting with|upgrade|grow|venture|pro plan/i.test(message);
    return response(rateLimited ? 429 : 502, {
      status:"error",
      code:paidPlan ? "PLAN_REQUIRED" : rateLimited ? "RATE_LIMIT" : "UPSTREAM_ERROR",
      message
    });
  }
};
