const {
    parseContent,
    extractPlainText,
    detectIntent,
    extractQuantifiedClaims,
    normalise,
} = require("../utils/content");
const { measureTitle, measureDescription, TITLE_LIMIT_PX } = require("../utils/serp");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "suggest_meta_tags",
    description:
        "Supplies the raw material for writing a title and meta description, and scores candidates for click appeal. Extracts the draft's distinguishing facts (figures, dates, sample sizes), measures rendered pixel width, penalises generic template phrasing, and flags overlap with competitor titles. Use it to source facts and grade drafts — write the final copy yourself from what it returns rather than shipping a formula.",
    inputSchema: {
        type: "object",
        properties: {
            content: { type: "string", description: "The raw HTML or Markdown content" },
            filepath: { type: "string", description: "Absolute path to a local file (.docx, .html, .md, .txt)" },
            primary_keyword: { type: "string", description: "The main keyword to optimise meta tags around" },
            secondary_keywords: {
                type: "array",
                items: { type: "string" },
                description: "Optional list of secondary keywords to include in suggestions",
            },
            target_audience: {
                type: "string",
                description: "Optional audience descriptor (e.g. 'BI analysts')",
            },
            target_intent: {
                type: "string",
                enum: ["Informational", "Transactional", "Commercial", "Navigational"],
                description: "Optional explicit intent type, overriding the inference from the keyword.",
            },
            candidate_titles: {
                type: "array",
                items: { type: "string" },
                description:
                    "Optional. Titles you have drafted, to be scored for click appeal. This is the main way to use the tool: draft from distinguishing_assets, then pass them back here to grade.",
            },
            competitor_titles: {
                type: "array",
                items: { type: "string" },
                description:
                    "Optional. Titles already ranking for this keyword. Candidates sharing their phrasing are penalised — a title that blends in earns no click.",
            },
        },
        required: [],
    },
};

// ─── Helpers kept from the original ───────────────────────────────────────────

function toTitleCase(str) {
    if (!str) return "";
    return str.toLowerCase().split(" ").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}

function removeStopWords(slugBase) {
    const stopWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "of", "in", "with", "is", "it"]);
    return slugBase
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .split(/\s+/)
        .filter((word) => !stopWords.has(word) && word.length > 0)
        .join("-");
}

function extractRelevantSentence(text, keyword) {
    if (!keyword || !text) return null;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(keyword.toLowerCase())) return sentence.trim();
    }
    return null;
}

// ─── Click appeal ─────────────────────────────────────────────────────────────

/**
 * Phrases that appear in a large share of competing titles. They are not
 * grammatically wrong — they are invisible, which on a SERP is the same as
 * being wrong. A title built from these is optimised to look normal.
 */
const TEMPLATE_PHRASES = [
    "a complete guide", "the complete guide", "complete guide",
    "everything you need to know", "all you need to know", "what you need to know",
    "the ultimate guide", "ultimate guide", "a comprehensive guide", "comprehensive guide",
    "the definitive guide", "a beginner's guide", "beginners guide",
    "step by step guide", "step-by-step guide", "a detailed guide", "in-depth guide",
    "tips and tricks", "the basics", "101", "explained simply",
];

/** Hype that trades credibility for clicks — penalised, not rewarded. */
const CLICKBAIT = [
    "you won't believe", "you wont believe", "this one trick", "one weird trick",
    "shocking", "will blow your mind", "doctors hate", "the secret that",
    "nobody tells you", "they don't want you to know",
];

function ngrams(text, n) {
    const words = normalise(text).split(" ").filter(Boolean);
    const out = new Set();
    for (let i = 0; i + n <= words.length; i++) out.add(words.slice(i, i + n).join(" "));
    return out;
}

/**
 * Score a title for the likelihood it earns a click, 0-100.
 * Deliberately deterministic so the same title always grades the same way.
 */
