// NaviMind - background service worker (Manifest V3)
// Responsibilities:
//  1. Open the side panel when the toolbar icon is clicked.
//  2. Make the side panel available across tabs.
//  3. Provide a small relay so the panel can (re)inject the extractor into
//     pages that loaded before the extension was installed/updated.

// Let clicking the toolbar icon open the side panel.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.warn("NaviMind: could not set panel behavior", err));
});

// Some Chrome versions require an explicit open on click as a fallback.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ tabId: tab.id });
  } catch (err) {
    // openPanelOnActionClick already handled it - safe to ignore.
  }
});

// Relay: the side panel asks the background to make sure the content
// extractor is present on a tab (useful for tabs opened before install).
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "NAVAI_ENSURE_INJECTED" && message.tabId) {
    chrome.scripting
      .executeScript({
        target: { tabId: message.tabId },
        files: ["content/extractor.js", "content/content-script.js"],
      })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }

  // Relay: the first-visit promo card asks the background to open the side
  // panel, since chrome.sidePanel.open() isn't callable from a content script.
  if (message?.type === "NAVAI_OPEN_PANEL" && sender?.tab?.id != null) {
    chrome.sidePanel
      .open({ tabId: sender.tab.id })
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});
