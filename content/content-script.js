// NaviMind - content script (message bridge in the page)
// Listens for requests from the side panel and responds with page data,
// or highlights/scrolls to matching text (supports "Find on page").

(function () {
  "use strict";

  // Avoid double-binding if the script is injected more than once.
  if (window.__navaiBound) return;
  window.__navaiBound = true;

  function clearHighlights() {
    document.querySelectorAll("mark.navai-hit").forEach((m) => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
  }

  // Highlight the first occurrence of a phrase and scroll it into view.
  function highlightText(query) {
    clearHighlights();
    if (!query) return { found: false };
    const needle = query.toLowerCase();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (!node.nodeValue || !node.nodeValue.trim())
            return NodeFilter.FILTER_REJECT;
          const p = node.parentNode;
          if (p && /^(script|style|noscript)$/i.test(p.nodeName))
            return NodeFilter.FILTER_REJECT;
          return node.nodeValue.toLowerCase().includes(needle)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      }
    );
    const node = walker.nextNode();
    if (!node) return { found: false };

    const value = node.nodeValue;
    const idx = value.toLowerCase().indexOf(needle);
    const range = document.createRange();
    range.setStart(node, idx);
    range.setEnd(node, idx + query.length);
    const mark = document.createElement("mark");
    mark.className = "navai-hit";
    mark.style.cssText =
      "background:#ffd54a;color:#1a1a1a;padding:0 2px;border-radius:2px;";
    try {
      range.surroundContents(mark);
      mark.scrollIntoView({ behavior: "smooth", block: "center" });
      return { found: true };
    } catch (_) {
      return { found: false };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "NAVAI_EXTRACT") {
      try {
        const data =
          typeof window.__navaiExtract === "function"
            ? window.__navaiExtract()
            : null;
        sendResponse({ ok: !!data, data });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
      return true;
    }
    if (message?.type === "NAVAI_HIGHLIGHT") {
      sendResponse(highlightText(message.query || ""));
      return true;
    }
    if (message?.type === "NAVAI_CLEAR_HIGHLIGHT") {
      clearHighlights();
      sendResponse({ ok: true });
      return true;
    }
  });
})();
