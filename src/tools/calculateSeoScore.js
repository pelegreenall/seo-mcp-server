const {
    parseContent,
    extractPlainText,
    countWords,
    avg,
    keywordInText,
} = require("../utils/content");
const { loadContent } = require("../utils/loader");
const { handler: analyzeLinks } = require("./analyzeLinks");
const { handler: checkSemanticCoverage } = require("./checkSemanticCoverage");
const { handler: checkSnippetOptimization } = require("./checkSnippetOptimization");
const { handler: checkAiRetrievability } = require("./checkAiRetrievability");
const { handler: checkEeatSignals } = require("./checkEeatSignals");
const { handler: checkStructuredData } = require("./checkStructuredData");

const schema = {
    name: "calculate_seo_score",
    description:
        "Calculate an overall SEO score (Mega Score) that aligns with modern Google algorithms and AI answer engines. Covers Technical SEO, Keyword Optimisation, Content Structure, Readability, Link Profile, Snippet Readiness, Topical Authority, AI Retrievability, E-E-A-T signals and Structured Data.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML or Markdown content to score",
            },
            filepath: {
                type: "string",
                description: "Absolute path to a local file (.docx, .html, .md, .txt) to score",
            },
            primary_keyword: {
                type: "string",
                description:
                    "The main keyword this content should rank for. Required for keyword optimisation scoring.",
            },
            expected_terms: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of LSI / related semantic terms expected in the content for Topical Authority scoring. If not provided, Topical Authority is excluded from the score calculations to ensure grading consistency.",
            },
            meta_title: {
                type: "string",
                description: "Optional. Manually provided meta title to include in scoring.",
            },
            meta_description: {
                type: "string",
                description: "Optional. Manually provided meta description to include in scoring.",
            },
            site_domain: {
                type: "string",
                description: "Optional. The domain being audited (e.g. \"example.com\"), so absolute links to your own site count as internal rather than external.",
            },
        },
        required: [],
    },
};