function scoreTitle(title, { keyword, competitorTitles = [] } = {}) {
    if (!title) return null;
    const lower = title.toLowerCase();
    const metrics = measureTitle(title);
    const findings = [];
    let score = 50; // neutral baseline

    // 1. Rendered width
    if (metrics.truncated) {
        score -= 20;
        findings.push({ signal: "truncation", effect: -20, detail: `Cut at ~${metrics.pixel_limit}px — "${metrics.lost_to_truncation}" never renders.` });
    } else if (metrics.status === "Under-using space") {
        score -= 8;
        findings.push({ signal: "wasted width", effect: -8, detail: `Uses ${metrics.width_used_percent}% of available width — room for something specific.` });
    } else {
        score += 8;
        findings.push({ signal: "width", effect: 8, detail: `${metrics.pixel_width}px — fits and uses the space.` });
    }

    // 2. Specificity: a concrete number is the cheapest differentiator there is
    const numerals = title.match(/\d+/g) || [];
    if (numerals.length > 0) {
        score += 15;
        findings.push({ signal: "concrete numeral", effect: 15, detail: `Contains ${numerals.join(", ")} — specific beats vague on a SERP.` });
    } else {
        score -= 10;
        findings.push({ signal: "no numeral", effect: -10, detail: "No figure, date or count. A specific number is the cheapest way to stand out." });
    }

    // 3. Template phrasing
    const templatesHit = TEMPLATE_PHRASES
        .filter((p) => lower.includes(p))
        // Keep only the longest match of any overlapping pair, so "a complete
        // guide" isn't counted twice for also containing "complete guide".
        .filter((p, _, all) => !all.some((other) => other !== p && other.includes(p)));
    if (templatesHit.length) {
        const penalty = Math.min(30, templatesHit.length * 20);
        score -= penalty;
        findings.push({
            signal: "template phrasing",
            effect: -penalty,
            detail: `Contains ${templatesHit.map((t) => `"${t}"`).join(", ")} — phrasing shared with most competing results.`,
        });
    }

    // 4. Clickbait
    const baitHit = CLICKBAIT.filter((p) => lower.includes(p));
    if (baitHit.length) {
        score -= 20;
        findings.push({ signal: "clickbait", effect: -20, detail: `Contains ${baitHit.map((t) => `"${t}"`).join(", ")} — buys a click at the cost of trust.` });
    }

    // 5. Front-loading — the first ~200px is what a scanning eye takes in
    if (keyword) {
        const idx = lower.indexOf(keyword.toLowerCase());
        if (idx === -1) {
            score -= 12;
            findings.push({ signal: "keyword absent", effect: -12, detail: `"${keyword}" does not appear in the title.` });
        } else {
            const pxBefore = measureTitle(title.slice(0, idx)).pixel_width;
            if (pxBefore <= 200) {
                score += 10;
                findings.push({ signal: "keyword front-loaded", effect: 10, detail: `"${keyword}" starts at ${pxBefore}px.` });
            } else {
                score -= 5;
                findings.push({ signal: "keyword buried", effect: -5, detail: `"${keyword}" starts at ${pxBefore}px — move it earlier.` });
            }
        }
    }

    // 6. Differentiation against what already ranks
    if (competitorTitles.length) {
        const mine = ngrams(title, 2);
        let overlapping = [];
        competitorTitles.forEach((c) => {
            ngrams(c, 2).forEach((g) => { if (mine.has(g)) overlapping.push(g); });
        });
        overlapping = [...new Set(overlapping)].filter((g) => !keyword || !normalise(keyword).includes(g));
        if (overlapping.length >= 2) {
            const penalty = Math.min(20, overlapping.length * 5);
            score -= penalty;
            findings.push({
                signal: "blends in with competitors",
                effect: -penalty,
                detail: `Shares phrasing with ranking titles: ${overlapping.slice(0, 4).map((g) => `"${g}"`).join(", ")}.`,
            });
        } else {
            score += 10;
            findings.push({ signal: "differentiated", effect: 10, detail: "Little phrasing overlap with the competitor titles supplied." });
        }
    }

    score = Math.max(0, Math.min(100, score));
    let verdict;
    if (score >= 75) verdict = "Strong — specific and distinct";
    else if (score >= 55) verdict = "Workable — has a weakness worth fixing";
    else if (score >= 35) verdict = "Weak — would blend into the results page";
    else verdict = "Poor — actively costs you the click";

    return {
        title,
        click_appeal_score: score,
        verdict,
        pixel_width: metrics.pixel_width,
        renders_as: metrics.renders_as,
        truncated: metrics.truncated,
        findings,
    };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler({
    content, filepath, primary_keyword, secondary_keywords = [],
    target_audience, target_intent, candidate_titles = [], competitor_titles = [],
}) {
    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);
    const plain = extractPlainText($);

    const existingTitle = $("title").text().trim() || null;
    const existingMeta = $('meta[name="description"]').attr("content")?.trim() || null;
    const h1Text = $("h1").first().text().trim() || null;
    const firstPara = $("p").first().text().trim() || plain.slice(0, 300);

    const kw = primary_keyword || "";
    const intent = target_intent || (kw ? detectIntent(kw) : "Informational");
    const audienceText = target_audience ? ` for ${target_audience}` : "";

    // ── The draft's own distinguishing facts ─────────────────────────────────
    // These are what a competitor cannot copy, and what a title should be built
    // from. A keyword alone produces the same title as everyone else.
    const BYLINE_OR_DATE = /^(by|written by|published|updated|posted|last updated|reviewed)\b/i;
    const claims = extractQuantifiedClaims(plain, 20).filter(
        (c) => !BYLINE_OR_DATE.test(c.trim()) && c.trim().split(/\s+/).length >= 8
    ).slice(0, 12);
    const distinguishingAssets = claims.map((sentence) => {
        const figures = sentence.match(/\d[\d,.]*\s?%?/g) || [];
        return { fact: sentence, figures: [...new Set(figures.map((f) => f.trim()))].slice(0, 4) };
    });

    // ── Score whatever titles are in play ────────────────────────────────────
    const toScore = [...candidate_titles];
    if (existingTitle) toScore.push(existingTitle);
    if (!toScore.length && h1Text) toScore.push(h1Text);

    const scored = toScore
        .map((t) => scoreTitle(t, { keyword: kw || null, competitorTitles: competitor_titles }))
        .filter(Boolean)
        .sort((a, b) => b.click_appeal_score - a.click_appeal_score);

    // ── Meta description: prefer a real sentence from the draft ──────────────
    let descriptionSource = null;
    let metaSuggestion = "";
    const relevant = extractRelevantSentence(plain, kw);
    if (relevant && relevant.length > 50) {
        metaSuggestion = relevant.length > 300 ? relevant.slice(0, 300).trim() : relevant;
        descriptionSource = "Drawn from the draft's own copy — the preferred source.";
    } else if (firstPara) {
        metaSuggestion = firstPara.slice(0, 300).trim();
        descriptionSource = "Opening paragraph — no sentence in the draft mentions the keyword, which is itself worth fixing.";
    }
    const descMetrics = measureDescription(metaSuggestion || null);

    // ── Slug ─────────────────────────────────────────────────────────────────
    const slugBase = kw || h1Text || "your-page-title";
    const slug = "/blog/" + removeStopWords(slugBase).slice(0, 60);

    return {
        how_to_use: [
            "1. Read distinguishing_assets — the facts in this draft that no competitor can copy.",
            "2. Write two or three titles yourself, built around those facts rather than around the keyword alone.",
            "3. Pass them back as candidate_titles to score them, ideally with competitor_titles for the differentiation check.",
            "This tool no longer emits formula titles. A template that fits every page produces a listing that looks like every other listing, which is the opposite of earning a click.",
        ],
        target_intent: intent,
        target_audience: target_audience || null,
        existing_title: existingTitle,
        existing_meta_description: existingMeta,
        h1: h1Text,

        distinguishing_assets: distinguishingAssets.length
            ? distinguishingAssets
            : [{
                fact: null,
                figures: [],
                note: "No quantified facts found in the draft. That is a content problem before it is a title problem — a title can only be as specific as the page behind it.",
            }],

        title_scores: scored.length
            ? scored
            : ["No titles to score. Pass candidate_titles, or add a <title>/H1 to the draft."],
        best_candidate: scored.length ? scored[0].title : null,

        meta_description_source: {
            text: metaSuggestion || null,
            source: descriptionSource,
            pixel_width: descMetrics.pixel_width,
            pixel_limit: descMetrics.pixel_limit,
            renders_as: descMetrics.renders_as,
            status: descMetrics.status,
            advice: descMetrics.advice,
            note: `Trim or extend this to fit ~${descMetrics.pixel_limit}px${audienceText ? `, and pitch it${audienceText}` : ""}. Keep the primary keyword in the opening clause.`,
        },

        url_slug_suggestion: slug,

        tips: [
            "Build the title from a fact in the draft — a figure, a sample size, a date. Specific beats comprehensive.",
            "Google truncates on rendered width, not character count, so check pixel_width rather than counting characters.",
            "If a title would fit any page on the topic, it is not doing any work.",
            "Front-load the primary keyword into the first ~200px.",
            "Write the description as a reason to click, not a summary of the page.",
        ],
    };
}

module.exports = { schema, handler };
