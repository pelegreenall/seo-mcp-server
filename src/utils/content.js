const cheerio = require("cheerio");
const { marked } = require("marked");

/**
 * Parses raw HTML or Markdown/plain-text content into a Cheerio DOM.
 * Returns { $, isHtml } so callers don't need to know which format was given.
 */
/**
 * Scan a Cheerio DOM for meta tags stored in a Word-style table (Label | Value rows).
 * Mammoth converts Word tables to adjacent <td> cells with no colon separator.
 */
function extractTableMeta($) {
  let title = null;
  let description = null;
  $("td, th").each((_, el) => {
    const label = $(el).text().trim().toLowerCase().replace(/\s+/g, " ");
    const next = $(el).next("td, th");
    if (!next.length) return;
    const value = next.text().trim();
    if (!value) return;
    if (!title && /^(meta ?title|seo ?title|title ?tag)$/.test(label)) title = value;
    if (!description && /^(meta ?description|seo ?description)$/.test(label)) description = value;
  });
  return { title, description };
}

function parseContent(raw) {
  // 1. Detect if it's already HTML
  const isHtml = /<[a-z][\s\S]*>/i.test(raw.trim());
  const $ = isHtml ? cheerio.load(raw) : null;

  // 2a. For HTML (e.g. from mammoth), check tables first — Word tables have no colon separator
  let tableTitle = null;
  let tableDesc = null;
  if (isHtml) {
    const tableMeta = extractTableMeta($);
    tableTitle = tableMeta.title;
    tableDesc = tableMeta.description;
  }

  // 2b. Fall back to regex scan on plain text for inline "Meta Title: ..." patterns
  const plainText = isHtml ? $("body").text() : raw;
  const scanArea = plainText.slice(0, 2000);
  const titleMatch = !tableTitle && scanArea.match(/(?:Meta\s*Title|SEO\s*Title|Title\s*Tag)\s*:\s*(.*)/i);
  const descMatch = !tableDesc && scanArea.match(/(?:Meta\s*Description|SEO\s*Description)\s*:\s*(.*)/i);

  const resolvedTitle = tableTitle || (titleMatch && titleMatch[1].trim()) || null;
  const resolvedDesc = tableDesc || (descMatch && descMatch[1].trim()) || null;

  if (!isHtml) {
    // Treat as markdown / plain text — convert to structured HTML using marked
    const htmlContent = marked.parse(raw);
    const $md = cheerio.load(htmlContent);
    if (resolvedTitle) $md("head").append(`<title>${resolvedTitle}</title>`);
    if (resolvedDesc) $md("head").append(`<meta name="description" content="${resolvedDesc}">`);
    return { $: $md, isHtml: false };
  } else {
    // Inject into HTML only if not already present as proper tags
    if (resolvedTitle && !$("title").length) {
      $("head").length ? $("head").append(`<title>${resolvedTitle}</title>`) : $.root().prepend(`<title>${resolvedTitle}</title>`);
    }
    if (resolvedDesc && !$('meta[name="description"]').length) {
      $("head").length ? $("head").append(`<meta name="description" content="${resolvedDesc}">`) : $.root().prepend(`<meta name="description" content="${resolvedDesc}">`);
    }
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
