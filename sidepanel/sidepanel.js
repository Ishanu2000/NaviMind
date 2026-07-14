/* NaviMind - side panel controller
   Ties together: page context (Obj 1), AI chatbot (Obj 2), quick actions &
   find-on-page (Obj 4), accessibility (TTS/STT/keyboard), and the metrics +
   TAM survey used for user validation (Obj 3). */

"use strict";

/* ─────────────────────────── State ─────────────────────────── */
const state = {
  pageContext: null,      // last extracted page snapshot
  history: [],            // [{role:'user'|'assistant', content}]
  settings: null,         // {provider, apiKey, model}
  testerToken: "",        // access code for the shared proxy (zero-config mode)
  busy: false,
  currentTabId: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
};
const announce = (msg) => { $("#sr-status").textContent = msg; };

const svgIcon = (inner) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const ICON_VOLUME = svgIcon(
  '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>'
);
const ICON_STOP = svgIcon('<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>');
const ICON_THUMBS_UP = svgIcon(
  '<path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/>'
);
const ICON_THUMBS_DOWN = svgIcon(
  '<path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3z"/><path d="M17 2h3a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-3"/>'
);

/* ───────────────────────── Storage ─────────────────────────── */
async function loadSettings() {
  const { navai_settings, navai_tester_token } = await chrome.storage.local.get([
    "navai_settings",
    "navai_tester_token",
  ]);
  state.settings = navai_settings || { provider: "groq", apiKey: "", model: "" };
  state.testerToken = navai_tester_token || "";
}
async function loadPrefs() {
  const { navai_prefs } = await chrome.storage.local.get("navai_prefs");
  const p = navai_prefs || {};
  applyPrefs(p);
  $("#font-scale").value = p.fontScale || 100;
  $("#font-scale-out").textContent = (p.fontScale || 100) + "%";
  $("#toggle-contrast").checked = !!p.contrast;
  $("#toggle-theme").checked = !!p.dark;
  $("#toggle-autoread").checked = !!p.autoread;
  $("#toggle-automic").checked = !!p.automic;
}
async function savePrefs() {
  const p = {
    fontScale: Number($("#font-scale").value),
    contrast: $("#toggle-contrast").checked,
    dark: $("#toggle-theme").checked,
    autoread: $("#toggle-autoread").checked,
    automic: $("#toggle-automic").checked,
  };
  applyPrefs(p);
  await chrome.storage.local.set({ navai_prefs: p });
}
function applyPrefs(p) {
  document.documentElement.style.setProperty("--scale", (p.fontScale || 100) / 100);
  document.body.classList.toggle("contrast", !!p.contrast);
  document.body.classList.toggle("theme-dark", !!p.dark);
}

async function getMetrics() {
  const { navai_metrics } = await chrome.storage.local.get("navai_metrics");
  return navai_metrics || { queries: 0, times: [], up: 0, down: 0 };
}
async function setMetrics(m) { await chrome.storage.local.set({ navai_metrics: m }); }

/* ─────────────────── Page context (Objective 1) ───────────── */
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadPageContext() {
  const tab = await activeTab();
  if (!tab) return;
  state.currentTabId = tab.id;

  const restricted = /^(chrome|edge|about|chrome-extension|https:\/\/chromewebstore)/.test(tab.url || "");
  if (restricted) {
    setContextUI(null, "NaviMind can’t read this browser page. Open a website to get started.");
    return;
  }

  const ask = () =>
    new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: "NAVAI_EXTRACT" }, (res) => {
        if (chrome.runtime.lastError) {
          console.error("NaviMind loadPageContext: sendMessage failed -", chrome.runtime.lastError.message);
          return resolve(null);
        }
        resolve(res);
      });
    });

  let res = await ask();
  if (!res) {
    // Tab loaded before the extension existed - inject then retry.
    try {
      const injectRes = await chrome.runtime.sendMessage({ type: "NAVAI_ENSURE_INJECTED", tabId: tab.id });
      if (!injectRes?.ok) console.error("NaviMind loadPageContext: injection failed -", injectRes?.error);
    } catch (err) {
      console.error("NaviMind loadPageContext: NAVAI_ENSURE_INJECTED message failed -", err?.message || err);
    }
    await new Promise((r) => setTimeout(r, 250));
    res = await ask();
  }

  if (res?.ok && res.data) {
    state.pageContext = res.data;
    setContextUI(res.data);
  } else {
    if (res && !res.ok) console.error("NaviMind loadPageContext: extraction failed -", res.error);
    setContextUI(null, "Couldn’t read this page. Try Refresh after it finishes loading.");
  }
}

