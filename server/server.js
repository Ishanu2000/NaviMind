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

// Per-token rate limit so one tester's code can't drain the shared key pool.
// RATE_LIMIT is requests per token per rolling hour.
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || 60;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
// In-memory only: resets when the Render free instance restarts or sleeps
// (~15 min idle). Acceptable for a single-instance user-study deployment -
// not durable across restarts and not shared across multiple instances.
const rateLimitState = new Map(); // token -> { count, windowStart }

function checkRateLimit(token) {
  const now = Date.now();
  const entry = rateLimitState.get(token);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitState.set(token, { count: 1, windowStart: now });
    return { limited: false };
  }
  entry.count++;
  if (entry.count <= RATE_LIMIT) return { limited: false };
  const remainingMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
  return {
    limited: true,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
    minutesRemaining: Math.ceil(remainingMs / 60000),
  };
}

let keyCursor = 0;

// If ALLOWED_ORIGINS (comma-separated) is set, only those exact origins are
// allowed. Otherwise any chrome-extension:// origin is accepted, since
// unpacked extensions get a random ID per machine, so a specific ID can't be
// pinned by default without breaking on every other machine that loads it.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
  : null;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS) return ALLOWED_ORIGINS.includes(origin);
  return origin.startsWith("chrome-extension://");
}

function corsHeaders(origin) {
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Vary": "Origin",
  };
  if (isAllowedOrigin(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
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
  const origin = req.headers.origin;

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  // No auth, no rate limit, no origin check - uptime pingers and the study
  // operator's pre-session warmup ping send no Origin header at all, and
  // must still get through to wake the Render free instance.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { ...corsHeaders(origin), "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/chat") {
    res.writeHead(404, corsHeaders(origin));
    res.end("Not found");
    return;
  }

  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", async () => {
    // Drain the request body before writing any response, even for
    // rejections - ending the response early can make a reverse proxy (e.g.
    // Render/Cloudflare) reset the connection instead of delivering it.
    if (!isAllowedOrigin(origin)) {
      res.writeHead(403, corsHeaders(origin));
      res.end("Origin not allowed");
      return;
    }

    const auth = req.headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!TESTER_TOKENS.has(token)) {
      res.writeHead(401, corsHeaders(origin));
      res.end("Invalid or missing tester access code");
      return;
    }

    const rate = checkRateLimit(token);
    if (rate.limited) {
      res.writeHead(429, { ...corsHeaders(origin), "Retry-After": String(rate.retryAfterSeconds) });
      res.end(`Rate limit exceeded for this access code. Try again in ${rate.minutesRemaining} minute(s).`);
      return;
    }

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      res.writeHead(400, corsHeaders(origin));
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
      res.writeHead(upstream.status, {
        ...corsHeaders(origin),
        "Content-Type": "text/event-stream",
        // Render/Cloudflare already streamed incrementally in testing without
        // this, but it's free insurance against buffering under different
        // response sizes or proxy behavior - FR5 depends on word-by-word
        // delivery, so this stays even though it wasn't strictly required.
        "X-Accel-Buffering": "no",
      });
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
      res.writeHead(502, corsHeaders(origin));
      res.end("Proxy error: " + err.message);
    }
  });
});

server.listen(PORT, () => {
  console.log(`NaviMind proxy listening on http://localhost:${PORT}`);
});
