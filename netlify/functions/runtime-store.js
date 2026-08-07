"use strict";

const { connectLambda, getStore } = require("@netlify/blobs");

const STORE_NAME = "fox-friends-runtime";
let connected = false;

function connect(event) {
  if (event && !connected) {
    connectLambda(event);
    connected = true;
  }
}

function store() {
  return getStore(STORE_NAME);
}

function keyFor(path) {
  return String(path || "")
    .trim()
    .replace(/^\/+/, "")
    .replace(/[^A-Za-z0-9._/-]/g, "_");
}

async function readJson(path) {
  const key = keyFor(path);
  if (!key) return { data: null, sha: null };

  const data = await store().get(key, {
    type: "json",
    consistency: "strong"
  });

  return { data: data ?? null, sha: null };
}

async function writeJson(path, data) {
  const key = keyFor(path);
  if (!key) throw new Error("Ungültiger Runtime-Speicherpfad.");

  await store().setJSON(key, data);
  return data;
}

async function deleteJson(path) {
  const key = keyFor(path);
  if (key) await store().delete(key);
}

module.exports = {
  connect,
  readJson,
  writeJson,
  deleteJson
};