function setContextUI(data, message) {
  const titleEl = $("#pc-title");
  const statsEl = $("#pc-stats");
  const outlineBtn = $("#btn-outline");
  if (!data) {
    titleEl.textContent = message || "No page loaded";
    titleEl.title = "";
    statsEl.textContent = "";
    outlineBtn.hidden = true;
    renderOutline([]);
    return;
  }
  titleEl.textContent = data.title || data.url;
  titleEl.title = data.url;
  const words = data.wordCount ? `${data.wordCount.toLocaleString()} words` : "";
  const trunc = data.truncated ? " · trimmed for length" : "";
  statsEl.textContent = words + trunc;
  outlineBtn.hidden = !(data.outline && data.outline.length);
  renderOutline(data.outline || []);
}

function renderOutline(outline) {
  const panel = $("#outline-panel");
  panel.innerHTML = "";
  outline.forEach((h) => {
    const b = el("button", "outline-item");
    b.dataset.level = h.level;
    b.textContent = h.text;
    b.addEventListener("click", () => jumpTo(h.text));
    panel.appendChild(b);
  });
}

async function jumpTo(text) {
  const tab = await activeTab();
  chrome.tabs.sendMessage(tab.id, { type: "NAVAI_HIGHLIGHT", query: text }, () => {});
  announce("Jumped to: " + text);
}

/* ─────────────── Markdown-lite → safe HTML ──────────────────── */
function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function inline(s) {
  return esc(s)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}
