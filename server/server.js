"use strict";

// Local proxy for NaviMind's zero-config mode. Holds the shared Groq keys
// and does the rotation/failover that used to live in the extension's
// client-side JS. The extension never sees a key, so nothing can be
// extracted by installing or unpacking it. Requires Node 18+ (global fetch).

const http = require("http");

// Keys come from the GROQ_KEYS env var (comma-separated) in deployed
// environments. Set it in the host's dashboard, never commit real keys.
// Locally, ./keys.local.js (gitignored, not committed) is a convenience
// fallback: copy keys.example.js to keys.local.js and fill it in.
let localKeys = [];
try {
  localKeys = require("./keys.local").GROQ_KEYS;
} catch { /* no local file, fine if GROQ_KEYS env var is set */ }

const GROQ_KEYS = process.env.GROQ_KEYS
  ? process.env.GROQ_KEYS.split(",").map((k) => k.trim()).filter(Boolean)
  : localKeys;

if (!GROQ_KEYS.length) {
  throw new Error(
    "No Groq keys configured. Set the GROQ_KEYS env var, or copy server/keys.example.js to server/keys.local.js and fill it in."
  );
}

// Per-tester tokens gate access to the proxy, same env-var-first pattern as
// the Groq keys above, so random people who find the URL can't burn the
// shared quota. Give each tester one token to paste into NaviMind's Settings.
let localTokens = [];
try {
  localTokens = require("./tokens.local").TESTER_TOKENS;
} catch { /* no local file, fine if TESTER_TOKENS env var is set */ }

const TESTER_TOKENS = new Set(
  process.env.TESTER_TOKENS
    ? process.env.TESTER_TOKENS.split(",").map((t) => t.trim()).filter(Boolean)
    : localTokens
);

if (!TESTER_TOKENS.size) {
  throw new Error(
    "No tester tokens configured. Set the TESTER_TOKENS env var, or copy server/tokens.example.js to server/tokens.local.js and fill it in."
  );
}

const PORT = process.env.PORT || 8787;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const RETRYABLE_STATUSES = new Set([401, 403, 429]);

let keyCursor = 0;

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

async function forwardToGroq(payload) {
  let last;
  for (let i = 0; i < GROQ_KEYS.length; i++) {
    const key = GROQ_KEYS[keyCursor % GROQ_KEYS.length];
    keyCursor++;
    const resp = await fetch(GROQ_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(payload),
    });
    if (resp.ok || !RETRYABLE_STATUSES.has(resp.status)) return resp;
    last = resp;
  }
  return last;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/chat") {
    res.writeHead(404, corsHeaders());
    res.end("Not found");
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    // Drain the request body before writing any response, even for auth
    // failures - ending the response early can make a reverse proxy (e.g.
    // Render/Cloudflare) reset the connection instead of delivering it.
    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!TESTER_TOKENS.has(token)) {
      res.writeHead(401, corsHeaders());
      res.end("Invalid or missing tester access code");
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, corsHeaders());
      res.end("Invalid JSON");
      return;
    }

    const payload = {
      model: body.model || "llama-3.3-70b-versatile",
      stream: true,
      messages: [{ role: "system", content: body.system || "" }, ...(body.messages || [])],
    };

    try {
      const upstream = await forwardToGroq(payload);
      res.writeHead(upstream.status, { ...corsHeaders(), "Content-Type": "text/event-stream" });
      if (!upstream.body) {
        res.end();
        return;
      }
      const reader = upstream.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (err) {
      res.writeHead(502, corsHeaders());
      res.end("Proxy error: " + err.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`NaviMind proxy listening on http://localhost:${PORT}`);
});
