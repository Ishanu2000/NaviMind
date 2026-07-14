# NaviMind - AI-Powered Browser Extension for Intelligent Website Navigation

An in-browser assistant that turns any website into a conversation. NaviMind reads
the page you are viewing, understands its structure, and lets you ask
natural-language questions - getting instant, accessible, contextual answers in
a side panel.

Built as the deliverable for project **CT/2020/007** (BICT Hons, University of
Kelaniya).

---

## What it does

- **Reads the current page** - extracts the main text, heading outline, and key
  links, ignoring menus/ads/boilerplate.
- **Answers questions about it** - powered by your choice of Google Gemini,
  Groq, OpenRouter, OpenAI, or Anthropic, with streaming responses.
- **One-tap actions** - Summarize, Key points, Outline, Explain simply, Find on
  page.
- **Accessible by design** - keyboard-first, screen-reader announcements,
  read-aloud (text-to-speech), voice input (speech-to-text), adjustable text
  size, high-contrast and dark modes.
- **Built-in validation tools** - per-answer 👍/👎 feedback, usage metrics, and a
  Technology Acceptance Model (TAM) survey - everything you need for the
  user-testing phase.

---

## Install (developer / unpacked)

1. Download and unzip this folder.
2. Open **`chrome://extensions`** in Chrome.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked** and select the `navimind` folder.
5. Pin NaviMind, then click its icon (or press **Ctrl/Cmd + Shift + K**) to open the
   side panel.

## Zero-config mode (proxy + tester access codes)

NaviMind works with no setup via a small proxy (deployed at
`https://navimind.onrender.com`) that holds a shared Groq key pool, so
testers can install the extension and start asking questions immediately -
no API key required. Access is gated by a per-tester code so random people
who find the proxy URL can't burn the shared Groq quota.

**For testers:** just paste your assigned code into NaviMind's Settings
("Tester access code") and start asking questions. Nothing else to install.

**For local dev**, run the proxy on your own machine instead of using the
deployed one:
1. `cd server`
2. Copy `keys.example.js` to `keys.local.js` and fill in real Groq key(s).
3. Copy `tokens.example.js` to `tokens.local.js` and fill in one access code
   per tester. Both `*.local.js` files are gitignored - never commit them.
4. `npm start` (requires Node 18+; no dependencies to install)
5. Update `PROXY_URL` in `sidepanel/sidepanel.js` to `http://localhost:8787/chat`.

Neither the Groq keys nor the tester codes ever ship in the extension's JS,
so they can't be extracted by installing or unpacking it.

## Connect your own AI provider (optional)

Skip this if you're using zero-config mode. Bring your own key if you want a
different provider/model, or higher rate limits than the shared pool.

1. Click the ⚙️ settings icon in the panel (opens the options page).
2. Choose a provider and paste your API key:
   - **Google Gemini** ★ *(recommended, free)* - aistudio.google.com → Get API key. Best free choice: large context window for long pages, no credit card. Use model `gemini-2.5-flash`.
   - **Groq** *(free, very fast)* - console.groq.com → API Keys. Great speed; tighter token/day limits on long pages.
   - **OpenRouter** *(free models)* - openrouter.ai → Keys. One key, many free models (IDs ending in `:free`).
   - **OpenAI** *(paid)* - platform.openai.com → API keys.
   - **Anthropic** *(paid)* - console.anthropic.com → API keys.
3. (Optional) Enter a specific model, or leave blank for the recommended default.
4. **Save**. This overrides zero-config mode; requests now go straight to your
   chosen provider instead of through the local proxy.

> Your key is stored only in your browser (`chrome.storage.local`) and is sent
> only to the provider you pick, never to anyone else.

---

## How to use

- Type a question in the box, or press the 🎤 mic to speak it.
- Tap a **quick action** chip for common tasks.
- Use **View outline** to see the page's structure and jump to any section.
- On any answer: **Read aloud**, **Copy**, or rate it 👍 / 👎.
- Open the 📊 stats panel to see usage metrics or take the TAM survey.
- Open the ♿ panel for text size, contrast, dark mode, and auto-read.

---

## Project structure

```
navimind/
├── manifest.json            # MV3 config, permissions, side panel
├── background.js            # service worker (opens panel, injects extractor)
├── content/
│   ├── extractor.js         # Readability-style page analysis (Objective 1)
│   └── content-script.js    # message bridge + find/highlight on page
├── sidepanel/
│   ├── sidepanel.html       # accessible UI
│   ├── sidepanel.css        # "wayfinding" design system
│   └── sidepanel.js         # chat, AI providers, voice, a11y, metrics, TAM
├── options/                 # provider + key settings
├── server/                  # local proxy for zero-config mode (holds shared keys)
├── icons/                   # extension icons
└── docs/OBJECTIVES.md       # how the build maps to the proposal
```

## Notes & limitations

- Chrome (and Chromium browsers) with Manifest V3 + Side Panel API.
- NaviMind can't read internal browser pages (`chrome://`, the Web Store).
- Very long pages are trimmed to stay within the model's context budget; the
  panel shows when this happens.
- Voice input uses the browser's Web Speech API (Chrome-supported).
