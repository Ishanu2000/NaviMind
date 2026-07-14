// NaviMind - content extractor
// Objective 1: "Develop an automated content extraction system that analyzes
// website structures and presents information in an organized, user-friendly format."
//
// Exposes a single global: window.__navaiExtract()
// It returns a structured, model-friendly snapshot of the current page:
//   { title, url, description, wordCount, truncated, outline[], links[], text }
//
// The approach is a lightweight, dependency-free variant of the "Readability"
// heuristic: clone the DOM, strip boilerplate (nav/aside/footer/scripts),
// score candidate containers by text density, and keep the densest region.

(function () {
  "use strict";

  const MAX_TEXT_CHARS = 12000; // token budget guard for the AI request
  const MAX_LINKS = 40;
  const BOILERPLATE = [
    "script", "style", "noscript", "svg", "canvas", "iframe", "template",
    "nav", "header", "footer", "aside", "form", "button",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    "[aria-hidden='true']", ".advert", ".ad", ".ads", ".cookie",
    ".newsletter", ".sidebar", ".menu", ".breadcrumb", ".social",
  ];

  function textLen(el) {
    return (el.textContent || "").replace(/\s+/g, " ").trim().length;
  }

  // Score an element by how much of its text lives in <p>-like blocks.
  function scoreCandidate(el) {
    const paras = el.querySelectorAll("p, li, blockquote, pre, td");
    let paraText = 0;
    paras.forEach((p) => (paraText += textLen(p)));
    const total = textLen(el);
    if (total < 200) return 0;
    const density = total ? paraText / total : 0;
    // Reward long, dense containers; lightly penalise link-heavy ones.
    const links = el.querySelectorAll("a").length;
    const linkPenalty = Math.min(links * 8, total * 0.5);
    return total * (0.4 + 0.6 * density) - linkPenalty;
  }

  // Build a heading outline (the page's "table of contents").
  function buildOutline(root) {
    const outline = [];
    const heads = root.querySelectorAll("h1, h2, h3, h4, h5, h6");
    heads.forEach((h) => {
      const label = (h.textContent || "").replace(/\s+/g, " ").trim();
      if (label && label.length <= 160) {
        outline.push({ level: Number(h.tagName[1]), text: label });
      }
    });
    return outline.slice(0, 60);
  }

  // Collect the most useful in-page links (skip empty / anchor-only ones).
  function collectLinks(root) {
    const seen = new Set();
    const out = [];
    root.querySelectorAll("a[href]").forEach((a) => {
      const label = (a.textContent || "").replace(/\s+/g, " ").trim();
      let href = a.getAttribute("href") || "";
      if (!label || label.length < 2) return;
      if (href.startsWith("javascript:") || href === "#") return;
      try {
        href = new URL(href, location.href).href;
      } catch (_) {
        return;
      }
      const key = label.toLowerCase() + "|" + href;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ text: label.slice(0, 80), href });
    });
    return out.slice(0, MAX_LINKS);
  }

  function pickMainContent(doc) {
    // Prefer explicit semantic containers when present.
    const preferred = doc.querySelector(
      "main, article, [role='main'], #main, #content, .content, .post, .article"
    );
    const candidates = [];
    if (preferred) candidates.push(preferred);
    doc
      .querySelectorAll("main, article, section, div")
      .forEach((el) => candidates.push(el));

    let best = doc.body;
    let bestScore = scoreCandidate(doc.body);
    for (const el of candidates) {
      const s = scoreCandidate(el);
      if (s > bestScore) {
        best = el;
        bestScore = s;
      }
    }
    return best;
  }

  function extract() {
    // Work on a clone so we never mutate the live page.
    const clone = document.cloneNode(true);
    BOILERPLATE.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((n) => n.remove());
    });

    const main = pickMainContent(clone) || clone.body || clone;

    let text = (main.textContent || "").replace(/\s+/g, " ").trim();
    const wordCount = text ? text.split(/\s+/).length : 0;
    let truncated = false;
    if (text.length > MAX_TEXT_CHARS) {
      text = text.slice(0, MAX_TEXT_CHARS);
      truncated = true;
    }

    const metaDesc =
      document.querySelector('meta[name="description"]')?.content ||
      document.querySelector('meta[property="og:description"]')?.content ||
      "";

    return {
      title: (document.title || "").trim(),
      url: location.href,
      description: metaDesc.trim().slice(0, 300),
      wordCount,
      truncated,
      outline: buildOutline(document), // outline from live DOM (has all headings)
      links: collectLinks(main),
      text,
      extractedAt: Date.now(),
    };
  }

  window.__navaiExtract = extract;
})();
