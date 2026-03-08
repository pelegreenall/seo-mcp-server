const { parseContent, extractPlainText } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "suggest_meta_tags",
    description:
        "Generate optimised title tag, meta description, and URL slug suggestions for unpublished content based on the primary keyword and existing copy.",
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
            target_audience: {
                type: "string",
                description:
                    "Optional audience descriptor to include in title formulas (e.g. 'BI analysts')",
            },
        },
        required: [],
    },
};

async function handler({ content, filepath, primary_keyword, target_audience }) {
    const rawContent = await loadContent({ content, filepath });

    const { $, isHtml } = parseContent(rawContent);
    const plain = extractPlainText($);

    const existingTitle = $("title").text().trim() || null;
    const existingMeta =
        $('meta[name="description"]').attr("content")?.trim() || null;

    const h1Text = $("h1").first().text().trim() || null;
    const firstPara = $("p").first().text().trim() || plain.slice(0, 300);
    const kw = primary_keyword || "";

    // Build title suggestions
    const titleSuggestions = [];
    if (kw) {
        const cap = kw.charAt(0).toUpperCase() + kw.slice(1);
        titleSuggestions.push(`${cap}: A Complete Guide`);
        if (target_audience) {
            titleSuggestions.push(
                `How to ${cap} | Guide for ${target_audience}`
            );
        }
        titleSuggestions.push(`${cap}: What You Need to Know`);
    } else if (h1Text) {
        titleSuggestions.push(h1Text.slice(0, 60));
    } else {
        titleSuggestions.push("Add a primary keyword to get title suggestions");
    }

    // Build meta description suggestion
    let metaSuggestion = "";
    if (kw && firstPara) {
        const condensed = firstPara.slice(0, 120).trim();
        const cap = kw.charAt(0).toUpperCase() + kw.slice(1);
        metaSuggestion = `${cap}: ${condensed}...`;
    } else if (firstPara) {
        metaSuggestion = firstPara.slice(0, 155).trim() + "...";
    }

    // URL slug from keyword or h1
    const slugBase = kw || h1Text || "your-page-title";
    const slug =
        "/blog/" +
        slugBase
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-")
            .slice(0, 60);

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
