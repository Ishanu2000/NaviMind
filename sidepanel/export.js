"use strict";

const $ = (sel) => document.querySelector(sel);

/* ─────────────── Markdown-lite → safe HTML (mirrors sidepanel.js) ──────────────── */
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
  let list = null;
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

async function init() {
  const { navai_export } = await chrome.storage.session.get("navai_export");
  const data = navai_export || { messages: [] };

  document.title = data.pageTitle ? `NaviMind chat - ${data.pageTitle}` : "NaviMind chat";
  const metaParts = [data.pageTitle, data.generatedAt ? new Date(data.generatedAt).toLocaleString() : ""].filter(Boolean);
  $("#doc-meta").textContent = metaParts.join(" • ");

  const thread = $("#export-thread");
  if (!data.messages || !data.messages.length) {
    thread.innerHTML = "<p>No messages to show.</p>";
  } else {
    for (const m of data.messages) {
      const wrap = document.createElement("div");
      wrap.className = "msg " + (m.role === "user" ? "user" : "ai");
      const role = document.createElement("div");
      role.className = "role";
      role.textContent = m.role === "user" ? "You" : "NaviMind";
      const bubble = document.createElement("div");
      bubble.className = "bubble";
      bubble.innerHTML = renderMarkdown(m.content);
      wrap.append(role, bubble);
      thread.appendChild(wrap);
    }
  }

  await chrome.storage.session.remove("navai_export");
}

$("#btn-print").addEventListener("click", () => window.print());
document.addEventListener("DOMContentLoaded", init);
