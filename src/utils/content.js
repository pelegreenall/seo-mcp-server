const cheerio = require("cheerio");

/**
 * Parses raw HTML or Markdown/plain-text content into a Cheerio DOM.
 * Returns { $, isHtml } so callers don't need to know which format was given.
 */
function parseContent(raw) {
  const isHtml = /<[a-z][\s\S]*>/i.test(raw);
  if (isHtml) {
    const $ = cheerio.load(raw);
    return { $, isHtml: true };
  }
  // Treat as markdown / plain text — build a minimal DOM so analysis stays uniform.
  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const fakeHtml = `<div id="md-root">${escaped}</div>`;
  const $ = cheerio.load(fakeHtml);
  return { $, isHtml: false };
}

/** Extract all visible text from the parsed DOM. */
function extractPlainText($) {
  return $("body").text().replace(/\s+/g, " ").trim();
}

/** Count words in a string. */
function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Count sentences in a string. */
function countSentences(text) {
  return text.split(/[.!?]+/).filter((s) => s.trim().length > 0).length;
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
  countSentences,
  avg,
  keywordInText,
};
