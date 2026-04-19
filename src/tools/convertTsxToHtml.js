/**
 * convertTsxToHtml.js
 *
 * Converts a TSX/JSX blog post file into clean, analysable HTML.
 * Replaces custom Prose* and BlogPostLayout components with standard HTML tags
 * so every other SEO tool (calculate_seo_score, check_heading_structure, etc.)
 * can correctly detect H1/H2/H3 headings, paragraphs, and keyword placement.
 *
 * Returned object:
 *   html             – full HTML string ready to pass as `content` to other tools
 *   meta_title       – extracted from the head() meta array
 *   meta_description – extracted from the head() meta array
 *   h1               – the blog post's H1 (from BlogPostLayout title prop)
 *   word_count       – approximate word count of the extracted body text
 *   source_file      – basename of the input file
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─── Schema ──────────────────────────────────────────────────────────────────

const schema = {
    name: "convert_tsx_to_html",
    description:
        "Convert a TSX/JSX blog post file into clean HTML for SEO analysis. " +
        "Replaces custom components (ProseH2, ProseH3, ProseP, BlogPostLayout, etc.) " +
        "with standard HTML tags so other SEO tools can correctly detect heading structure, " +
        "keyword placement, and readability. Pass the returned `html` string as the `content` " +
        "parameter to calculate_seo_score, check_heading_structure, or any other SEO tool.",
    inputSchema: {
        type: "object",
        properties: {
            filepath: {
                type: "string",
                description: "Absolute path to a .tsx, .jsx, or .js React/SolidJS file to convert",
            },
        },
        required: ["filepath"],
    },
};

// ─── Component → HTML tag map ────────────────────────────────────────────────

const COMPONENT_MAP = {
    ProseH2:          "h2",
    ProseH3:          "h3",
    ProseH4:          "h4",
    ProseP:           "p",
    ProseUl:          "ul",
    ProseLi:          "li",
    ProseOl:          "ol",
    ProseBlockquote:  "blockquote",
    ProseCallout:     "blockquote",
    ProseCompareGrid: "div",
    ProseCompareCol:  "div",
    ProseCompareItem: "div",
    ProseCite:        "cite",
    ProseCode:        "code",
    ProsePre:         "pre",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeAttr(str) {
    return (str || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Extract a string attribute value from a JSX opening tag string.
 * Handles both  attr="value"  and  attr={'value'}  forms.
 */
function extractAttr(tagStr, attrName) {
    // attr="value" or attr='value'
    const re1 = new RegExp(`${attrName}=["']([^"']+)["']`);
    const m1 = tagStr.match(re1);
    if (m1) return m1[1];

    // attr={"value"} or attr={'value'}
    const re2 = new RegExp(`${attrName}=\\{["']([^"']+)["']\\}`);
    const m2 = tagStr.match(re2);
    if (m2) return m2[1];

    return null;
}

/**
 * Crude word count on plain text.
 */
function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

// ─── Main conversion ──────────────────────────────────────────────────────────

