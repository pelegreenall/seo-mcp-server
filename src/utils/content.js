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

module.exports = {
  parseContent,
  extractPlainText,
  countWords,
  avg,
  keywordInText,
};
