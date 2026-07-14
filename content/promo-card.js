// NaviMind - first-visit promo card
// Shows a small dismissible card on the first load of each tab, inviting
// the user to try NaviMind. Persists a "don't show again" choice in
// chrome.storage.local; re-appears on every tab otherwise.

(function () {
  "use strict";

  if (window.__navaiPromoBound) return;
  window.__navaiPromoBound = true;

  const AUTO_DISMISS_MS = 14000;

  try {
    chrome.storage.local.get("navai_hide_promo", ({ navai_hide_promo }) => {
      if (chrome.runtime.lastError) {
        console.error("NaviMind promo card: storage read failed -", chrome.runtime.lastError.message);
        return;
      }
      if (navai_hide_promo) return;
      showCard();
    });
  } catch (err) {
    console.error("NaviMind promo card: failed to start -", err);
  }

  function showCard() {
    if (document.getElementById("navai-promo-host")) return;
    const host = document.createElement("div");
    host.id = "navai-promo-host";
    host.style.cssText = "all:initial; display:block; position:fixed; z-index:2147483647; bottom:20px; right:20px;";
    document.documentElement.appendChild(host);
    console.log("NaviMind: promo card shown");

    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .card {
          all: initial;
          font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
          display: block; width: 272px; box-sizing: border-box;
          background: #ffffff; color: #10202b;
          border: 1px solid #dde5e8; border-radius: 14px;
          box-shadow: 0 10px 30px rgba(16, 32, 43, 0.18);
          padding: 14px 14px 12px; position: relative;
          animation: navai-in 0.22s ease-out;
        }
        @keyframes navai-in {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: none; }
        }
        .close {
          position: absolute; top: 6px; right: 6px; border: none; background: transparent;
          color: #6b7a84; cursor: pointer; font-size: 16px; line-height: 1; padding: 6px;
          border-radius: 6px; font-family: inherit;
        }
        .close:hover { background: #f2f6f7; color: #10202b; }
        .title {
          font-weight: 700; font-size: 14px; margin: 0 22px 4px 0;
          display: flex; align-items: center; gap: 6px;
        }
        .sub { font-size: 12.5px; color: #40515c; margin: 0 0 12px; line-height: 1.4; }
        .primary {
          all: initial; box-sizing: border-box; display: block; width: 100%;
          font-family: inherit; background: #0b6e6e; color: #fff; border: none;
          border-radius: 8px; padding: 8px 10px; font-weight: 700; font-size: 12.5px;
          text-align: center; cursor: pointer;
        }
        .primary:hover { background: #0a5a5a; }
        .dismiss {
          all: initial; box-sizing: border-box; display: block; margin-top: 6px;
          font-family: inherit; background: none; border: none; color: #6b7a84;
          font-size: 12px; cursor: pointer; padding: 6px; text-decoration: underline;
        }
        .dismiss:hover { color: #10202b; }
      </style>
      <div class="card" role="dialog" aria-label="NaviMind smart navigation">
        <button class="close" aria-label="Close">&times;</button>
        <p class="title">👋 Hi! Want smart navigation?</p>
        <p class="sub">NaviMind can answer questions about this page, just ask.</p>
        <button class="primary">Try it</button>
        <button class="dismiss">Don't show again</button>
      </div>
    `;

    const remove = () => host.remove();
    const timer = setTimeout(remove, AUTO_DISMISS_MS);

    shadow.querySelector(".close").addEventListener("click", remove);
    shadow.querySelector(".primary").addEventListener("click", () => {
      clearTimeout(timer);
      chrome.runtime.sendMessage({ type: "NAVAI_OPEN_PANEL" });
      remove();
    });
    shadow.querySelector(".dismiss").addEventListener("click", () => {
      clearTimeout(timer);
      chrome.storage.local.set({ navai_hide_promo: true });
      remove();
    });
  }
})();