async function handler({ filepath }) {
    if (!filepath) throw new Error("filepath is required");
    if (!fs.existsSync(filepath)) throw new Error(`File not found: ${filepath}`);

    const src = fs.readFileSync(filepath, "utf8");

    // ── 1. Extract meta title ────────────────────────────────────────────────
    let metaTitle = "";

    // Pattern A:  { title: "..." }   inside the head() object
    const titlePatternA = src.match(/\btitle:\s*["']([^"']+)["']/);
    if (titlePatternA) metaTitle = titlePatternA[1];

    // Pattern B:  head: () => ({ title: "..." })  at the route level (some posts)
    if (!metaTitle) {
        const titlePatternB = src.match(/head:\s*\(\)\s*=>\s*\(\s*\{[^}]*title:\s*["']([^"']+)["']/s);
        if (titlePatternB) metaTitle = titlePatternB[1];
    }

    // ── 2. Extract meta description ──────────────────────────────────────────
    let metaDesc = "";
    const descMatch = src.match(/name:\s*["']description["'][^}]*content:\s*["']([^"']+)["']/s)
        || src.match(/content:\s*["']([^"']+)["'][^}]*name:\s*["']description["']/s);
    if (descMatch) metaDesc = descMatch[1];

    // ── 3. Extract BlogPostLayout title prop (this becomes the H1) ───────────
    let h1Text = "";
    const layoutMatch = src.match(/<BlogPostLayout\b([^>]+)>/s);
    if (layoutMatch) {
        h1Text = extractAttr(layoutMatch[1], "title") || "";
    }

    // ── 4. Isolate the JSX body (content between <BlogPostLayout> tags) ───────
    let body = "";
    const bodyMatch = src.match(/<BlogPostLayout\b[^>]*>([\s\S]*?)<\/BlogPostLayout>/);
    if (bodyMatch) {
        body = bodyMatch[1];
    } else {
        // Fallback: take everything after the last `return (` up to the closing `)`
        const returnMatch = src.match(/return\s*\(\s*([\s\S]*?)\s*\)\s*\}?\s*$/);
        body = returnMatch ? returnMatch[1] : src;
    }

    // ── 5. Replace ProseLink ──────────────────────────────────────────────────
    // <ProseLink href="..."> … </ProseLink>
    body = body.replace(/<ProseLink\b([^>]*)>/g, (_, attrs) => {
        const href = extractAttr(attrs, "href") || "#";
        return `<a href="${escapeAttr(href)}">`;
    });
    body = body.replace(/<\/ProseLink>/g, "</a>");

    // ── 6. Replace all mapped Prose* components ───────────────────────────────
    for (const [comp, tag] of Object.entries(COMPONENT_MAP)) {
        // Opening with any attributes:  <ProseH2>  or  <ProseH2 className="...">
        body = body.replace(new RegExp(`<${comp}\\b(?:\\s[^>]*)?>`, "g"), `<${tag}>`);
        // Closing tag
        body = body.replace(new RegExp(`<\\/${comp}>`, "g"), `</${tag}>`);
        // Self-closing
        body = body.replace(new RegExp(`<${comp}\\b(?:\\s[^>]*)?\\s*/>`, "g"), `<${tag} />`);
    }

    // ── 7. Strip JSX-specific noise ──────────────────────────────────────────
    // {/* JSX comments */}
    body = body.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

    // {" "} and similar whitespace expressions
    body = body.replace(/\{["'`]\s*["'`]\}/g, " ");

    // Inline string expressions like {"some text"}
    body = body.replace(/\{["'`]([^"'`]*)["'`]\}/g, "$1");

    // {someVariable} or {expression} — remove (they'd be empty at render time anyway)
    body = body.replace(/\{[^}]*\}/g, "");

    // Remove JSX import/export/function lines
    body = body.replace(/^(import|export|const|let|var|function)\s.*$/gm, "");

    // ── 8. Assemble full HTML document ────────────────────────────────────────
    const html = [
        "<!DOCTYPE html>",
        "<html>",
        "<head>",
        `  <title>${escapeAttr(metaTitle)}</title>`,
        `  <meta name="description" content="${escapeAttr(metaDesc)}">`,
        "</head>",
        "<body>",
        h1Text ? `<h1>${h1Text}</h1>` : "",
        body,
        "</body>",
        "</html>",
    ]
        .filter((line) => line !== "")
        .join("\n");

    // ── 9. Return result ──────────────────────────────────────────────────────
    const plainText = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    return {
        html,
        meta_title: metaTitle,
        meta_description: metaDesc,
        h1: h1Text,
        word_count: wordCount(plainText),
        source_file: path.basename(filepath),
        note:
            "Pass the `html` value as the `content` parameter to calculate_seo_score, " +
            "check_heading_structure, or any other SEO tool for accurate analysis.",
    };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = { schema, handler };
