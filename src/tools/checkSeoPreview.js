const path = require("path");
const { parseContent } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_seo_preview",
    description:
        "Comprehensive validator for the 'Big Three' of on-page SEO: Slug, Title, and Meta Description. Checks character limits, keyword placement, and URL structure.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML or Markdown content to analyze",
            },
            filepath: {
                type: "string",
                description: "Absolute path to a local file (.docx, .html, .md, .txt)",
            },
            primary_keyword: {
                type: "string",
                description: "The keyword to check for in slug, title, and description.",
            },
            slug: {
                type: "string",
                description: "The URL slug to validate (e.g., 'how-to-do-seo').",
            },
            meta_title: {
                type: "string",
                description: "Optional. Manually provided meta title.",
            },
            meta_description: {
                type: "string",
                description: "Optional. Manually provided meta description.",
            },
        },
        required: [],
    },
};

async function handler({ content, filepath, primary_keyword, slug, meta_title, meta_description }) {
    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);

    const kw = primary_keyword?.toLowerCase() || null;

    // ── 1. Slug Check ──────────────────────────────────────────────────────────
    const slugIssues = [];
    let slugValue = slug || null;

    if (!slugValue) {
        // Try to find in canonical link
        const canonical = $('link[rel="canonical"]').attr("href");
        if (canonical) {
            try {
                const url = new URL(canonical);
                slugValue = url.pathname.split("/").filter(Boolean).pop();
            } catch (e) {
                // Not a full URL or invalid
                slugValue = canonical.split("/").filter(Boolean).pop();
            }
        }
    }

    if (!slugValue) {
        slugIssues.push("No slug provided or found in content");
    } else {
        if (/[A-Z]/.test(slugValue)) slugIssues.push("Slug contains uppercase letters — use lowercase only");
        if (/_/.test(slugValue)) slugIssues.push("Slug uses underscores — use hyphens for better SEO");
        if (/[^a-z0-9-]/.test(slugValue)) slugIssues.push("Slug contains special characters or spaces");
        if (slugValue.length > 75) slugIssues.push(`Slug is very long (${slugValue.length} chars) — aim for under 60`);
        if (kw && !slugValue.toLowerCase().includes(kw.replace(/\s+/g, "-"))) {
            slugIssues.push(`Primary keyword "${primary_keyword}" not found in slug`);
        }
    }

    // ── 2. Title Check ─────────────────────────────────────────────────────────
    const titleText = meta_title || $("title").text().trim() || null;
    const titleIssues = [];
    if (!titleText) {
        titleIssues.push("No title found");
    } else {
        if (titleText.length < 30) titleIssues.push(`Title is too short (${titleText.length} chars) — aim for 30–60`);
        if (titleText.length > 60) titleIssues.push(`Title is too long (${titleText.length} chars) — may be truncated`);
        if (kw && !titleText.toLowerCase().includes(kw)) titleIssues.push(`Keyword "${primary_keyword}" missing from title`);
        if (/^(home|page|untitled)/i.test(titleText)) titleIssues.push("Title is generic");
    }

    // ── 3. Meta Description Check ──────────────────────────────────────────────
    const descText = meta_description || $('meta[name="description"]').attr("content")?.trim() || null;
    const descIssues = [];
    if (!descText) {
        descIssues.push("No meta description found");
    } else {
        if (descText.length < 120) descIssues.push(`Description is short (${descText.length} chars) — aim for 120–160`);
        if (descText.length > 160) descIssues.push(`Description is long (${descText.length} chars) — may be truncated`);
        if (kw && !descText.toLowerCase().includes(kw)) descIssues.push(`Keyword "${primary_keyword}" missing from description`);
        
        const first20 = descText.split(" ").slice(0, 20).join(" ").toLowerCase();
        if (kw && !first20.includes(kw)) {
            descIssues.push("Keyword not in first 20 words of description");
        }
    }

    const allIssues = [...slugIssues, ...titleIssues, ...descIssues];

    return {
        slug: {
            value: slugValue,
            issues: slugIssues.length ? slugIssues : ["Looks good"],
            passed: slugIssues.length === 0,
        },
        title: {
            text: titleText,
            issues: titleIssues.length ? titleIssues : ["Looks good"],
            passed: titleIssues.length === 0,
        },
        meta_description: {
            text: descText,
            issues: descIssues.length ? descIssues : ["Looks good"],
            passed: descIssues.length === 0,
        },
        summary: {
            total_issues: allIssues.length,
            grade: allIssues.length === 0 ? "A" : allIssues.length <= 2 ? "B" : allIssues.length <= 5 ? "C" : "D",
            recommendation: allIssues.length === 0 ? "Ready to publish!" : "Review the issues below before publishing.",
        }
    };
}

module.exports = { schema, handler };
