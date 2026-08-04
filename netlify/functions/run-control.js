"use strict";

const { readJson, writeJson } = require("./github-store");
const PATH = "shared/run-state.json";
const MAX_AGE_MS = 20 * 60 * 1000;

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

function active(run) {
  if (!run?.running) return false;
  const expiry = new Date(run.expiresAt || 0).getTime();
  return Number.isFinite(expiry) && expiry > Date.now();
}

async function getRun() {
  const stored = await readJson(PATH);
  if (!active(stored.data)) {
    return {
      running: false,
      owner: "",
      mode: "",
      startedAt: null,
      expiresAt: null,
      lastAutomaticAt: stored.data?.lastAutomaticAt || null
    };
  }
  return stored.data;
}

async function acquire(owner, mode = "manual") {
  const current = await getRun();
  if (current.running) return current;
  const now = new Date();
  const run = {
    running: true,
    owner: owner || (mode === "automatic" ? "Automatik" : "Unbekannt"),
    mode,
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + MAX_AGE_MS).toISOString(),
    lastAutomaticAt: current.lastAutomaticAt || null
  };
  return writeJson(PATH, run, `Prüfung gestartet: ${run.owner}`);
}

async function release(owner, automatic = false) {
  const current = await getRun();
  const run = {
    running: false,
    owner: "",
    mode: "",
    startedAt: null,
    expiresAt: null,
    lastAutomaticAt: automatic ? new Date().toISOString() : current.lastAutomaticAt || null,
    lastCompletedBy: owner || current.owner || ""
  };
  return writeJson(PATH, run, `Prüfung beendet: ${owner || current.owner || "Dashboard"}`);
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") return json(200, { ok: true });
  try {
    if (event.httpMethod === "GET") {
      return json(200, { status: "ok", run: await getRun() });
    }
    const body = JSON.parse(event.body || "{}");
    if (body.action === "acquire") {
      return json(200, { status: "ok", run: await acquire(String(body.owner || ""), "manual") });
    }
    if (body.action === "release") {
      return json(200, { status: "ok", run: await release(String(body.owner || ""), false) });
    }
    return json(400, { status: "error", message: "Unbekannte Aktion." });
  } catch (error) {
    return json(500, { status: "error", message: error.message || "Sperrfehler." });
  }
};

module.exports.getRun = getRun;
module.exports.acquire = acquire;
module.exports.release = release;
