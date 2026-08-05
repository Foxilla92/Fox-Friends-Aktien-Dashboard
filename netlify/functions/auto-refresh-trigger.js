"use strict";

async function triggerBackground(triggerName) {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL;
  if (!base) {
    throw new Error("Netlify-Site-URL ist nicht verfügbar.");
  }

  const endpoint = new URL("/.netlify/functions/auto-refresh-background", base);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-fox-trigger": triggerName
    },
    body: JSON.stringify({ trigger: triggerName })
  });

  const text = await response.text();
  console.log(`[${triggerName}] Background-Antwort HTTP ${response.status}: ${text}`);

  if (!response.ok) {
    throw new Error(`Background-Aufruf fehlgeschlagen: HTTP ${response.status}`);
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      status: "started",
      trigger: triggerName,
      backgroundStatus: response.status
    })
  };
}

module.exports = { triggerBackground };