function renderMarkdown(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  let html = "";
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(ul[1])}</li>`;
    } else if (ol) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(ol[1])}</li>`;
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html += `<p>${inline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

/* ─────────────────── Rendering messages ─────────────────────── */
function clearEmpty() { const e = $("#empty-state"); if (e) e.remove(); }

// Captured once at startup (before anything can remove it) so "New
// conversation" can restore the exact same hero markup.
let emptyStateTemplate = null;

function resetChat() {
  if (state.busy) return;
  state.history = [];
  const thread = $("#thread");
  thread.innerHTML = "";
  if (emptyStateTemplate) thread.appendChild(emptyStateTemplate.cloneNode(true));
  announce("Started a new conversation");
}

function addMessage(role, text) {
  clearEmpty();
  const wrap = el("div", `msg ${role}`);
  const roleEl = el("div", "role");
  roleEl.textContent = role === "user" ? "You" : "NaviMind";
  const bubble = el("div", "bubble");
  if (role === "user") bubble.textContent = text;
  else bubble.innerHTML = text ? renderMarkdown(text) : "";
  wrap.appendChild(roleEl);
  wrap.appendChild(bubble);
  $("#thread").appendChild(wrap);
  scrollThread();
  return { wrap, bubble };
}

function addTyping() {
  clearEmpty();
  const wrap = el("div", "msg ai");
  wrap.appendChild(Object.assign(el("div", "role"), { textContent: "NaviMind" }));
  const bubble = el("div", "bubble");
  const t = el("div", "typing");
  t.innerHTML = "<span></span><span></span><span></span>";
  bubble.appendChild(t);
  wrap.appendChild(bubble);
  $("#thread").appendChild(wrap);
  scrollThread();
  return { wrap, bubble };
}

function addAnswerActions(wrap, fullText) {
  const bar = el("div", "msg-actions");

  const read = el("button", "mini-btn");
  read.innerHTML = ICON_VOLUME + "Read aloud";
  read.addEventListener("click", () => speak(fullText, read));

  const copy = el("button", "mini-btn");
  copy.textContent = "⧉ Copy";
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(fullText);
    copy.textContent = "✓ Copied";
    setTimeout(() => (copy.textContent = "⧉ Copy"), 1500);
  });

  const up = el("button", "mini-btn up");
  up.setAttribute("aria-label", "Mark answer helpful");
  up.innerHTML = ICON_THUMBS_UP;
  const down = el("button", "mini-btn down");
  down.setAttribute("aria-label", "Mark answer not helpful");
  down.innerHTML = ICON_THUMBS_DOWN;
  up.addEventListener("click", () => feedback("up", up, down));
  down.addEventListener("click", () => feedback("down", up, down));

  bar.append(read, copy, up, down);
  wrap.appendChild(bar);
}

async function feedback(kind, up, down) {
  const m = await getMetrics();
  if (kind === "up") { m.up++; up.classList.add("active"); down.classList.remove("active"); }
  else { m.down++; down.classList.add("active"); up.classList.remove("active"); }
  await setMetrics(m);
  announce("Feedback recorded");
}

function scrollThread() {
  const t = $("#thread");
  t.scrollTop = t.scrollHeight;
}

/* ─────────────── AI provider abstraction (Obj 2) ────────────── */
const DEFAULT_MODELS = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-latest",
  gemini: "gemini-2.5-flash",
  groq: "llama-3.3-70b-versatile",
  openrouter: "meta-llama/llama-3.3-70b-instruct:free",
};

// Providers that speak the OpenAI /chat/completions format - same request
// shape, just a different base URL and key header.
const OPENAI_COMPATIBLE = {
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
};

// Zero-config mode: route through a local proxy server (see server/) that
// holds the shared Groq keys and does the rotation/failover. No key ever
// ships in this file, so nothing can be extracted by installing or
// unpacking the extension. Bringing your own key (any provider, via
// Settings) bypasses the proxy and talks to that provider directly.
const PROXY_URL = "http://localhost:8787/chat";
const DEFAULT_SETTINGS = { provider: "groq", apiKey: null, model: DEFAULT_MODELS.groq };

function getEffectiveSettings() {
  const s = state.settings;
  return s && s.apiKey ? s : DEFAULT_SETTINGS;
}

function buildSystemPrompt() {
  const c = state.pageContext;
  let ctx = "No page content is currently available.";
  if (c) {
    const outline = (c.outline || [])
      .map((h) => `${"  ".repeat(h.level - 1)}- ${h.text}`)
      .join("\n");
    const links = (c.links || []).slice(0, 20)
      .map((l) => `- ${l.text}: ${l.href}`)
      .join("\n");
    ctx =
`PAGE TITLE: ${c.title}
URL: ${c.url}
DESCRIPTION: ${c.description || "(none)"}

OUTLINE:
${outline || "(no headings)"}

KEY LINKS:
${links || "(none)"}

PAGE CONTENT${c.truncated ? " (truncated)" : ""}:
${c.text}`;
  }
  return (
`You are NaviMind, an assistant embedded in a browser side panel. You help the user \
understand and navigate the web page they are currently viewing.

Rules:
- Answer using the PAGE CONTENT below whenever possible.
- Be concise and well organised. Use short paragraphs and bullet lists.
- When useful, refer to the page's section headings so the user knows where to look.
- If the answer is not on the page, say so clearly and suggest where it might be found.
- Never invent facts about the page.

--- CURRENT PAGE CONTEXT ---
${ctx}
--- END CONTEXT ---`
  );
}

async function streamChat(system, history, onDelta) {
  const eff = getEffectiveSettings();

  if (eff !== DEFAULT_SETTINGS) {
    const model = eff.model || DEFAULT_MODELS[eff.provider];
    return requestOnce(eff.provider, eff.apiKey, model, system, history, onDelta);
  }

  return requestOnce("proxy", state.testerToken, DEFAULT_SETTINGS.model, system, history, onDelta);
}

async function requestOnce(provider, apiKey, model, system, history, onDelta) {
  let url, headers, body, extract;

  if (provider === "proxy") {
    if (!apiKey) throw new Error("NO_TESTER_TOKEN");
    url = PROXY_URL;
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    body = { model, system, messages: history };
    extract = (j) => j.choices?.[0]?.delta?.content || "";
  } else if (OPENAI_COMPATIBLE[provider]) {
    url = OPENAI_COMPATIBLE[provider];
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    if (provider === "openrouter") headers["X-Title"] = "NaviMind"; // optional attribution
    body = { model, stream: true, messages: [{ role: "system", content: system }, ...history] };
    extract = (j) => j.choices?.[0]?.delta?.content || "";
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = { model, max_tokens: 1024, system, stream: true, messages: history };
    extract = (j) => (j.type === "content_block_delta" ? j.delta?.text || "" : "");
  } else if (provider === "gemini") {
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
    headers = { "Content-Type": "application/json" };
    body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: history.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
    };
    extract = (j) => j.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else {
    throw new Error("Unknown provider: " + provider);
  }

  const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`API ${resp.status}: ${detail.slice(0, 300)}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = extract(json);
        if (delta) { full += delta; onDelta(full); }
      } catch (_) { /* ignore keep-alive / partial */ }
    }
  }
  return full;
}

