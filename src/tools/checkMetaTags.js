const { parseContent, keywordInText } = require("../utils/content");

const schema = {
    name: "check_meta_tags",
    description:
        "Validate the existing meta title and meta description in HTML content. Checks character length, keyword presence, and common SEO issues. Use this to audit already-written meta tags rather than generate new ones.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML content to check meta tags in",
            },
            primary_keyword: {
                type: "string",
                description:
                    "Optional. The keyword to check for inside the title and meta description.",
            },
        },
        required: ["content"],
    },
};

function handler({ content, primary_keyword }) {
    const { $, isHtml } = parseContent(content);

    if (!isHtml) {
        return {
            error:
                "This tool requires HTML content with <title> and <meta> tags. For Markdown content, use suggest_meta_tags instead.",
        };
    }

    const kw = primary_keyword?.toLowerCase() || null;

    // ── Title tag ─────────────────────────────────────────────────────────────

    const titleText = $("title").text().trim() || null;
    const titleCount = $("title").length;

    const titleIssues = [];
    if (titleCount === 0) titleIssues.push("No <title> tag found");
    if (titleCount > 1) titleIssues.push(`${titleCount} <title> tags found — only one is allowed`);
    if (titleText && titleText.length < 30)
        titleIssues.push(`Title is very short (${titleText.length} chars) — aim for 30–60 characters`);
    if (titleText && titleText.length > 60)
        titleIssues.push(`Title exceeds 60 characters (${titleText.length}) — may be truncated in SERPs`);
    if (kw && titleText && !titleText.toLowerCase().includes(kw))
        titleIssues.push(`Primary keyword "${primary_keyword}" not found in title`);
    if (titleText && /^(home|page|untitled|welcome)/i.test(titleText))
        titleIssues.push(`Title looks generic ("${titleText}") — use a descriptive, keyword-rich title`);

    // ── Meta description ──────────────────────────────────────────────────────

    const metaDescEl = $('meta[name="description"]');
    const metaDescText = metaDescEl.attr("content")?.trim() || null;
    const metaDescCount = $('meta[name="description"]').length;

    const metaIssues = [];
    if (metaDescCount === 0) metaIssues.push("No meta description found");
    if (metaDescCount > 1) metaIssues.push(`${metaDescCount} meta descriptions found — only one is allowed`);
    if (metaDescText && metaDescText.length < 70)
        metaIssues.push(`Meta description is short (${metaDescText.length} chars) — aim for 120–160 characters`);
    if (metaDescText && metaDescText.length > 160)
        metaIssues.push(`Meta description exceeds 160 characters (${metaDescText.length}) — will be truncated in SERPs`);
    if (kw && metaDescText && !metaDescText.toLowerCase().includes(kw))
        metaIssues.push(`Primary keyword "${primary_keyword}" not found in meta description`);
    if (metaDescText) {
        const firstWords = metaDescText.split(" ").slice(0, 20).join(" ").toLowerCase();
        if (kw && !firstWords.includes(kw))
            metaIssues.push(`Primary keyword not in the first 20 words of the meta description — move it earlier`);
    }

    // ── Open Graph tags (bonus check) ─────────────────────────────────────────

    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
    const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || null;

    // ── Scores & summary ──────────────────────────────────────────────────────

    const allIssues = [...titleIssues, ...metaIssues];

    return {
        title_tag: {
            text: titleText,
            char_count: titleText ? titleText.length : 0,
            within_limit: titleText ? titleText.length <= 60 : false,
            keyword_present: kw && titleText ? titleText.toLowerCase().includes(kw) : null,
            issues: titleIssues.length > 0 ? titleIssues : ["No issues found"],
        },
        meta_description: {
            text: metaDescText,
            char_count: metaDescText ? metaDescText.length : 0,
            within_limit: metaDescText ? metaDescText.length <= 160 : false,
            keyword_present: kw && metaDescText ? metaDescText.toLowerCase().includes(kw) : null,
            issues: metaIssues.length > 0 ? metaIssues : ["No issues found"],
        },
        open_graph: {
            og_title: ogTitle,
            og_description: ogDesc,
            has_og_tags: !!(ogTitle || ogDesc),
        },
        summary: {
            total_issues: allIssues.length,
            status: allIssues.length === 0 ? "Pass" : allIssues.length <= 2 ? "Needs minor fixes" : "Needs attention",
            all_issues: allIssues.length > 0 ? allIssues : ["All meta tag checks passed"],
        },
    };
}

module.exports = { schema, handler };
