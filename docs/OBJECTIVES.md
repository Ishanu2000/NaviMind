# How NaviMind fulfils the proposal

This maps every **aim/outcome** and **objective** from the CT/2020/007 proposal
to the concrete part of the implementation that delivers it.

## Objectives (Section 4)

| # | Objective (from proposal) | Where it lives in the build |
|---|---|---|
| 1 | **Simplify access to information** - automated content extraction that analyses website structure and presents it in an organised format | `content/extractor.js` - a dependency-free, Readability-style extractor that strips boilerplate, scores content density to find the main region, and produces a structured snapshot (title, description, **heading outline**, key links, main text). Surfaced in the panel's page-context strip and the **View outline** navigator. |
| 2 | **Enhance browsing with an AI chatbot** - conversational interface connecting to AI APIs for natural-language querying | `sidepanel/sidepanel.js` → `streamChat()` - a provider abstraction over **OpenAI, Anthropic, and Gemini** with streamed responses. The extracted page becomes the model's context (`buildSystemPrompt()`), so answers are grounded in the current page. |
| 3 | **Validate with real users** - user testing and feedback | Per-answer **👍/👎 feedback**, a **usage-metrics** panel (questions asked, average response time, feedback tally), and a built-in **Technology Acceptance Model (TAM) survey** (`TAM_ITEMS`) covering perceived usefulness, ease of use, and intention to use. Responses are stored locally for analysis. |
| 4 | **Improve decision-making speed** - rapid information retrieval | **Quick-action chips** (Summarize, Key points, Outline, Explain simply) and **Find-on-page** with in-page highlighting + scroll-to. Streaming answers reduce time-to-first-token. |

## Aims / expected outcomes (Section 3)

| Outcome | How it is delivered |
|---|---|
| **Enhanced user navigation efficiency** | Instant contextual answers about page content; outline jump-to; find-and-highlight - all without manual scrolling. |
| **Improved web accessibility** | Keyboard-first operation with visible focus, ARIA live regions announcing answers, **read-aloud (TTS)**, **voice input (STT)**, adjustable **text size**, **high-contrast** and **dark** modes, and a skip link. Aligns with the proposal's WCAG 2.1 evaluation plan. |
| **Demonstration of AI–HCI integration** | A clean Manifest V3 architecture - content script ↔ service worker ↔ side panel - showing a reusable pattern for embedding conversational AI in the browser. |
| **Validated user-experience model** | The metrics + TAM instruments provide the empirical evidence the proposal calls for (Technology Acceptance Model, Section 7.4). |

## Methodology alignment (Section 7)

- **Agile / iterative:** modular files make each feature independently
  improvable across iterations.
- **Mixed methods:** the app captures **quantitative** measures (response time,
  query counts, feedback rate) and supports **qualitative** measures (TAM
  survey + free-text comment).
- **Evaluation framework:** feedback + TAM correspond directly to the proposal's
  performance-evaluation and user-acceptance instruments.

## Technology stack (matches Section 5.1)

- Frontend: HTML, CSS, JavaScript (ES6+) - no build step, no external runtime deps
- Browser APIs: Chrome Extension MV3 (side panel, scripting, storage, tabs)
- AI integration: OpenAI GPT / Anthropic Claude / Google Gemini APIs
- Content processing: DOM traversal + heuristic extraction in JavaScript