/* ───────────────────── Send flow ────────────────────────────── */
async function send(userText) {
  if (state.busy || !userText.trim()) return;
  const text = userText.trim();

  state.busy = true;
  $("#btn-send").disabled = true;
  addMessage("user", text);
  state.history.push({ role: "user", content: text });

  const typing = addTyping();
  const started = performance.now();

  try {
    const system = buildSystemPrompt();
    let answerWrap = null, answerBubble = null;
    const onDelta = (full) => {
      if (!answerBubble) {
        typing.wrap.remove();
        const m = addMessage("ai", "");
        answerWrap = m.wrap; answerBubble = m.bubble;
      }
      answerBubble.innerHTML = renderMarkdown(full);
      scrollThread();
    };

    const full = await streamChat(system, state.history, onDelta);

    if (!answerBubble) { // no stream deltas (edge case) - show whatever we got
      typing.wrap.remove();
      const m = addMessage("ai", full || "*(No response received.)*");
      answerWrap = m.wrap;
    }
    state.history.push({ role: "assistant", content: full });
    addAnswerActions(answerWrap, full);
    announce("Answer ready");

    // metrics
    const secs = (performance.now() - started) / 1000;
    const m = await getMetrics();
    m.queries++; m.times.push(Number(secs.toFixed(2)));
    if (m.times.length > 200) m.times = m.times.slice(-200);
    await setMetrics(m);

    if ($("#toggle-autoread").checked) speak(full);
  } catch (err) {
    typing.wrap.remove();
    handleError(err, getEffectiveSettings() === DEFAULT_SETTINGS);
  } finally {
    state.busy = false;
    $("#btn-send").disabled = false;
    $("#composer-input").focus();
  }
}

function handleError(err, usingProxy) {
  const msg = String(err.message || err);
  const bubble = addMessage("ai", "").bubble;
  let friendly;
  if (msg === "NO_TESTER_TOKEN") {
    friendly = "**No access code set.** Open **Settings** and paste the tester access code you were given, or add your own API key instead.";
  } else if (/API 401|API 403/.test(msg)) {
    friendly = usingProxy
      ? "**Access code rejected.** Open **Settings** and check the tester access code you were given."
      : "**Authentication failed.** Your API key looks invalid or lacks access. Open **Settings** to fix it.";
  } else if (/API 429/.test(msg)) {
    friendly = "**Busy right now.** Please wait a moment and try again.";
  } else if (/Failed to fetch|NetworkError/.test(msg)) {
    friendly = usingProxy
      ? "**Couldn’t reach the NaviMind proxy.** Make sure the local server is running (`node server/server.js`), or add your own API key in **Settings**."
      : "**Couldn’t reach the AI service.** Check your connection and that the provider host is allowed.";
  } else {
    friendly = "Something went wrong while answering.\n\n`" + msg + "`";
  }
  bubble.innerHTML = renderMarkdown(friendly);
  announce("Error");
}

// A short-lived visible message at the top of the thread (mic errors, etc.).
function flashNotice(text, ms = 9000) {
  const existing = document.getElementById("flash-notice");
  if (existing) existing.remove();
  const n = el("div", "notice");
  n.id = "flash-notice";
  n.textContent = text;
  $("#thread").prepend(n);
  if (ms) setTimeout(() => { if (n.isConnected) n.remove(); }, ms);
}

