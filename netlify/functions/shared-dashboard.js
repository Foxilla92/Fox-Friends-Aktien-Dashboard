"use strict";

const MAX_RESULTS = 100;
const MAX_SYMBOLS = 100;
const DATA_PATH = "shared/dashboard.json";
const API_VERSION = "2022-11-28";

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
  return results.slice(0, MAX_RESULTS).map(item => ({
    symbol: cleanText(item.symbol, 40),
    resolvedSymbol: cleanText(item.resolvedSymbol, 40),
    resolvedExchange: cleanText(item.resolvedExchange, 30),
    tradingViewSymbol: cleanText(item.tradingViewSymbol, 80),
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
    earningsAvailable: Boolean(item.earningsAvailable),
    nextEarningsDate: cleanText(item.nextEarningsDate, 20) || null,
    nextEarningsSession: cleanText(item.nextEarningsSession, 60),
    nextEpsEstimate: finiteOrNull(item.nextEpsEstimate),
    earningsUnavailableReason: cleanText(item.earningsUnavailableReason, 300),
    rank: finiteOrNull(item.rank),
    error: item.error ? cleanText(item.error, 500) : null
  }));
}

function githubHeaders(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "fox-friends-aktien-dashboard"
  };
}

function apiUrl(owner, repo) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${DATA_PATH}`;
}

async function readDashboard(owner, repo, token, branch) {
  const url = new URL(apiUrl(owner, repo));
  url.searchParams.set("ref", branch);

  const response = await fetch(url, { headers: githubHeaders(token) });

  if (response.status === 404) {
    return { dashboard: null, sha: null };
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `GitHub-Lesefehler (HTTP ${response.status}).`);
  }

  const decoded = Buffer.from(String(data.content || "").replace(/\n/g, ""), "base64").toString("utf8");
  return {
    dashboard: JSON.parse(decoded),
    sha: data.sha || null
  };
}

async function writeDashboard(owner, repo, token, branch, dashboard) {
  const existing = await readDashboard(owner, repo, token, branch);
  const content = Buffer.from(JSON.stringify(dashboard, null, 2), "utf8").toString("base64");

  const payload = {
    message: `Gemeinsamen Dashboard-Stand aktualisieren: ${dashboard.updatedBy}`,
    content,
    branch,
    committer: {
      name: "Fox Friends Dashboard",
      email: "dashboard@users.noreply.github.com"
    }
  };

  if (existing.sha) payload.sha = existing.sha;

  const response = await fetch(apiUrl(owner, repo), {
    method: "PUT",
    headers: {
      ...githubHeaders(token),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `GitHub-Schreibfehler (HTTP ${response.status}).`);
  }

  return dashboard;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  if (!["GET", "POST"].includes(event.httpMethod)) {
    return json(405, { status: "error", message: "Nur GET und POST sind erlaubt." });
  }

  const token = process.env.GITHUB_DASHBOARD_TOKEN;
  const owner = process.env.GITHUB_DASHBOARD_OWNER || "Foxilla92";
  const repo = process.env.GITHUB_DASHBOARD_REPO || "Fox-Friends-Aktien-Dashboard";
  const branch = process.env.GITHUB_DASHBOARD_BRANCH || "main";

  if (!token) {
    return json(500, {
      status: "error",
      message: "In Netlify fehlt die Umgebungsvariable GITHUB_DASHBOARD_TOKEN."
    });
  }

  try {
    if (event.httpMethod === "GET") {
      const stored = await readDashboard(owner, repo, token, branch);
      return json(200, { status: "ok", dashboard: stored.dashboard });
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

    const dashboard = {
      version: 1,
      updatedBy,
      updatedAt: new Date().toISOString(),
      interval: cleanText(body.interval, 20) || "1h",
      marketBenchmark: cleanText(body.marketBenchmark, 30) || "SPY",
      sectorBenchmark: cleanText(body.sectorBenchmark, 30),
      rsiLength: Number(body.rsiLength) || 14,
      rsiMaLength: Number(body.rsiMaLength) || 14,
      buyThreshold: Number(body.buyThreshold) || 70,
      sellThreshold: Number(body.sellThreshold) || 70,
      minimumPotential: Number(body.minimumPotential) || 5,
      crossLookback: Number(body.crossLookback) || 3,
      symbols,
      results: sanitizeResults(body.results)
    };

    await writeDashboard(owner, repo, token, branch, dashboard);
    return json(200, { status: "ok", dashboard });
  } catch (error) {
    return json(500, {
      status: "error",
      message: error instanceof Error ? error.message : "GitHub-Speicherfehler."
    });
  }
};
