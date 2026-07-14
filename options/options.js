"use strict";

const HINTS = {
  gemini: {
    text: 'Free, no credit card. Create a key at aistudio.google.com → “Get API key”. Recommended model: <code>gemini-2.5-flash</code> (or <code>gemini-2.5-flash-lite</code> for more requests).',
    placeholder: "gemini-2.5-flash",
  },
  groq: {
    text: 'Free & fast, no credit card. Create a key at console.groq.com → API Keys. Default model: <code>llama-3.3-70b-versatile</code>. Note: token/day limits are tighter on long pages.',
    placeholder: "llama-3.3-70b-versatile",
  },
  openrouter: {
    text: 'Free models via one key. Create a key at openrouter.ai → Keys. Default: <code>meta-llama/llama-3.3-70b-instruct:free</code> (any model ID ending in <code>:free</code>).',
    placeholder: "meta-llama/llama-3.3-70b-instruct:free",
  },
  openai: {
    text: 'Paid (no reliable free tier). Create a key at platform.openai.com → API keys. Default model: <code>gpt-4o-mini</code>.',
    placeholder: "gpt-4o-mini",
  },
  anthropic: {
    text: 'Paid (no free tier). Create a key at console.anthropic.com → API keys. Default model: <code>claude-3-5-sonnet-latest</code>.',
    placeholder: "claude-3-5-sonnet-latest",
  },
};

const $ = (s) => document.querySelector(s);

function updateHint() {
  const p = $("#provider").value;
  $("#keyHint").innerHTML = HINTS[p].text;
  $("#model").placeholder = HINTS[p].placeholder;
}

async function load() {
  const { navai_settings, navai_tester_token } = await chrome.storage.local.get([
    "navai_settings",
    "navai_tester_token",
  ]);
  const s = navai_settings || { provider: "groq", apiKey: "", model: "" };
  $("#provider").value = s.provider;
  $("#apiKey").value = s.apiKey || "";
  $("#model").value = s.model || "";
  $("#testerToken").value = navai_tester_token || "";
  updateHint();
}

async function save() {
  const settings = {
    provider: $("#provider").value,
    apiKey: $("#apiKey").value.trim(),
    model: $("#model").value.trim(),
  };
  await chrome.storage.local.set({
    navai_settings: settings,
    navai_tester_token: $("#testerToken").value.trim(),
  });
  const saved = $("#saved");
  saved.hidden = false;
  setTimeout(() => (saved.hidden = true), 1800);
}

$("#provider").addEventListener("change", updateHint);
$("#toggleKey").addEventListener("click", () => {
  const k = $("#apiKey");
  const show = k.type === "password";
  k.type = show ? "text" : "password";
  $("#toggleKey").textContent = show ? "Hide" : "Show";
});
$("#save").addEventListener("click", save);
document.addEventListener("DOMContentLoaded", load);
