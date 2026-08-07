"use strict";

const API_VERSION = "2022-11-28";

function envConfig() {
  return {
    token: process.env.GITHUB_DASHBOARD_TOKEN,
    owner: process.env.GITHUB_DASHBOARD_OWNER || "Foxilla92",
    repo: process.env.GITHUB_DASHBOARD_REPO || "Fox-Friends-Aktien-Dashboard",
    branch: process.env.GITHUB_DASHBOARD_BRANCH || "main"
  };
}

function headers(token) {
  return {
    "Accept": "application/vnd.github+json",
    "Authorization": `Bearer ${token}`,
    "X-GitHub-Api-Version": API_VERSION,
    "User-Agent": "fox-friends-aktien-dashboard"
  };
}

function apiUrl(owner, repo, path) {
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
}

async function readJson(path) {
  const cfg = envConfig();
  if (!cfg.token) throw new Error("GITHUB_DASHBOARD_TOKEN fehlt.");
  const url = new URL(apiUrl(cfg.owner, cfg.repo, path));
  url.searchParams.set("ref", cfg.branch);
  const response = await fetch(url, { headers: headers(cfg.token) });
  if (response.status === 404) return { data: null, sha: null };
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `GitHub-Lesefehler ${response.status}`);
  const decoded = Buffer.from(String(result.content || "").replace(/\n/g, ""), "base64").toString("utf8");
  return { data: JSON.parse(decoded), sha: result.sha || null };
}

async function writeJson(path, data, message) {
  const cfg = envConfig();
  const existing = await readJson(path);

  // Kein Commit, wenn sich der gespeicherte Inhalt überhaupt nicht verändert hat.
  // Das reduziert unnötige GitHub-Aktivität zusätzlich.
  if (existing.data !== null) {
    try {
      if (JSON.stringify(existing.data) === JSON.stringify(data)) {
        console.log(`[GitHub Store] Unverändert, kein Commit: ${path}`);
        return data;
      }
    } catch {}
  }

  const payload = {
    message,
    content: Buffer.from(JSON.stringify(data, null, 2), "utf8").toString("base64"),
    branch: cfg.branch,
    committer: { name: "Fox Friends Dashboard", email: "dashboard@users.noreply.github.com" }
  };
  if (existing.sha) payload.sha = existing.sha;

  const response = await fetch(apiUrl(cfg.owner, cfg.repo, path), {
    method: "PUT",
    headers: { ...headers(cfg.token), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `GitHub-Schreibfehler ${response.status}`);
  return data;
}

module.exports = { readJson, writeJson };
