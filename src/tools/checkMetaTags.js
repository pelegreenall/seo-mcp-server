const path = require("path");
const { parseContent, detectIntent, checkIntentAlignment, similarity } = require("../utils/content");
const { measureTitle, measureDescription } = require("../utils/serp");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_meta_tags",
    description:
        "Validate the existing meta title and meta description in HTML content. Checks rendered pixel width (how Google actually truncates), keyword presence, search intent alignment, the risk that Google rewrites the title, and common SEO issues. Use this to audit already-written meta tags rather than generate new ones.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML content to check meta tags in",
            },
            filepath: {
                type: "string",
                description: "Absolute path to a local file (.docx, .html, .md, .txt)",
            },
            primary_keyword: {
                type: "string",
                description:
                    "Optional. The keyword to check for inside the title and meta description.",
            },
            meta_title: {
                type: "string",
                description: "Optional. Manually provided meta title to validate.",
            },
            meta_description: {
                type: "string",
                description: "Optional. Manually provided meta description to validate.",
            },
        },
        required: [],
    },
};


/**
 * Google rewrites a large share of title tags — published studies put it around
 * 60% — and a rewritten title means the copy you wrote never reaches the SERP.
 * These are the documented reasons it does so, all detectable statically.
 */
function assessRewriteRisk(titleText, h1Text, titleMetrics, primaryKeyword) {
    if (!titleText) return null;

    const triggers = [];

    if (titleMetrics.truncated) {
        triggers.push({
            trigger: "Exceeds the rendered width limit",
            detail: `${titleMetrics.pixel_width}px against a ~${titleMetrics.pixel_limit}px limit. Over-long titles are the most common rewrite cause.`,
            weight: 3,
        });
    }

    // Repeated content words read as keyword stuffing.
    const words = titleText.toLowerCase().match(/[a-z0-9']+/g) || [];
    const counts = {};
    words.filter((w) => w.length > 3).forEach((w) => { counts[w] = (counts[w] || 0) + 1; });
    const repeated = Object.entries(counts).filter(([, n]) => n >= 2).map(([w, n]) => `"${w}" x${n}`);
    if (repeated.length) {
        triggers.push({
            trigger: "Repeated keywords",
            detail: `${repeated.join(", ")}. Repetition reads as stuffing and invites a rewrite.`,
            weight: 3,
        });
    }

    // Boilerplate separator chains: "Keyword | Category | Brand | Site"
    const separators = (titleText.match(/[|\-–—:·»]/g) || []).length;
    if (separators > 2) {
        triggers.push({
            trigger: "Separator stuffing",
            detail: `${separators} separators. Chained boilerplate segments are routinely collapsed by Google.`,
            weight: 2,
        });
    }

    // A title that contradicts the H1 is the classic swap case.
    if (h1Text) {
        const sim = similarity(titleText, h1Text);
        if (sim < 0.3) {
            triggers.push({
                trigger: "Title diverges from H1",
                detail: `Only ${Math.round(sim * 100)}% word overlap with the H1 ("${h1Text.slice(0, 60)}"). Google commonly substitutes the H1 when the title does not describe the page.`,
                weight: 3,
            });
        }
    }

    const letters = titleText.replace(/[^A-Za-z]/g, "");
    if (letters.length > 6 && letters === letters.toUpperCase()) {
        triggers.push({ trigger: "ALL CAPS title", detail: "Google normalises shouted titles.", weight: 2 });
    }

    if (/^(home|page|untitled|welcome|index|new page)/i.test(titleText)) {
        triggers.push({ trigger: "Generic title", detail: "Placeholder titles are almost always replaced.", weight: 3 });
    }

    if (primaryKeyword && !titleText.toLowerCase().includes(primaryKeyword.toLowerCase())) {
        triggers.push({
            trigger: "Target keyword absent",
            detail: `"${primaryKeyword}" is not in the title, so Google may source a more relevant heading from the page.`,
            weight: 1,
        });
    }

    const score = triggers.reduce((sum, t) => sum + t.weight, 0);
    let level;
    if (score === 0) level = "Low";
    else if (score <= 2) level = "Moderate";
    else if (score <= 5) level = "High";
    else level = "Very high";

    return {
        risk_level: level,
        risk_score: score,
        triggers: triggers.length ? triggers.map(({ trigger, detail }) => ({ trigger, detail })) : [],
        likely_replacement: triggers.length && h1Text ? h1Text : null,
        note:
            triggers.length === 0
                ? "No known rewrite triggers — this title should render as written."
                : "Each trigger is a documented reason Google replaces a title. Fixing them is what keeps your copy on the SERP.",
    };
}

async function handler({ content, filepath, primary_keyword, meta_title, meta_description }) {
    const rawContent = await loadContent({ content, filepath });
    const originalExt = filepath ? path.extname(filepath).toLowerCase() : null;

    const { $, isHtml } = parseContent(rawContent);
    const extUsed = originalExt || (isHtml ? ".html" : ".md");

    // Require either HTML with tags OR manually provided tags
    const hasManualTags = !!(meta_title || meta_description);
    if (!isHtml && !hasManualTags) {
        return {
            error:
                `This tool requires HTML structured with <title> and <meta> tags, or manually provided tags via 'meta_title' and 'meta_description'.`,
        };
    }

    const kw = primary_keyword?.toLowerCase() || null;
    const detectedIntent = primary_keyword ? detectIntent(primary_keyword) : null;

    // ── Title tag ─────────────────────────────────────────────────────────────

    const titleText = meta_title || $("title").text().trim() || null;
    const titleCount = meta_title ? 1 : $("title").length;

    const titleIssues = [];
    if (titleCount === 0) titleIssues.push("No <title> tag found");
    if (titleCount > 1) titleIssues.push(`${titleCount} <title> tags found — only one is allowed`);
    // Width, not character count — Google truncates on rendered pixels, so a
    // 60-char title of wide glyphs is cut while a narrow one has room to spare.
    const titleMetrics = measureTitle(titleText);
    if (titleText && titleMetrics.status !== "Good")
        titleIssues.push(titleMetrics.advice);
    if (kw && titleText && !titleText.toLowerCase().includes(kw))
        titleIssues.push(`Primary keyword "${primary_keyword}" not found in title`);
    if (titleText && /^(home|page|untitled|welcome)/i.test(titleText))
        titleIssues.push(`Title looks generic ("${titleText}") — use a descriptive, keyword-rich title`);

    // Intent alignment check for Title
    let titleIntentAligned = true;
    if (detectedIntent && titleText) {
        const alignment = checkIntentAlignment(titleText, detectedIntent);
        titleIntentAligned = alignment.aligned;
        if (!alignment.aligned) {
            titleIssues.push(`Title does not align with the detected "${detectedIntent}" intent — consider adding intent-specific words (e.g., ${alignment.missingTerms.slice(0, 3).join(", ")})`);
        }
    }

    // ── Meta description ──────────────────────────────────────────────────────

    const metaDescText = meta_description || $('meta[name="description"]').attr("content")?.trim() || null;
    const metaDescCount = meta_description ? 1 : $('meta[name="description"]').length;

    const metaIssues = [];
    if (metaDescCount === 0) metaIssues.push("No meta description found");
    if (metaDescCount > 1) metaIssues.push(`${metaDescCount} meta descriptions found — only one is allowed`);
    const descMetrics = measureDescription(metaDescText);
    if (metaDescText && descMetrics.status !== "Good")
        metaIssues.push(descMetrics.advice);
    if (kw && metaDescText && !metaDescText.toLowerCase().includes(kw))
        metaIssues.push(`Primary keyword "${primary_keyword}" not found in meta description`);
    if (metaDescText) {
        const firstWords = metaDescText.split(" ").slice(0, 20).join(" ").toLowerCase();
        if (kw && !firstWords.includes(kw))
            metaIssues.push(`Primary keyword not in the first 20 words of the meta description — move it earlier`);
    }

    // Intent alignment check for Meta Description
    let metaIntentAligned = true;
    if (detectedIntent && metaDescText) {
        const alignment = checkIntentAlignment(metaDescText, detectedIntent);
        metaIntentAligned = alignment.aligned;
        if (!alignment.aligned) {
            metaIssues.push(`Meta description does not align with the detected "${detectedIntent}" intent — consider adding intent-specific words (e.g., ${alignment.missingTerms.slice(0, 3).join(", ")})`);
        }
    }

    // ── Open Graph tags (bonus check) ─────────────────────────────────────────

    const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || null;
    const ogDesc = $('meta[property="og:description"]').attr("content")?.trim() || null;

    // ── Scores & summary ──────────────────────────────────────────────────────

    const allIssues = [...titleIssues, ...metaIssues];

    const h1Text = $("h1").first().text().trim() || null;
    const rewriteRisk = assessRewriteRisk(titleText, h1Text, titleMetrics, primary_keyword);
    if (rewriteRisk && (rewriteRisk.risk_level === "High" || rewriteRisk.risk_level === "Very high")) {
        titleIssues.push(`${rewriteRisk.risk_level} risk that Google rewrites this title — see title_rewrite_risk.`);
    }

    return {
        detected_intent: detectedIntent,
        title_rewrite_risk: rewriteRisk,
        title_tag: {
            text: titleText,
            char_count: titleText ? titleText.length : 0,
            pixel_width: titleMetrics.pixel_width,
            pixel_limit: titleMetrics.pixel_limit,
            within_limit: titleText ? !titleMetrics.truncated : false,
            renders_as: titleMetrics.renders_as,
            lost_to_truncation: titleMetrics.lost_to_truncation,
            keyword_present: kw && titleText ? titleText.toLowerCase().includes(kw) : null,
            intent_aligned: titleIntentAligned,
            issues: titleIssues.length > 0 ? titleIssues : ["No issues found"],
        },
        meta_description: {
            text: metaDescText,
            char_count: metaDescText ? metaDescText.length : 0,
            pixel_width: descMetrics.pixel_width,
            pixel_limit: descMetrics.pixel_limit,
            within_limit: metaDescText ? !descMetrics.truncated : false,
            renders_as: descMetrics.renders_as,
            lost_to_truncation: descMetrics.lost_to_truncation,
            keyword_present: kw && metaDescText ? metaDescText.toLowerCase().includes(kw) : null,
            intent_aligned: metaIntentAligned,
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