/* ─────────────── Quick actions (Objective 4) ────────────────── */
const PROMPTS = {
  summarize: "Give me a concise summary of this page in 3–5 sentences.",
  keypoints: "List the key points or takeaways from this page as bullet points.",
  outline: "Give me a structured outline of what this page covers, using its sections.",
  simplify: "Explain what this page is about in plain, simple language a beginner would understand.",
};
function quickAction(action) {
  if (action === "find") return startFind();
  const p = PROMPTS[action];
  if (p) send(p);
}

/* ─────────────────── Find on page ───────────────────────────── */
async function startFind() {
  const q = prompt("Find on this page:");
  if (!q) return;
  const tab = await activeTab();
  chrome.tabs.sendMessage(tab.id, { type: "NAVAI_HIGHLIGHT", query: q }, (res) => {
    if (chrome.runtime.lastError || !res) return;
    announce(res.found ? `Highlighted “${q}” on the page` : `“${q}” not found on the page`);
    if (!res.found) {
      // fall back to asking the AI where it might be
      send(`Where on this page can I find information about "${q}"?`);
    }
  });
}

/* ─────────────── Text-to-speech (accessibility) ─────────────── */
let speaking = false;
function speak(text, btn) {
  if (!("speechSynthesis" in window)) return;
  if (speaking) { window.speechSynthesis.cancel(); speaking = false;
    if (btn) btn.innerHTML = ICON_VOLUME + "Read aloud"; return; }
  const clean = text.replace(/[*_`#>]/g, "").replace(/\[(.*?)\]\(.*?\)/g, "$1");
  const u = new SpeechSynthesisUtterance(clean);
  u.rate = 1; u.onend = () => { speaking = false; if (btn) btn.innerHTML = ICON_VOLUME + "Read aloud"; };
  speaking = true;
  if (btn) btn.innerHTML = ICON_STOP + "Stop";
  window.speechSynthesis.speak(u);
}

/* ─────────────── Speech-to-text (voice input) ───────────────── */
function setupVoiceInput() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const mic = $("#btn-mic");
  if (!SR) {
    mic.disabled = true;
    mic.title = "Voice input isn't supported in this browser";
    flashNotice("Voice input isn't supported in this browser.");
    return { startListening: () => {} };
  }

  const rec = new SR();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  let listening = false;
  let micGranted = false;

  // The speech API won't raise a permission prompt on its own inside a side
  // panel, so we request microphone access explicitly the first time, then
  // stop the stream (we only needed the grant).
  async function ensureMic() {
    if (micGranted) return true;
    if (!navigator.mediaDevices?.getUserMedia) return true; // let start() try
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      micGranted = true;
      return true;
    } catch (err) {
      console.error(
        `NaviMind voice input: getUserMedia failed - name=${err?.name} message=${err?.message}`,
        err
      );
      const extId = chrome.runtime.id;
      const perMicMessages = {
        NotAllowedError: `Microphone access is blocked for NaviMind. Open chrome://settings/content/siteDetails?site=chrome-extension://${extId} and set Microphone to Allow, then tap the mic again.`,
        NotFoundError: "No microphone was found on this device.",
        NotReadableError: "The microphone couldn't be accessed - it may be in use by another app.",
        OverconstrainedError: "No microphone matches the requested settings.",
        SecurityError: "Microphone access is blocked by your browser or an organization policy.",
      };
      flashNotice(
        perMicMessages[err?.name] ||
          `NaviMind needs microphone access for voice input. Open chrome://settings/content/siteDetails?site=chrome-extension://${extId} and set Microphone to Allow, then tap the mic again.`
      );
      return false;
    }
  }

  async function beginRecognition() {
    try { rec.start(); }
    catch (err) {
      console.error(
        `NaviMind voice input: rec.start() failed - name=${err?.name} message=${err?.message}`,
        err
      );
      if (err?.name !== "InvalidStateError") flashNotice("Couldn't start voice input: " + (err?.message || err));
    }
  }

  async function startListening() {
    if (listening) return;
    if (!(await ensureMic())) return;
    await beginRecognition();
  }

  mic.addEventListener("click", () => {
    if (listening) { rec.stop(); return; }
    startListening();
  });

  rec.onstart = () => { listening = true; mic.classList.add("listening"); announce("Listening…"); };
  rec.onend = () => { listening = false; mic.classList.remove("listening"); };
  rec.onerror = (e) => {
    console.error("NaviMind voice input: recognition error", e.error, e);
    listening = false;
    mic.classList.remove("listening");
    const extId = chrome.runtime.id;
    const blockedMsg = `Microphone access is blocked. Open chrome://settings/content/siteDetails?site=chrome-extension://${extId} and set Microphone to Allow, then try again.`;
    const messages = {
      "not-allowed": blockedMsg,
      "service-not-allowed": blockedMsg,
      "no-speech": "Didn't catch anything - try speaking again.",
      "audio-capture": "No microphone was found on this device.",
      "network": "The speech service is unreachable right now.",
      "aborted": "",
    };
    const m = e.error in messages ? messages[e.error] : "Voice input error: " + e.error;
    if (m) flashNotice(m);
    announce(m || "Stopped listening");
  };
  rec.onresult = (e) => {
    let txt = "";
    for (let i = 0; i < e.results.length; i++) txt += e.results[i][0].transcript;
    const input = $("#composer-input");
    input.value = txt;
    autoGrow(input);
    input.focus();
  };

  return { startListening };
}

