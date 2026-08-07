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
    "INTC": { symbol:"INTC", exchange:"NASDAQ", expectedName:"Intel", displayName:"Intel Corporation" },
    "AAPL": { symbol:"AAPL", exchange:"NASDAQ", expectedName:"Apple", displayName:"Apple Inc." },
    "MSFT": { symbol:"MSFT", exchange:"NASDAQ", expectedName:"Microsoft", displayName:"Microsoft Corporation" },
    "NVDA": { symbol:"NVDA", exchange:"NASDAQ", expectedName:"NVIDIA", displayName:"NVIDIA Corporation" },
    "AMD": { symbol:"AMD", exchange:"NASDAQ", expectedName:"Advanced Micro Devices", displayName:"Advanced Micro Devices, Inc." },
    "AMZN": { symbol:"AMZN", exchange:"NASDAQ", expectedName:"Amazon", displayName:"Amazon.com, Inc." },
    "GOOGL": { symbol:"GOOGL", exchange:"NASDAQ", expectedName:"Alphabet", displayName:"Alphabet Inc." },
    "META": { symbol:"META", exchange:"NASDAQ", expectedName:"Meta", displayName:"Meta Platforms, Inc." },
    "TSLA": { symbol:"TSLA", exchange:"NASDAQ", expectedName:"Tesla", displayName:"Tesla, Inc." },
    "SIE": { symbol:"SIE", exchange:"XETRA", expectedName:"Siemens", displayName:"Siemens AG" },
    "ENR": { symbol:"ENR", exchange:"XETRA", expectedName:"Siemens Energy", displayName:"Siemens Energy AG" },
    "RHM": { symbol:"RHM", exchange:"XETRA", expectedName:"Rheinmetall", displayName:"Rheinmetall AG" },
    "DRO": { symbol:"DRO", exchange:"ASX", expectedName:"DroneShield", displayName:"DroneShield Limited" }
  };
  if (known[normalized]) return { ...known[normalized], original:normalized };
  if (!normalized.includes(":")) return { symbol:normalized, exchange:"", expectedName:"", original:normalized };
  const [prefix, symbol] = normalized.split(":", 2);
  const aliases = { NASDAQ:"NASDAQ", NYSE:"NYSE", XETR:"XETRA", XETRA:"XETRA", LSE:"LSE", ASX:"ASX" };
  const explicit = { symbol, exchange:aliases[prefix] || prefix, expectedName:"", displayName:"", original:normalized };
  const exactKnown = known[symbol];
  if (exactKnown && exactKnown.exchange === explicit.exchange) {
    explicit.expectedName = exactKnown.expectedName;
    explicit.displayName = exactKnown.displayName || "";
  }
  return explicit;
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


