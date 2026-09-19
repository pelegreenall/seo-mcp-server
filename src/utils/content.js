const cheerio = require("cheerio");
const { marked } = require("marked");

/**
 * Parses raw HTML or Markdown/plain-text content into a Cheerio DOM.
 * Returns { $, isHtml } so callers don't need to know which format was given.
 */
function parseContent(raw) {
  // 1. Detect if it's already HTML
  const isHtml = /<[a-z][\s\S]*>/i.test(raw.trim());
  const $ = isHtml ? cheerio.load(raw) : null;

  if (!isHtml) {
    // Treat as markdown / plain text — convert to structured HTML using marked
    const htmlContent = marked.parse(raw);
    const $md = cheerio.load(htmlContent);
    return { $: $md, isHtml: false };
  } else {
    return { $, isHtml: true };
  }
}

/** Tags whose text is never page copy and must never reach word counts. */
const NON_CONTENT_TAGS = "script, style, noscript, template, svg, iframe, object, embed";

/** Page chrome — only stripped when it sits outside <article> / <main>. */
const CHROME_TAGS = "nav, header, footer, aside";

/**
 * Extract all visible body copy from the parsed DOM.
 *
 * Works on a clone so the caller's DOM is never mutated — other checks in the
 * same handler still need the headings and links this strips out.
 *
 * Removes <script>/<style>/etc outright, and removes nav/header/footer/aside
 * only when they are page chrome rather than part of the article itself (an
 * <article><header><h1> is real content; a site-wide <header> is not).
 */
function extractPlainText($) {
  const $doc = cheerio.load($.html());

  $doc(NON_CONTENT_TAGS).remove();
  $doc(CHROME_TAGS)
    .filter((_, el) => $doc(el).closest("article, main").length === 0)
    .remove();

  return $doc("body").text().replace(/\s+/g, " ").trim();
}

/** Count words in a string. */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Average of a numeric array. */
function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

/**
 * Count occurrences of a keyword (case-insensitive, literal) in text.
 * Returns number of matches.
 */
function keywordInText(kw, text) {
  if (!kw) return 0;
  const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
  return (text.match(re) || []).length;
}

const ABBREVIATIONS = [
  "e.g.", "i.e.", "etc.", "vs.", "cf.", "approx.", "est.", "Inc.", "Ltd.",
  "Co.", "Corp.", "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "St.", "No.",
  "U.S.", "U.K.", "E.U.", "a.m.", "p.m.",
];

/**
 * Split text into sentences, keeping common abbreviations intact.
 * Good enough for prose analysis — not a linguistics-grade splitter.
 */
