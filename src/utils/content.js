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

/** Extract all visible text from the parsed DOM. */
function extractPlainText($) {
  return $("body").text().replace(/\s+/g, " ").trim();
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
  detectIntent,
  checkIntentAlignment,
};