async function getCurrencyToEurRate(currency, apiKey) {
  const source = String(currency || "").trim().toUpperCase();
  if (!source) return { rate: NaN, creditsUsed: 0, source: "none" };
  if (source === "EUR") return { rate: 1, creditsUsed: 0, source: "identity" };

  const today = berlinDate();
  const path = `shared/cache/FX_${safeKey(source)}_EUR.json`;
  const stored = await readJson(path);

  if (
    stored.data?.date === today &&
    Number.isFinite(Number(stored.data?.rate)) &&
    Number(stored.data.rate) > 0
  ) {
    return {
      rate: Number(stored.data.rate),
      creditsUsed: 0,
      source: stored.data.source || "cache"
    };
  }

  // 1. Primär: offizieller, kostenfreier Frankfurter-v1-Endpunkt.
  try {
    const url = new URL("https://api.frankfurter.dev/v1/latest");
    url.searchParams.set("base", source);
    url.searchParams.set("symbols", "EUR");

    const response = await fetch(url, {
      headers: { "Accept": "application/json" }
    });
    const text = await response.text();
    let data = null;
    try { data = JSON.parse(text); } catch {}

    const rate = Number(data?.rates?.EUR);
    if (!response.ok || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`Frankfurter HTTP ${response.status}`);
    }

    await writeAuxCache(path, {
      date: today,
      sourceCurrency: source,
      targetCurrency: "EUR",
      rate,
      source: "frankfurter"
    }, `${source}/EUR`);

    return { rate, creditsUsed: 0, source: "frankfurter" };
  } catch (frankfurterError) {
    console.warn(`Frankfurter ${source}/EUR fehlgeschlagen:`, frankfurterError.message);
  }

  // 2. Fallback: Twelve Data. Kostet höchstens einmal täglich einen Credit.
  if (apiKey) {
    try {
      const direct = await fetchTwelveSeries(`${source}/EUR`, "1day", 5, apiKey, "");
      const rate = Number(direct.values?.at(-1)?.close);

      if (Number.isFinite(rate) && rate > 0) {
        await writeAuxCache(path, {
          date: today,
          sourceCurrency: source,
          targetCurrency: "EUR",
          rate,
          source: "twelve-data"
        }, `${source}/EUR`);

        return { rate, creditsUsed: 1, source: "twelve-data" };
      }
    } catch (directError) {
      try {
        const inverse = await fetchTwelveSeries(`EUR/${source}`, "1day", 5, apiKey, "");
        const inverseRate = Number(inverse.values?.at(-1)?.close);
        const rate = inverseRate > 0 ? 1 / inverseRate : NaN;

        if (Number.isFinite(rate) && rate > 0) {
          await writeAuxCache(path, {
            date: today,
            sourceCurrency: source,
            targetCurrency: "EUR",
            rate,
            source: "twelve-data-inverse"
          }, `${source}/EUR`);

          return { rate, creditsUsed: 1, source: "twelve-data-inverse" };
        }
      } catch (inverseError) {
        console.warn(`Twelve Data ${source}/EUR fehlgeschlagen:`, inverseError.message);
      }
    }
  }

  // 3. Letzter vorhandener Cache, auch wenn er älter ist.
  const fallbackRate = Number(stored.data?.rate);
  if (Number.isFinite(fallbackRate) && fallbackRate > 0) {
    return {
      rate: fallbackRate,
      creditsUsed: 0,
      source: stored.data?.source || "stale-cache"
    };
  }

  return { rate: NaN, creditsUsed: 0, source: "unavailable" };
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
    const providerCompanyName = String(meta.name || meta.instrument_name || meta.symbol_name || "");
    const companyName = String(parsed.displayName || providerCompanyName || parsed.expectedName || parsed.symbol);
    const rawExchange = String(meta.exchange || parsed.exchange || "").toUpperCase();
    const providerSymbol = String(meta.symbol || parsed.symbol || "").toUpperCase();

    // Nie still auf ein anderes Wertpapier ausweichen.
    // Wenn Twelve Data das exakte Kürzel nicht liefert, wird ein Fehler ausgegeben.
    if (providerSymbol && providerSymbol !== String(parsed.symbol || "").toUpperCase()) {
      throw new Error(`Twelve Data lieferte ${providerSymbol} statt ${parsed.symbol}. Keine automatische Ersatzsuche durchgeführt.`);
    }
    if (parsed.exchange && rawExchange && !rawExchange.includes(parsed.exchange)) {
      throw new Error(`Falscher Handelsplatz geliefert: erwartet ${parsed.exchange}, erhalten ${rawExchange}.`);
    }
    if (parsed.expectedName && providerCompanyName && !providerCompanyName.toLowerCase().includes(parsed.expectedName.toLowerCase())) {
      throw new Error(`Symbol-Zuordnung stimmt nicht: erwartet ${parsed.expectedName}, erhalten ${companyName}. Bitte Börsenpräfix verwenden.`);
    }
    const inferredCurrency = ["NASDAQ","NYSE","AMEX","NYSE ARCA"].includes(rawExchange) ? "USD"
      : ["XETRA","GETTEX","FWB","TRADEGATE"].includes(rawExchange) ? "EUR"
      : "";
    const currency = String(meta.currency || inferredCurrency).toUpperCase();
    let eurRate = currency === "EUR" ? 1 : NaN;
    if (currency && currency !== "EUR") {
      const fx = await getCurrencyToEurRate(currency, apiKey);
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
      fxAvailable: Number.isFinite(eurRate) && eurRate > 0,
      intraday,
      daily,
      cacheInfo:{
        date:today,
        dailyFromCache:cache.dailyDate === today,
        creditsUsed
      },
      fetchedAt:new Date().toISOString()
    }, false);
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
