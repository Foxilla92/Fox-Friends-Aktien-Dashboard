"use strict";

const { triggerBackground } = require("./auto-refresh-trigger");

exports.handler = async function() {
  try {
    return await triggerBackground("09:15-Automatik");
  } catch (error) {
    console.error("[09:15-Automatik] Fehler:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ status: "error", message: error.message })
    };
  }
};
