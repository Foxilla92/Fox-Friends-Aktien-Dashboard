"use strict";

const { triggerBackground } = require("./auto-refresh-trigger");

function berlinTimeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);

  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function insideTradingWindow(date = new Date()) {
  const p = berlinTimeParts(date);
  const weekday = !["Sat", "Sun"].includes(p.weekday);
  const hour = Number(p.hour);
  const minute = Number(p.minute);
  const total = hour * 60 + minute;

  const start = 15 * 60 + 30; // 15:30
  const end = 22 * 60;        // 22:00
  const quarter = minute % 15 === 0;

  return weekday && quarter && total >= start && total <= end;
}

exports.handler = async function() {
  const p = berlinTimeParts();

  if (!insideTradingWindow()) {
    console.log(`[Marktfenster] Kein Refresh um ${p.hour}:${p.minute} Europe/Berlin.`);
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        status: "skipped",
        reason: "outside-market-window",
        berlinTime: `${p.hour}:${p.minute}`
      })
    };
  }

  try {
    console.log(`[Marktfenster] Starte automatische Prüfung um ${p.hour}:${p.minute}.`);
    return await triggerBackground(`Marktfenster ${p.hour}:${p.minute}`);
  } catch (error) {
    console.error("[Marktfenster] Trigger-Fehler:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ status: "error", message: error.message })
    };
  }
};
