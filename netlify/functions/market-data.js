"use strict";

const { readJson, writeJson } = require("./github-store");

const ALLOWED_INTERVALS = new Set(["30min", "1h", "2h", "4h", "1day"]);
const SYMBOL_PATTERN = /^[A-Z0-9 ÄÖÜ:._-]{1,60}$/;

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
  const normalized = String(input || "").trim().toUpperCase();
  const known = {
    "SIE": { symbol:"SIE", exchange:"XETRA", expectedName:"Siemens" },
    "SIEMENS": { symbol:"SIE", exchange:"XETRA", expectedName:"Siemens" },
    "ENR": { symbol:"ENR", exchange:"XETRA", expectedName:"Siemens Energy" },
    "SIEMENS ENERGY": { symbol:"ENR", exchange:"XETRA", expectedName:"Siemens Energy" },
    "DRO": { symbol:"DRO", exchange:"ASX", expectedName:"DroneShield" },
    "DRH": { symbol:"DRO", exchange:"ASX", expectedName:"DroneShield" },
    "DRONESHIELD": { symbol:"DRO", exchange:"ASX", expectedName:"DroneShield" },
    "DRONE SHIELD": { symbol:"DRO", exchange:"ASX", expectedName:"DroneShield" }
  };
  if (known[normalized]) return { ...known[normalized], original:normalized };
  if (!normalized.includes(":")) return { symbol:normalized, exchange:"", expectedName:"", original:normalized };
  const [prefix, symbol] = normalized.split(":", 2);
  const aliases = { NASDAQ:"NASDAQ", NYSE:"NYSE", XETR:"XETRA", XETRA:"XETRA", LSE:"LSE", ASX:"ASX" };
  return { symbol, exchange:aliases[prefix] || prefix, expectedName:"", original:normalized };
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


async function getEurRate(apiKey) {
  const today = berlinDate();
  const path = "shared/cache/FX_USD_EUR.json";
  const stored = await readJson(path);
  if (stored.data?.date === today && Number.isFinite(Number(stored.data?.rate))) {
    return { rate: Number(stored.data.rate), creditsUsed: 0 };
  }

  // Bevorzugt USD/EUR direkt. Falls der Feed das Paar nicht akzeptiert,
  // wird EUR/USD geladen und mathematisch umgedreht.
  try {
    const direct = await fetchTwelveSeries("USD/EUR", "1day", 5, apiKey, "");
    const rate = Number(direct.values?.at(-1)?.close);
    if (Number.isFinite(rate) && rate > 0) {
      await writeAuxCache(path, { date: today, rate }, "USD/EUR");
      return { rate, creditsUsed: 1 };
    }
  } catch (directError) {
    try {
      const inverse = await fetchTwelveSeries("EUR/USD", "1day", 5, apiKey, "");
      const eurUsd = Number(inverse.values?.at(-1)?.close);
      const rate = eurUsd > 0 ? 1 / eurUsd : NaN;
      if (Number.isFinite(rate)) {
        await writeAuxCache(path, { date: today, rate }, "EUR/USD");
        return { rate, creditsUsed: 1 };
      }
    } catch (inverseError) {
      console.warn("EUR-Umrechnung nicht verfügbar:", inverseError.message);
    }
  }
  return { rate: NaN, creditsUsed: 0 };
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
    cacheMode:"daily-only"
  });
  if (!SYMBOL_PATTERN.test(rawSymbol)) return response(400, { status:"error", message:"Ungültiges Aktiensymbol." });
  if (!ALLOWED_INTERVALS.has(interval)) return response(400, { status:"error", message:"Ungültiger Zeitraum." });

  const parsed = parseInput(rawSymbol);
  const today = berlinDate();

  try {
    const { path, cache } = await readAuxCache(parsed);

    let daily = cache.dailyDate === today ? cache.daily : null;
    let intraday = null;
    let creditsUsed = 0;

    if (!daily) {
      daily = await fetchTwelveSeries(parsed.symbol, "1day", 300, apiKey, parsed.exchange);
      creditsUsed += 1;
    }

    if (mode !== "benchmark") {
      intraday = await fetchTwelveSeries(parsed.symbol, interval, 450, apiKey, parsed.exchange);
      creditsUsed += 1;
    }

    if (cache.dailyDate !== today) {
      await writeAuxCache(path, { dailyDate: today, daily }, rawSymbol);
    }

    const meta = intraday?.meta || daily?.meta || {};
    const companyName = String(meta.name || meta.instrument_name || meta.symbol_name || parsed.expectedName || parsed.symbol);
    const rawExchange = String(meta.exchange || parsed.exchange || "").toUpperCase();
    if (parsed.exchange && rawExchange && !rawExchange.includes(parsed.exchange)) {
      throw new Error(`Falscher Handelsplatz geliefert: erwartet ${parsed.exchange}, erhalten ${rawExchange}.`);
    }
    if (parsed.expectedName && !companyName.toLowerCase().includes(parsed.expectedName.toLowerCase())) {
      throw new Error(`Symbol-Zuordnung stimmt nicht: erwartet ${parsed.expectedName}, erhalten ${companyName}. Bitte Börsenpräfix verwenden.`);
    }
    const inferredCurrency = ["NASDAQ","NYSE","AMEX","NYSE ARCA"].includes(rawExchange) ? "USD"
      : ["XETRA","GETTEX","FWB","TRADEGATE"].includes(rawExchange) ? "EUR"
      : "";
    const currency = String(meta.currency || inferredCurrency).toUpperCase();
    let eurRate = currency === "EUR" ? 1 : NaN;
    if (currency === "USD") {
      const fx = await getEurRate(apiKey);
      eurRate = fx.rate;
      creditsUsed += fx.creditsUsed;
    }
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
      companyName,
      currency,
      eurRate,
      intraday,
      daily,
      cacheInfo:{
        date:today,
        dailyFromCache:cache.dailyDate === today,
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