async function handler({ content, filepath, primary_keyword, expected_terms, meta_title, meta_description, site_domain }) {
    const rawContent = await loadContent({ content, filepath });

    const { $, isHtml } = parseContent(rawContent);
    const plain = extractPlainText($);
    const wordCount = countWords(plain);
    const kw = primary_keyword?.toLowerCase() || null;

    // ─── Collect raw data ─────────────────────────────────────────────────────

    // Meta
    const titleText = meta_title || $("title").text().trim() || null;
    const metaDescText = meta_description ||
        $('meta[name="description"]').attr("content")?.trim() || null;

    // Headings
    const headings = [];
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
        const tag = el.tagName.toLowerCase();
        headings.push({ level: parseInt(tag[1]), text: $(el).text().trim() });
    });
    const h1s = headings.filter((h) => h.level === 1);
    const h2s = headings.filter((h) => h.level === 2);

    let hierarchyClean = true;
    let prevLevel = 0;
    for (const h of headings) {
        if (prevLevel > 0 && h.level > prevLevel + 1) {
            hierarchyClean = false;
            break;
        }
        prevLevel = h.level;
    }

    // Keyword checks
    const kwInTitle = kw && titleText
        ? titleText.toLowerCase().includes(kw)
        : kw && h1s.length
            ? h1s[0].text.toLowerCase().includes(kw)
            : false;
    const kwInFirstParagraph = kw
        ? (() => {
            const firstPara =
                $("p").first().text().trim() ||
                plain.split(/\n{2,}/)[0] ||
                plain.slice(0, 200);
            return firstPara.toLowerCase().includes(kw);
        })()
        : false;
    const kwInH2 = kw ? h2s.some((h) => h.text.toLowerCase().includes(kw)) : false;
    const kwInMeta = kw && metaDescText
        ? metaDescText.toLowerCase().includes(kw)
        : false;

    // Readability (Flesch)
    const sentences = plain
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const sentenceCount = sentences.length;
    const syllableCount = plain
        .toLowerCase()
        .replace(/[^a-z]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .reduce((acc, word) => {
            const syls = word
                .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
                .replace(/^y/, "")
                .match(/[aeiouy]{1,2}/g);
            return acc + (syls ? syls.length : 1);
        }, 0);
    const fre =
        sentenceCount > 0 && wordCount > 0
            ? parseFloat(
                (
                    206.835 -
                    1.015 * (wordCount / sentenceCount) -
                    84.6 * (syllableCount / wordCount)
                ).toFixed(1)
            )
            : 0;

    // Run external tools
    const linkResults = await analyzeLinks({ content, filepath, site_domain });
    const snippetResults = await checkSnippetOptimization({ content, filepath });
    const aiResults = await checkAiRetrievability({ content, filepath, primary_keyword });
    const eeatResults = await checkEeatSignals({ content, filepath, site_domain });
    const structuredResults = isHtml ? await checkStructuredData({ content, filepath }) : null;
    
    let semanticResults = null;
    if (expected_terms && expected_terms.length > 0) {
        semanticResults = await checkSemanticCoverage({ content, filepath, expected_terms });
    }

    // ─── Scoring ──────────────────────────────────────────────────────────────
    const checks = [];
    let totalEarned = 0;

    function check(category, label, earned, max, passed, fix = null) {
        totalEarned += earned;
        checks.push({ category, label, earned, max, passed, fix });
    }

    /**
     * Fold a sub-tool's own 0-100 component breakdown into this score,
     * rescaled to the category's point budget. The final component absorbs
     * any rounding remainder so each category sums to exactly `categoryMax`.
     */
    function addScaled(category, result, categoryMax) {
        const comps = (result.score_components || []).filter((c) => c.applicable !== false);
        const compMax = comps.reduce((s, c) => s + c.max, 0);
        if (compMax === 0) return;

        let maxAllocated = 0;
        comps.forEach((c, i) => {
            const isLast = i === comps.length - 1;
            const scaledMax = isLast ? categoryMax - maxAllocated : Math.round((c.max / compMax) * categoryMax);
            maxAllocated += scaledMax;
            const scaledEarned = Math.min(scaledMax, Math.round((c.earned / compMax) * categoryMax));
            check(category, c.label, scaledEarned, scaledMax, c.passed, c.fix);
        });
    }

    // --- Technical SEO (20 pts) ---
    const hasTitle = !!titleText;
    const titleLengthOk = titleText ? titleText.length >= 30 && titleText.length <= 60 : false;
    const hasMetaDesc = !!metaDescText;
    const metaLengthOk = metaDescText ? metaDescText.length >= 120 && metaDescText.length <= 160 : false;

    check("Technical SEO", "Title tag present", hasTitle ? 6 : 0, 6, hasTitle, hasTitle ? null : "Add a <title> tag");
    check("Technical SEO", "Title length (30–60 chars)", titleLengthOk ? 5 : 0, 5, titleLengthOk, titleLengthOk ? null : "Optimize title length (30-60 chars)");
    check("Technical SEO", "Meta description present", hasMetaDesc ? 6 : 0, 6, hasMetaDesc, hasMetaDesc ? null : "Add a meta description");
    check("Technical SEO", "Meta description length (120–160 chars)", metaLengthOk ? 3 : 0, 3, metaLengthOk, metaLengthOk ? null : "Optimize meta description length (120-160 chars)");

    // --- Keyword Optimisation (25 pts) ---
    if (!kw) {
        check("Keyword Optimisation", "Keyword in title / H1", 0, 10, false, "Provide a primary_keyword");
        check("Keyword Optimisation", "Keyword in first paragraph", 0, 8, false, null);
        check("Keyword Optimisation", "Keyword in an H2", 0, 4, false, null);
        check("Keyword Optimisation", "Keyword in meta description", 0, 3, false, null);
    } else {
        check("Keyword Optimisation", "Keyword in title / H1", kwInTitle ? 10 : 0, 10, kwInTitle, kwInTitle ? null : `Add "${primary_keyword}" to your title tag or H1`);
        check("Keyword Optimisation", "Keyword in first paragraph", kwInFirstParagraph ? 8 : 0, 8, kwInFirstParagraph, kwInFirstParagraph ? null : `Mention "${primary_keyword}" in the opening paragraph`);
        check("Keyword Optimisation", "Keyword in an H2", kwInH2 ? 4 : 0, 4, kwInH2, kwInH2 ? null : `Include "${primary_keyword}" in at least one H2`);
        check("Keyword Optimisation", "Keyword in meta description", kwInMeta ? 3 : 0, 3, kwInMeta, kwInMeta || !isHtml ? null : `Add "${primary_keyword}" to your meta description`);
    }

    // --- Content Structure (25 pts) ---
    const singleH1 = h1s.length === 1;
    const hasH2s = h2s.length > 0;

    check("Content Structure", "Single H1 tag", singleH1 ? 8 : 0, 8, singleH1, singleH1 ? null : "Ensure exactly one H1 tag");
    check("Content Structure", "H2 subheadings present", hasH2s ? 7 : 0, 7, hasH2s, hasH2s ? null : "Add H2 subheadings");
    check("Content Structure", "Heading hierarchy clean", hierarchyClean ? 5 : 0, 5, hierarchyClean, hierarchyClean ? null : "Fix heading hierarchy");
    check("Content Structure", `Word count ≥ 700 (currently ${wordCount})`, wordCount >= 700 ? 5 : 0, 5, wordCount >= 700, wordCount >= 700 ? null : "Expand content to >= 700 words");

    // --- Readability (15 pts) ---
    const readabilityOk = fre >= 50;
    check("Readability", `Flesch Reading Ease (${fre})`, readabilityOk ? 15 : 0, 15, readabilityOk, readabilityOk ? null : "Simplify text (break up long sentences)");

    // --- Link Profile (20 pts) ---
    const hasInternal = linkResults.internal_link_count > 0;
    const hasExternal = linkResults.external_link_count > 0;
    const noToxic = !linkResults.warnings.some(w => w.includes("Unoptimized anchor text"));
    check("Link Profile", "Internal links present", hasInternal ? 8 : 0, 8, hasInternal, hasInternal ? null : "Add internal links to other posts");
    check("Link Profile", "External links present", hasExternal ? 8 : 0, 8, hasExternal, hasExternal ? null : "Add external links to authority sites");
    check("Link Profile", "No toxic anchor text", noToxic ? 4 : 0, 4, noToxic, noToxic ? null : "Fix generic anchor texts like 'click here'");

    // --- Snippet Readiness (10 pts) ---
    const hasSnippets = snippetResults.total_optimized_snippets > 0;
    check("Snippet Readiness", "Featured snippet optimized paragraph", hasSnippets ? 10 : 0, 10, hasSnippets, hasSnippets ? null : "Optimize a paragraph directly under a question H2/H3 to 40-60 words.");

    // --- Topical Authority (35 pts) ---
    if (!semanticResults) {
        check("Topical Authority", "Semantic Coverage", 0, 35, false, "Provide expected_terms for topical authority scoring");
    } else {
        const scorePercent = semanticResults.coverage_score_percent;
        const semanticEarned = Math.round((scorePercent / 100) * 35);
        check("Topical Authority", `Semantic Coverage (${scorePercent}%)`, semanticEarned, 35, scorePercent >= 80, scorePercent >= 80 ? null : "Include more related semantic terms (LSI)");
    }

    // --- AI Retrievability (25 pts) ---
    addScaled("AI Retrievability", aiResults, 25);

    // --- E-E-A-T Signals (25 pts) ---
    addScaled("E-E-A-T Signals", eeatResults, 25);

    // --- Structured Data (15 pts, HTML only) ---
    if (structuredResults) {
        addScaled("Structured Data", structuredResults, 15);
    }

    // ─── Calculate Max Possible ────────────────────────────────────────────────
    let maxPossible = 215;
    if (!structuredResults) maxPossible -= 15; // JSON-LD can't exist in Markdown/.docx
    if (!kw) maxPossible -= 25; // 25 keyword points unavailable
    if (!semanticResults) maxPossible -= 35; // 35 semantic points unavailable

    const score = Math.round((totalEarned / maxPossible) * 100);
    const cappedScore = Math.min(score, 100);

    // ─── Grade ────────────────────────────────────────────────────────────────
    let grade, gradeLabel;
    if (cappedScore >= 90) { grade = "A"; gradeLabel = "Excellent"; }
    else if (cappedScore >= 75) { grade = "B"; gradeLabel = "Good"; }
    else if (cappedScore >= 60) { grade = "C"; gradeLabel = "Needs improvement"; }
    else if (cappedScore >= 40) { grade = "D"; gradeLabel = "Poor"; }
    else { grade = "F"; gradeLabel = "Critical issues"; }

    const categories = ["Technical SEO", "Keyword Optimisation", "Content Structure", "Readability", "Link Profile", "Snippet Readiness", "Topical Authority", "AI Retrievability", "E-E-A-T Signals", "Structured Data"];
    const categoryScores = categories.map((cat) => {
        const catChecks = checks.filter((c) => c.category === cat);
        const earned = catChecks.reduce((s, c) => s + c.earned, 0);
        const max = catChecks.reduce((s, c) => s + c.max, 0);
        return { category: cat, score: earned, max_score: max, percent: max > 0 ? Math.round((earned / max) * 100) : 0 };
    }).filter(c => c.max_score > 0);

    const fixes = checks
        .filter((c) => !c.passed && c.fix)
        .sort((a, b) => b.max - a.max)
        .map((c) => ({ priority_points: c.max, category: c.category, action: c.fix }));

    return {
        score: cappedScore,
        grade,
        grade_label: gradeLabel,
        total_raw_points: totalEarned,
        max_raw_points: maxPossible,
        category_breakdown: categoryScores,
        sub_scores: {
            ai_retrievability_percent: aiResults.retrievability_score_percent,
            eeat_percent: eeatResults.eeat_score_percent,
            structured_data_percent: structuredResults ? structuredResults.structured_data_score_percent : "N/A (non-HTML)",
        },
        all_checks: checks.map(({ category, label, earned, max, passed }) => ({
            category, label, earned, max, passed,
        })),
        prioritised_fixes: fixes.length > 0 ? fixes : ["No issues found — great work!"],
    };
}

module.exports = { schema, handler };
