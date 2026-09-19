const { parseContent, extractPlainText, detectIntent } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "suggest_meta_tags",
    description:
        "Generate optimised title tag, meta description, and URL slug suggestions for unpublished content based on the primary keyword, secondary keywords, search intent, and existing copy.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML or Markdown content",
            },
            filepath: {
                type: "string",
                description: "Absolute path to a local file (.docx, .html, .md, .txt)",
            },
            primary_keyword: {
                type: "string",
                description: "The main keyword to optimise meta tags around",
            },
            secondary_keywords: {
                type: "array",
                items: {
                    type: "string"
                },
                description: "Optional list of secondary keywords to include in suggestions",
            },
            target_audience: {
                type: "string",
                description:
                    "Optional audience descriptor to include in title formulas (e.g. 'BI analysts')",
            },
            target_intent: {
                type: "string",
                enum: ["Informational", "Transactional", "Commercial", "Navigational"],
                description: "Optional explicit intent type to tailor suggestions for.",
            },
        },
        required: [],
    },
};

// Helpers
function toTitleCase(str) {
    if (!str) return "";
    return str.toLowerCase().split(' ').map(function(word) {
        return (word.charAt(0).toUpperCase() + word.slice(1));
    }).join(' ');
}

function removeStopWords(slugBase) {
    const stopWords = new Set(["a", "an", "the", "and", "but", "or", "for", "nor", "on", "at", "to", "from", "by", "of", "in", "with", "is", "it"]);
    return slugBase
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .split(/\s+/)
        .filter(word => !stopWords.has(word) && word.length > 0)
        .join("-");
}

function extractRelevantSentence(text, keyword) {
    if (!keyword || !text) return null;
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [];
    for (const sentence of sentences) {
        if (sentence.toLowerCase().includes(keyword.toLowerCase())) {
            return sentence.trim();
        }
    }
    return null;
}

async function handler({ content, filepath, primary_keyword, secondary_keywords = [], target_audience, target_intent }) {
    const rawContent = await loadContent({ content, filepath });

    const { $, isHtml } = parseContent(rawContent);
    const plain = extractPlainText($);

    const existingTitle = $("title").text().trim() || null;
    const existingMeta =
        $('meta[name="description"]').attr("content")?.trim() || null;

    const h1Text = $("h1").first().text().trim() || null;
    const firstPara = $("p").first().text().trim() || plain.slice(0, 300);
    const kw = primary_keyword || "";
    const kwTitle = toTitleCase(kw);
    const secKw = secondary_keywords.length > 0 ? toTitleCase(secondary_keywords[0]) : "";
    const currentYear = new Date().getFullYear();

    const intent = target_intent || (kw ? detectIntent(kw) : "Informational");
    const audienceText = target_audience ? ` for ${target_audience}` : "";

    // 1. Build title suggestions
    const titleSuggestions = [];
    if (kw) {
        if (intent === "Transactional") {
            const cleanKwTitle = kwTitle.replace(/^(Buy|Get|Order)\s+/i, "");
            titleSuggestions.push(`Buy ${cleanKwTitle} Online - Best Prices & Deals`);
            titleSuggestions.push(`Get ${cleanKwTitle} - Start Your Trial/Subscription`);
            if (secKw) titleSuggestions.push(`Order ${cleanKwTitle} | Discount on ${secKw}`);
        } else if (intent === "Commercial") {
            const cleanKwTitle = kwTitle.replace(/^(Best|Top|Review|Reviews|Compare|Vs)\s+/i, "");
            titleSuggestions.push(`Best ${cleanKwTitle} Options Ranked & Reviewed [${currentYear}]`);
            titleSuggestions.push(`${cleanKwTitle} Review: Pros, Cons & Verdict`);
            if (secKw) titleSuggestions.push(`${cleanKwTitle} vs ${secKw} - Detailed Comparison`);
        } else if (intent === "Navigational") {
            titleSuggestions.push(`${kwTitle} Official Site | Login & Account`);
            titleSuggestions.push(`${kwTitle} Portal - Access Your Dashboard`);
        } else {
            // Informational default
            let base1 = `${kwTitle}: A Complete Guide`;
            if (base1.length <= 53) base1 += ` [${currentYear}]`;
            titleSuggestions.push(base1);
            if (target_audience) {
                titleSuggestions.push(`How to Master ${kwTitle} | Guide for ${toTitleCase(target_audience)}`);
            }
            if (secKw) {
                titleSuggestions.push(`${kwTitle}: Top ${secKw} Strategies (${currentYear})`);
            }
        }
        // Always include an action-oriented fallback
        titleSuggestions.push(`${kwTitle}: Everything You Need to Know`);
    } else if (h1Text) {
        let t = h1Text.slice(0, 60);
        titleSuggestions.push(t);
    } else {
        titleSuggestions.push("Add a primary keyword to get title suggestions");
    }

    // 2. Build meta description suggestion
    let metaSuggestion = "";
    if (kw) {
        const sentence = extractRelevantSentence(plain, kw);
        if (sentence && sentence.length > 50) {
            metaSuggestion = sentence;
            if (metaSuggestion.length > 155) {
                metaSuggestion = metaSuggestion.slice(0, 155).trim() + "...";
            }
        } else {
            // Smart template fallbacks by intent
            if (intent === "Transactional") {
                metaSuggestion = `Get the best deals on ${kw.toLowerCase()}${audienceText}. Order online today to start saving and get immediate access!`;
            } else if (intent === "Commercial") {
                metaSuggestion = `Compare top options and choose the best ${kw.toLowerCase()}${audienceText}. Read reviews, pros & cons, and ratings before you decide.`;
            } else if (intent === "Navigational") {
                metaSuggestion = `Visit the official page for ${kw.toLowerCase()}${audienceText}. Access your account, login, or get official support and resources.`;
            } else {
                metaSuggestion = `Learn everything you need to know about ${kw.toLowerCase()}${audienceText}. Discover best practices, strategies, and key insights in this complete guide.`;
            }
        }
    } else if (firstPara) {
        metaSuggestion = firstPara.slice(0, 155).trim() + "...";
    }

    // 3. URL slug from keyword or h1
    const slugBase = kw || h1Text || "your-page-title";
    let slugPath = removeStopWords(slugBase);
    const slug = "/blog/" + slugPath.slice(0, 60);

    const checks = {
        title_within_60_chars: titleSuggestions[0]?.length <= 60,
        meta_within_160_chars: metaSuggestion.length <= 160,
        keyword_in_title: kw
            ? titleSuggestions[0]?.toLowerCase().includes(kw.toLowerCase())
            : "N/A",
        keyword_in_meta_first_20_words: kw
            ? metaSuggestion
                .split(" ")
                .slice(0, 20)
                .join(" ")
                .toLowerCase()
                .includes(kw.toLowerCase())
            : "N/A",
    };

    return {
        target_intent: intent,
        existing_title: existingTitle,
        existing_meta_description: existingMeta,
        title_suggestions: titleSuggestions.map((t) => ({
            text: t,
            char_count: t.length,
            within_limit: t.length <= 60,
        })),
        meta_description_suggestion: {
            text: metaSuggestion,
            char_count: metaSuggestion.length,
            within_limit: metaSuggestion.length <= 160,
        },
        url_slug_suggestion: slug,
        checks,
        tips: [
            "Place the primary keyword within the first 60 characters of the title tag",
            "Include the primary keyword in the first 20 words of the meta description",
            "Use a benefit or CTA at the end of the meta description if character count allows",
            "Keep URL slugs short, lowercase, and hyphen-separated",
        ],
    };
}

module.exports = { schema, handler };