/* ─────────────────── Accessibility dialog ───────────────────── */
function openDialog(id) {
  const d = $(id); d.hidden = false;
  const focusable = d.querySelector("input, button, textarea");
  if (focusable) focusable.focus();
}
function closeDialog(id) { $(id).hidden = true; }

/* ─────────────────── Export chat as PDF ──────────────────────── */
async function exportChatAsPdf() {
  if (!state.history.length) {
    flashNotice("There's no conversation to download yet.");
    return;
  }
  await chrome.storage.session.set({
    navai_export: {
      pageTitle: state.pageContext?.title || "",
      generatedAt: Date.now(),
      messages: state.history,
    },
  });
  await chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/export.html") });
}

/* ─────────────────── Stats + TAM survey (Obj 3) ─────────────── */
const TAM_ITEMS = [
  { id: "pu1", text: "Using NaviMind would improve my browsing efficiency." },
  { id: "pu2", text: "NaviMind would make finding information on websites easier." },
  { id: "eou1", text: "Learning to use NaviMind was easy for me." },
  { id: "eou2", text: "Interacting with NaviMind is clear and understandable." },
  { id: "iu1", text: "I would use NaviMind regularly if it were available." },
];

async function openStats() {
  const m = await getMetrics();
  $("#stat-queries").textContent = m.queries;
  const avg = m.times.length ? (m.times.reduce((a, b) => a + b, 0) / m.times.length) : 0;
  $("#stat-time").textContent = m.times.length ? avg.toFixed(1) + "s" : "–";
  $("#stat-up").textContent = m.up;
  $("#stat-down").textContent = m.down;
  $("#tam-form").hidden = true;   // start collapsed each time
  $("#tam-thanks").hidden = true;
  openDialog("#stats-dialog");
}

function buildTamForm() {
  const fs = $("#tam-fields");
  fs.innerHTML = "";
  TAM_ITEMS.forEach((item) => {
    const div = el("div", "tam-item");
    div.innerHTML = `<p>${item.text}</p>`;
    const row = el("div", "likert");
    for (let v = 1; v <= 5; v++) {
      const label = el("label");
      label.innerHTML =
        `<input type="radio" name="${item.id}" value="${v}" required /> ${v}`;
      row.appendChild(label);
    }
    div.appendChild(row);
    fs.appendChild(div);
  });
}

async function submitTam(e) {
  e.preventDefault();
  const form = $("#tam-form");
  const data = {};
  for (const item of TAM_ITEMS) {
    const picked = form.querySelector(`input[name="${item.id}"]:checked`);
    if (!picked) return;
    data[item.id] = Number(picked.value);
  }
  data.comment = $("#tam-comment").value.trim();
  data.ts = Date.now();
  const { navai_tam } = await chrome.storage.local.get("navai_tam");
  const all = navai_tam || [];
  all.push(data);
  await chrome.storage.local.set({ navai_tam: all });
  form.reset();
  $("#tam-thanks").hidden = false;
  announce("Survey submitted. Thank you.");
  // Briefly show the confirmation, then collapse the form and close the dialog.
  setTimeout(() => {
    $("#tam-form").hidden = true;
    $("#tam-thanks").hidden = true;
    closeDialog("#stats-dialog");
  }, 1400);
}

