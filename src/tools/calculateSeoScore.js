const {
    parseContent,
    extractPlainText,
    countWords,
    avg,
    keywordInText,
} = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "calculate_seo_score",
    description:
        "Calculate an overall SEO score out of 100 for the provided content. Covers technical SEO (meta tags), keyword optimisation, content structure, and readability. Returns a score, grade, category breakdown, and a prioritised list of what to fix.",
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
            meta_title: {
                type: "string",
                description: "Optional. Manually provided meta title to include in scoring (e.g. for non-HTML files).",
            },
            meta_description: {
                type: "string",
                description: "Optional. Manually provided meta description to include in scoring.",
            },
        },
        // Either content or filepath must be provided, but we'll validate in handler
        required: [],
    },
};

async function handler({ content, filepath, primary_keyword, meta_title, meta_description }) {
    const rawContent = await loadContent({ content, filepath });

    const { $, isHtml } = parseContent(rawContent);
    const plain = extractPlainText($);
    const wordCount = countWords(plain);
    const kw = primary_keyword?.toLowerCase() || null;

    // ─── Collect raw data ─────────────────────────────────────────────────────

    // Meta (prioritize manually provided, then look in HTML)
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

    // Hierarchy clean?
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
    const kwCountBody = kw ? keywordInText(kw, plain) : 0;
    const kwDensity = kw && wordCount > 0 ? (kwCountBody / wordCount) * 100 : 0;
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
    const kwDensityGood = kwDensity >= 0.5 && kwDensity <= 2.0;

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

    // ─── Scoring ──────────────────────────────────────────────────────────────

    const checks = [];
    let totalEarned = 0;

    function check(category, label, earned, max, passed, fix = null) {
        totalEarned += earned;
        checks.push({ category, label, earned, max, passed, fix });
    }

    // --- Technical SEO (25 pts) ---
    const hasTitle = !!titleText;
    const titleLengthOk = titleText
        ? titleText.length >= 30 && titleText.length <= 60
        : false;
    const hasMetaDesc = !!metaDescText;
    const metaLengthOk = metaDescText
        ? metaDescText.length >= 120 && metaDescText.length <= 160
        : false;

    check("Technical SEO", "Title tag present", hasTitle ? 8 : 0, 8, hasTitle,
        hasTitle ? null : "Add a <title> tag to your HTML");
    check("Technical SEO", "Title length (30–60 chars)", titleLengthOk ? 5 : 0, 5, titleLengthOk,
        titleText
            ? titleText.length < 30
                ? `Title is too short (${titleText.length} chars) — expand to 30–60`
                : `Title is too long (${titleText.length} chars) — trim to under 60`
            : "Add a title first");
    check("Technical SEO", "Meta description present", hasMetaDesc ? 8 : 0, 8, hasMetaDesc,
        hasMetaDesc ? null : "Add a meta description tag");
    check("Technical SEO", "Meta description length (120–160 chars)", metaLengthOk ? 4 : 0, 4, metaLengthOk,
        metaDescText
            ? metaDescText.length < 120
                ? `Meta description is too short (${metaDescText.length} chars) — expand to 120–160`
                : `Meta description is too long (${metaDescText.length} chars) — trim to under 160`
            : "Add a meta description first");

    // --- Keyword Optimisation (30 pts) ---
    if (!kw) {
        // Skip keyword checks — award 0 for all, mark as N/A
        check("Keyword Optimisation", "Keyword in title / H1", 0, 8, false,
            "Provide a primary_keyword to enable keyword scoring");
        check("Keyword Optimisation", "Keyword in first paragraph", 0, 7, false, null);
        check("Keyword Optimisation", "Keyword in an H2", 0, 5, false, null);
        check("Keyword Optimisation", "Keyword in meta description", 0, 5, false, null);
        check("Keyword Optimisation", "Keyword density (0.5–2%)", 0, 5, false, null);
    } else {
        check("Keyword Optimisation", "Keyword in title / H1", kwInTitle ? 8 : 0, 8, kwInTitle,
            kwInTitle ? null : `Add "${primary_keyword}" to your title tag or H1`);
        check("Keyword Optimisation", "Keyword in first paragraph", kwInFirstParagraph ? 7 : 0, 7, kwInFirstParagraph,
            kwInFirstParagraph ? null : `Mention "${primary_keyword}" in the opening paragraph`);
        check("Keyword Optimisation", "Keyword in an H2", kwInH2 ? 5 : 0, 5, kwInH2,
            kwInH2 ? null : `Include "${primary_keyword}" in at least one H2 subheading`);
        check("Keyword Optimisation", "Keyword in meta description", kwInMeta ? 5 : 0, 5, kwInMeta,
            kwInMeta || !isHtml ? null : `Add "${primary_keyword}" to your meta description`);
        check("Keyword Optimisation", `Keyword density (0.5–2%, currently ${kwDensity.toFixed(2)}%)`,
            kwDensityGood ? 5 : 0, 5, kwDensityGood,
            kwDensityGood
                ? null
                : kwDensity === 0
                    ? `Keyword not found in body — add "${primary_keyword}" naturally throughout`
                    : kwDensity < 0.5
                        ? `Density too low (${kwDensity.toFixed(2)}%) — use the keyword more often`
                        : `Density too high (${kwDensity.toFixed(2)}%) — reduce keyword repetition`);
    }

    // --- Content Structure (25 pts) ---
    const singleH1 = h1s.length === 1;
    const hasH2s = h2s.length > 0;

    check("Content Structure", "Single H1 tag", singleH1 ? 8 : 0, 8, singleH1,
        singleH1
            ? null
            : h1s.length === 0
                ? "Add exactly one H1 tag"
                : `Remove extra H1 tags (found ${h1s.length})`);
    check("Content Structure", "H2 subheadings present", hasH2s ? 7 : 0, 7, hasH2s,
        hasH2s ? null : "Add H2 subheadings to structure your content");
    check("Content Structure", "Heading hierarchy clean", hierarchyClean ? 5 : 0, 5, hierarchyClean,
        hierarchyClean ? null : "Fix heading levels — don't skip from H1 to H3 etc.");
    check("Content Structure", `Word count ≥ 700 (currently ${wordCount})`,
        wordCount >= 700 ? 5 : 0, 5, wordCount >= 700,
        wordCount >= 700 ? null : `Content is too short (${wordCount} words) — aim for at least 700`);

    // --- Readability (20 pts) ---
    let readabilityPts;
    let readabilityFix;
    if (fre >= 70) {
        readabilityPts = 20;
        readabilityFix = null;
    } else if (fre >= 60) {
        readabilityPts = 14;
        readabilityFix = `Flesch score ${fre} — good but could be more readable. Shorten sentences.`;
    } else if (fre >= 50) {
        readabilityPts = 8;
        readabilityFix = `Flesch score ${fre} — fairly difficult. Break up long sentences and paragraphs.`;
    } else {
        readabilityPts = 0;
        readabilityFix = `Flesch score ${fre} — too difficult for most readers. Simplify significantly.`;
    }
    check("Readability", `Flesch Reading Ease (${fre})`, readabilityPts, 20,
        readabilityPts >= 14, readabilityFix);

    // ─── Max possible (reduces when no keyword provided) ─────────────────────
    const maxPossible = kw ? 100 : 70; // 30 keyword pts unavailable without kw
    const score = Math.round((totalEarned / maxPossible) * 100);
    const cappedScore = Math.min(score, 100);

    // ─── Grade ────────────────────────────────────────────────────────────────
    let grade, gradeLabel;
    if (cappedScore >= 90) { grade = "A"; gradeLabel = "Excellent"; }
    else if (cappedScore >= 75) { grade = "B"; gradeLabel = "Good"; }
    else if (cappedScore >= 60) { grade = "C"; gradeLabel = "Needs improvement"; }
    else if (cappedScore >= 40) { grade = "D"; gradeLabel = "Poor"; }
    else { grade = "F"; gradeLabel = "Critical issues"; }

    // ─── Category summaries ────────────────────────────────────────────────────
    const categories = ["Technical SEO", "Keyword Optimisation", "Content Structure", "Readability"];
    const categoryScores = categories.map((cat) => {
        const catChecks = checks.filter((c) => c.category === cat);
        const earned = catChecks.reduce((s, c) => s + c.earned, 0);
        const max = catChecks.reduce((s, c) => s + c.max, 0);
        return { category: cat, score: earned, max_score: max, percent: Math.round((earned / max) * 100) };
    });

    // ─── Prioritised fixes (fails only, sorted by points available) ──────────
    const fixes = checks
        .filter((c) => !c.passed && c.fix)
        .sort((a, b) => b.max - a.max)
        .map((c) => ({ priority_points: c.max, category: c.category, action: c.fix }));

    return {
        score: cappedScore,
        grade,
        grade_label: gradeLabel,
        keyword_scoring_active: !!kw,
        category_breakdown: categoryScores,
        all_checks: checks.map(({ category, label, earned, max, passed }) => ({
            category, label, earned, max, passed,
        })),
        prioritised_fixes: fixes.length > 0 ? fixes : ["No issues found — great work!"],
    };
}

module.exports = { schema, handler };