function splitSentences(text) {
  if (!text) return [];

  let masked = text;
  ABBREVIATIONS.forEach((abbr, i) => {
    masked = masked.split(abbr).join(`\u0001${i}\u0001`);
  });

  return masked
    .replace(/([.?!])\s+(?=["'(\[]?[A-Z0-9])/g, "$1\u0000")
    .split("\u0000")
    .map((s) => {
      let out = s.trim();
      ABBREVIATIONS.forEach((abbr, i) => {
        out = out.split(`\u0001${i}\u0001`).join(abbr);
      });
      return out;
    })
    .filter(Boolean);
}

const BLOCK_TAGS = new Set([
  "h1", "h2", "h3", "h4", "h5", "h6",
  "p", "ul", "ol", "table", "blockquote", "pre", "figure", "dl",
]);

const SKIP_TAGS = new Set([
  "script", "style", "noscript", "template", "svg", "iframe",
  "object", "embed", "nav", "footer", "aside",
]);

/**
 * Walk the DOM in document order and return the block-level elements that
 * carry content, flattened. Descends through wrapper <div>s so nested markup
 * (React output, CMS templates) is handled the same as flat markdown.
 */
function flattenBlocks($, rootEl) {
  const blocks = [];

  function walk(node) {
    const children = node.children || [];
    for (const child of children) {
      if (child.type !== "tag") continue;
      const tag = child.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) continue;
      if (BLOCK_TAGS.has(tag)) {
        blocks.push({ tag, el: child });
        continue; // don't descend — the block owns its inline content
      }
      walk(child);
    }
  }

  walk(rootEl);
  return blocks;
}

/**
 * Split content into retrieval "chunks" — one per H2, plus an intro chunk for
 * anything before the first H2. This mirrors how search engines and LLM
 * retrievers actually slice a page.
 *
 * Returns [{ heading, level, is_intro, blocks, text, word_count,
 *            paragraphs, list_count, table_count }]
 */
function getSections($) {
  const root = $("main").length
    ? $("main").first()[0]
    : $("article").length
      ? $("article").first()[0]
      : $("body").first()[0];

  if (!root) return [];

  const blocks = flattenBlocks($, root);
  const sections = [];
  let current = { heading: null, level: null, is_intro: true, blocks: [] };

  for (const block of blocks) {
    if (block.tag === "h2") {
      if (current.blocks.length > 0 || !current.is_intro) sections.push(current);
      current = {
        heading: $(block.el).text().trim(),
        level: 2,
        is_intro: false,
        blocks: [],
      };
      continue;
    }
    if (block.tag === "h1") continue; // the title isn't part of any chunk
    current.blocks.push(block);
  }
  if (current.blocks.length > 0 || !current.is_intro) sections.push(current);

  return sections.map((section) => {
    const paragraphs = section.blocks
      .filter((b) => b.tag === "p")
      .map((b) => $(b.el).text().replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const text = section.blocks
      .map((b) => $(b.el).text().replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join(" ");

    return {
      ...section,
      heading: section.heading || "(intro — before first H2)",
      text,
      word_count: countWords(text),
      paragraphs,
      list_count: section.blocks.filter((b) => b.tag === "ul" || b.tag === "ol").length,
      table_count: section.blocks.filter((b) => b.tag === "table").length,
    };
  });
}


const QUESTION_WORDS = [
  "who", "what", "where", "when", "why", "how",
  "is", "are", "can", "do", "does", "should", "will", "which",
];

/** True if a heading reads as a question, by punctuation or by opening word. */
function isQuestionHeading(text) {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.endsWith("?")) return true;
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  return QUESTION_WORDS.includes(firstWord);
}

/**
 * Openers that delay the answer. Featured snippets and AI answers both take
 * the first sentence after a question heading — a preamble wastes it.
 */
const PREAMBLE_PATTERNS = [
  /^in this (article|post|guide|section|chapter|piece)/i,
  /^(we|i)(?:'ll| will| are going to| want to)? ?(explore|discuss|look at|cover|dive|examine|walk through|break down|unpack|take a look)/i,
  /^let'?s (take a look|explore|dive|start|begin|get started|jump)/i,
  /^before we (dive|get|begin|start|look)/i,
  /^(first|firstly),? (let'?s|we)/i,
  /^there (are|is) (many|several|a lot|lots|a number|plenty)/i,
  /^when it comes to/i,
  /^in today'?s/i,
  /^(to understand|to answer) (this|that)/i,
  /^it'?s (important|worth) (to note|noting|remembering)/i,
  /^you might be (wondering|asking)/i,
  /^(good|great) question/i,
];

/** "The short answer is…" delays nothing — it's a direct answer opener. */
const DIRECT_ANSWER_OPENER = /^(the (short|quick) answer)/i;

/** Returns the matched preamble pattern, or null if the sentence answers directly. */
function detectPreamble(sentence) {
  if (!sentence) return null;
  const s = sentence.trim();
  if (DIRECT_ANSWER_OPENER.test(s)) return null;
  return PREAMBLE_PATTERNS.find((re) => re.test(s)) || null;
}

/** Strip protocol, www. and trailing slash from a domain or URL. */
function normalizeDomain(input) {
  if (!input) return null;
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

/** Pull the hostname out of an href, or null for relative / non-http links. */
function hostnameOf(href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) {
    return normalizeDomain(href.replace(/^https?:\/\//i, ""));
  }
  if (href.startsWith("//")) return normalizeDomain(href.slice(2));
  return null;
}

/**
 * Classify a link as "internal", "external" or "other" (mailto:, tel:, js:).
 * `siteDomain` is the domain being audited — without it, only root-relative
 * and anchor links can be recognised as internal.
 */
function classifyHref(href, siteDomain) {
  if (!href) return "other";
  const trimmed = href.trim();

  if (/^(mailto:|tel:|sms:|javascript:|data:)/i.test(trimmed)) return "other";
  if (trimmed === "#" || trimmed.startsWith("#")) return "internal";
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return "internal";
  }

  const host = hostnameOf(trimmed);
  if (!host) return "internal"; // bare relative path e.g. "blog/post"

  const site = normalizeDomain(siteDomain);
  if (site && (host === site || host.endsWith(`.${site}`))) return "internal";

  return "external";
}

/**
 * Detects search intent based on keyword modifiers.
 * Returns one of: 'Informational', 'Transactional', 'Commercial', or 'Navigational'.
 */
function detectIntent(keyword) {
  if (!keyword) return "Informational";
  const kw = keyword.toLowerCase().trim();

  const transactionalModifiers = ["buy", "purchase", "order", "cheap", "price", "prices", "sale", "coupon", "coupons", "deal", "deals", "download", "hire", "get", "subscribe", "pricing", "checkout"];
  const commercialModifiers = ["best", "top", "review", "reviews", "vs", "compare", "comparison", "choices", "choice", "alternative", "alternatives", "rating", "ratings"];
  const informationalModifiers = ["how", "why", "what", "guide", "tutorial", "learn", "tips", "resource", "resources", "explanation", "ideas", "list"];

  if (transactionalModifiers.some(mod => new RegExp(`\\b${mod}\\b`, "i").test(kw))) {
    return "Transactional";
  }
  if (commercialModifiers.some(mod => new RegExp(`\\b${mod}\\b`, "i").test(kw))) {
    return "Commercial";
  }
  if (informationalModifiers.some(mod => new RegExp(`\\b${mod}\\b`, "i").test(kw))) {
    return "Informational";
  }

  return "Informational";
}

/**
 * Checks if the text aligns with the given intent.
 * Returns { aligned: boolean, missingTerms: string[], detectedTerms: string[] }
 */
function checkIntentAlignment(text, intent) {
  if (!text || !intent) return { aligned: true, missingTerms: [], detectedTerms: [] };
  const lowerText = text.toLowerCase();

  const triggers = {
    Informational: ["how", "why", "what", "guide", "tutorial", "learn", "tip", "resource", "explain", "idea", "list", "understand", "master", "step"],
    Transactional: ["buy", "order", "price", "sale", "coupon", "deal", "download", "get", "subscribe", "pricing", "checkout", "hire", "shop", "trial"],
    Commercial: ["best", "top", "review", "vs", "compare", "comparison", "alternative", "rating", "choice", "versus", "choose"]
  };

  const currentTriggers = triggers[intent] || [];
  if (currentTriggers.length === 0) {
    return { aligned: true, missingTerms: [], detectedTerms: [] };
  }

  const detected = currentTriggers.filter(term => new RegExp(`\\b${term}\\w*\\b`, "i").test(lowerText));
  
  return {
    aligned: detected.length > 0,
    missingTerms: currentTriggers.filter(term => !detected.includes(term)),
    detectedTerms: detected
  };
}

module.exports = {
  parseContent,
  extractPlainText,
  countWords,
  avg,
  keywordInText,
  splitSentences,
  flattenBlocks,
  getSections,
  isQuestionHeading,
  detectPreamble,
  normalizeDomain,
  hostnameOf,
  classifyHref,
  detectIntent,
  checkIntentAlignment,
};