/* ─────────────────── Utilities & wiring ─────────────────────── */
function autoGrow(t) {
  t.style.height = "auto";
  t.style.height = Math.min(t.scrollHeight, 120) + "px";
}

function wire() {
  // composer
  const input = $("#composer-input");
  input.addEventListener("input", () => autoGrow(input));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const v = input.value; input.value = ""; autoGrow(input);
      send(v);
    }
  });
  $("#composer").addEventListener("submit", (e) => {
    e.preventDefault();
    const v = input.value; input.value = ""; autoGrow(input);
    send(v);
  });

  // quick actions
  document.querySelectorAll(".chip").forEach((c) =>
    c.addEventListener("click", () => quickAction(c.dataset.action)));

  // page context
  $("#btn-refresh").addEventListener("click", async () => {
    const btn = $("#btn-refresh");
    if (btn.disabled) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = "Refreshing…";
    try {
      await loadPageContext();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });
  $("#btn-reset").addEventListener("click", resetChat);
  $("#btn-outline").addEventListener("click", () => {
    const panel = $("#outline-panel");
    const open = panel.hidden;
    panel.hidden = !open;
    $("#btn-outline").setAttribute("aria-expanded", String(open));
    $("#btn-outline").textContent = open ? "Hide outline" : "View outline";
  });

  // header buttons
  $("#btn-settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
  $("#btn-a11y").addEventListener("click", () => openDialog("#a11y-dialog"));
  $("#btn-stats").addEventListener("click", openStats);
  $("#btn-export").addEventListener("click", exportChatAsPdf);

  // dialog close + backdrop
  document.querySelectorAll(".dialog-backdrop").forEach((bd) => {
    bd.addEventListener("click", (e) => { if (e.target === bd) bd.hidden = true; });
    bd.querySelectorAll("[data-close]").forEach((btn) =>
      btn.addEventListener("click", () => (bd.hidden = true)));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape")
      document.querySelectorAll(".dialog-backdrop:not([hidden])").forEach((d) => (d.hidden = true));
  });

  // a11y prefs
  ["font-scale", "toggle-contrast", "toggle-theme", "toggle-autoread", "toggle-automic"].forEach((id) => {
    $("#" + id).addEventListener("input", () => {
      $("#font-scale-out").textContent = $("#font-scale").value + "%";
      savePrefs();
    });
  });

  // stats / TAM
  $("#btn-tam").addEventListener("click", () => {
    buildTamForm();
    $("#tam-form").hidden = false;
    $("#tam-thanks").hidden = true;
  });
  $("#tam-form").addEventListener("submit", submitTam);
  $("#btn-reset-stats").addEventListener("click", async () => {
    await setMetrics({ queries: 0, times: [], up: 0, down: 0 });
    openStats();
  });

  // react to tab changes so the context stays current
  chrome.tabs.onActivated.addListener(loadPageContext);
  chrome.tabs.onUpdated.addListener((tabId, info) => {
    if (info.status === "complete" && tabId === state.currentTabId) loadPageContext();
  });

  // Pick up settings the moment they're saved in the options page, so an
  // updated API key takes effect without reopening the panel.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.navai_settings) state.settings = changes.navai_settings.newValue || state.settings;
    if (changes.navai_tester_token) state.testerToken = changes.navai_tester_token.newValue || "";
  });
}

/* ─────────────────────── Init ───────────────────────────────── */
async function init() {
  const es = $("#empty-state");
  if (es) emptyStateTemplate = es.cloneNode(true);
  await loadSettings();
  await loadPrefs();
  wire();
  const voice = setupVoiceInput();
  await loadPageContext();
  if ($("#toggle-automic").checked) voice.startListening();
  else $("#composer-input").focus();
}

document.addEventListener("DOMContentLoaded", init);
