"use strict";

const { connect, readJson, writeJson } = require("./runtime-store");
const { readJson: readGithubJson } = require("./github-store");

const MAX_RESULTS = 100;
const MAX_SYMBOLS = 100;
const DATA_PATH = "shared/dashboard.json";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function cleanText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sanitizeResults(results) {
  if (!Array.isArray(results)) return [];

  const unique = new Map();
  for (const item of results) {
    const key = cleanText(item?.symbol || item?.resolvedSymbol, 40).toUpperCase();
    if (!key) continue;
    unique.set(key, item);
  }

  return [...unique.values()].slice(0, MAX_RESULTS).map(item => ({
    symbol: cleanText(item.symbol, 40),
    resolvedSymbol: cleanText(item.resolvedSymbol, 40),
    resolvedExchange: cleanText(item.resolvedExchange, 30),
    tradingViewSymbol: cleanText(item.tradingViewSymbol, 80),
    companyName: cleanText(item.companyName, 120),
    kind: cleanText(item.kind, 20),
    label: cleanText(item.label, 30),
    price: finiteOrNull(item.price),
    rsi: finiteOrNull(item.rsi),
    rsiAverage: finiteOrNull(item.rsiAverage),
    threeMonthPosition: finiteOrNull(item.threeMonthPosition),
    oneYearPosition: finiteOrNull(item.oneYearPosition),
    buyScore: finiteOrNull(item.buyScore),
    sellScore: finiteOrNull(item.sellScore),
    upsidePotential: finiteOrNull(item.upsidePotential),
    downsidePotential: finiteOrNull(item.downsidePotential),
    fibonacciRatio: finiteOrNull(item.fibonacciRatio),
    fibonacciPrice: finiteOrNull(item.fibonacciPrice),
    fibonacciTargetPrice: finiteOrNull(item.fibonacciTargetPrice),
    fibonacciTargetPotential: finiteOrNull(item.fibonacciTargetPotential),
    fibonacciSupportPrice: finiteOrNull(item.fibonacciSupportPrice),
    fibonacciSupportDownside: finiteOrNull(item.fibonacciSupportDownside),
    fibonacciBuyScore: finiteOrNull(item.fibonacciBuyScore),
    fibonacciSellScore: finiteOrNull(item.fibonacciSellScore),
    volumeCurrent: finiteOrNull(item.volumeCurrent),
    volumeAverage20: finiteOrNull(item.volumeAverage20),
    volumeRatio: finiteOrNull(item.volumeRatio),
    volumeScore: finiteOrNull(item.volumeScore),
    volumeLabel: cleanText(item.volumeLabel, 30),
    confidence: finiteOrNull(item.confidence),
    ema20: finiteOrNull(item.ema20),
    ema50: finiteOrNull(item.ema50),
    ema200: finiteOrNull(item.ema200),
    macdValue: finiteOrNull(item.macdValue),
    macdSignal: finiteOrNull(item.macdSignal),
    macdHistogram: finiteOrNull(item.macdHistogram),
    macdBullish: Boolean(item.macdBullish),
    bollingerUpper: finiteOrNull(item.bollingerUpper),
    bollingerMiddle: finiteOrNull(item.bollingerMiddle),
    bollingerLower: finiteOrNull(item.bollingerLower),
    bollingerPosition: finiteOrNull(item.bollingerPosition),
    atr: finiteOrNull(item.atr),
    atrPercent: finiteOrNull(item.atrPercent),
    crv: finiteOrNull(item.crv),
    crvTarget: finiteOrNull(item.crvTarget),
    crvStop: finiteOrNull(item.crvStop),
    trendScore: finiteOrNull(item.trendScore),
    momentumScore: finiteOrNull(item.momentumScore),
    riskScore: finiteOrNull(item.riskScore),
    chanceScore: finiteOrNull(item.chanceScore),
    marketReturn: finiteOrNull(item.marketReturn),
    relativeStrengthMarket: finiteOrNull(item.relativeStrengthMarket),
    sectorReturn: finiteOrNull(item.sectorReturn),
    relativeStrengthSector: finiteOrNull(item.relativeStrengthSector),
    currency: cleanText(item.currency, 10),
    eurRate: finiteOrNull(item.eurRate),
    rank: finiteOrNull(item.rank),
    error: item.error ? cleanText(item.error, 500) : null
  }));
}


async function readDashboardWithMigration() {
  const stored = await readJson(DATA_PATH);
  if (stored.data) return stored.data;

  // Einmalige Migration des bisher gemeinsam gespeicherten GitHub-Standes.
  // GitHub wird hierbei NUR GELESEN. Es wird niemals mehr zur Laufzeit committed.
  try {
    const legacy = await readGithubJson(DATA_PATH);
    if (legacy.data) {
      await writeJson(DATA_PATH, legacy.data);
      console.log("[Runtime Store] Alter gemeinsamer Dashboard-Stand aus GitHub nach Netlify Blobs migriert.");
      return legacy.data;
    }
  } catch (error) {
    console.warn("[Runtime Store] GitHub-Migration nicht möglich:", error.message);
  }

  return null;
}

exports.handler = async function handler(event) {
  connect(event);

  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json(405, { status: "error", message: "Nur GET und POST sind erlaubt." });
  }

  try {
    if (event.httpMethod === "GET") {
      return json(200, {
        status: "ok",
        dashboard: await readDashboardWithMigration(),
        storage: "netlify-blobs"
      });
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { status: "error", message: "Ungültige JSON-Daten." });
    }

    const updatedBy = cleanText(body.updatedBy, 40);
    if (!updatedBy) {
      return json(400, { status: "error", message: "Ein Erstellername ist erforderlich." });
    }

    const symbols = Array.isArray(body.symbols)
      ? [...new Set(body.symbols.map(value => cleanText(value, 40)).filter(Boolean))].slice(0, MAX_SYMBOLS)
      : [];

    const existingDashboard = await readDashboardWithMigration();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());

    const previousCredits = existingDashboard?.apiUsageDate === today
      ? Number(existingDashboard?.apiCreditsToday || 0)
      : 0;

    const dashboard = {
      version: 2,
      updatedBy,
      updatedAt: new Date().toISOString(),
      apiUsageDate: today,
      apiCreditsToday: previousCredits + Number(body.runCredits || 0),
      lastRunCredits: Number(body.runCredits || 0),
      interval: cleanText(body.interval, 20) || "1h",
      marketBenchmark: cleanText(body.marketBenchmark, 30) || "SPY",
      sectorBenchmark: cleanText(body.sectorBenchmark, 30) ||
        (symbols.map(v => String(v).toUpperCase()).includes("INTC") ? "SOXX" : ""),
      rsiLength: Number(body.rsiLength) || 14,
      rsiMaLength: Number(body.rsiMaLength) || 14,
      buyThreshold: Number(body.buyThreshold) || 70,
      sellThreshold: Number(body.sellThreshold) || 70,
      minimumPotential: Number(body.minimumPotential) || 5,
      crossLookback: Number(body.crossLookback) || 3,
      investmentAmount: Number(body.investmentAmount) || 1000,
      symbols,
      results: sanitizeResults(body.results)
    };

    await writeJson(DATA_PATH, dashboard);

    return json(200, {
      status: "ok",
      dashboard,
      storage: "netlify-blobs"
    });
  } catch (error) {
    return json(500, {
      status: "error",
      message: error instanceof Error ? error.message : "Runtime-Speicherfehler."
    });
  }
};
