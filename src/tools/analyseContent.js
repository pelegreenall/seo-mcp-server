const fs = require("fs");
const path = require("path");
const {
    parseContent,
    extractPlainText,
    countWords,
    keywordInText,
} = require("../utils/content");
const { extractHtmlFromDocx } = require("../utils/docx");

const schema = {
    name: "analyse_content",
    description:
        "Run a full SEO audit on unpublished HTML or Markdown content. Returns word count, heading structure, keyword checks, meta tag status, internal links, and a pass/fail checklist.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML or Markdown content to analyse",
            },
            filepath: {
                type: "string",
                description: "Absolute path to a local file (.docx, .html, .md, .txt) to analyse",
            },
            primary_keyword: {
                type: "string",
                description: "The main keyword this content should rank for",
            },
            secondary_keywords: {
                type: "array",
                items: { type: "string" },
                description: "Supporting keywords to check for (optional)",
            },
        },
        required: [],
    },
};

async function handler({ content, filepath, primary_keyword, secondary_keywords = [] }) {
    let rawContent = content;

    if (filepath) {
        if (!fs.existsSync(filepath)) {
            throw new Error(`File not found: ${filepath}`);
        }
        const ext = path.extname(filepath).toLowerCase();
        if (ext === ".docx") {
            rawContent = await extractHtmlFromDocx(filepath);
        } else {
            rawContent = fs.readFileSync(filepath, "utf8");
        }
    }

    if (!rawContent) {
        throw new Error("No content provided (provide 'content' or a valid 'filepath')");
    }

    const { $, isHtml } = parseContent(rawContent);
    const plain = extractPlainText($);
    const wordCount = countWords(plain);

    // --- Title / meta (only meaningful for HTML) ---
    const titleTag = $("title").text().trim() || null;
    const metaDesc =
        $('meta[name="description"]').attr("content")?.trim() || null;

    // --- Headings ---
    const headings = [];
    ["h1", "h2", "h3", "h4"].forEach((tag) => {
        $(tag).each((_, el) => {
            headings.push({ level: parseInt(tag[1]), text: $(el).text().trim() });
        });
    });

    const h1s = headings.filter((h) => h.level === 1);
    const h2s = headings.filter((h) => h.level === 2);
    const h3s = headings.filter((h) => h.level === 3);

    // --- Keyword checks ---
    const kw = primary_keyword?.toLowerCase() || null;

    const kwCountBody = kw ? keywordInText(kw, plain) : null;
    const kwDensity =
        kw && wordCount > 0 ? ((kwCountBody / wordCount) * 100).toFixed(2) : null;

    const kwInTitle =
        kw && titleTag
            ? titleTag.toLowerCase().includes(kw)
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
    const kwInMeta = kw && metaDesc ? metaDesc.toLowerCase().includes(kw) : false;

    // --- Secondary keywords ---
    const secondaryResults = secondary_keywords.map((sk) => ({
        keyword: sk,
        count: keywordInText(sk.toLowerCase(), plain),
    }));

    // --- Internal / external links (HTML only) ---
    let internalLinks = null;
    let externalLinks = null;
    if (isHtml) {
        internalLinks = [];
        externalLinks = [];
        $("a[href]").each((_, el) => {
            const href = $(el).attr("href") || "";
            const text = $(el).text().trim();
            if (href.startsWith("http")) {
                externalLinks.push({ href, text });
            } else {
                internalLinks.push({ href, text });
            }
        });
    }

    // --- Heading hierarchy issues ---
    const hierarchyIssues = [];
    let prevLevel = 0;
    for (const h of headings) {
        if (prevLevel > 0 && h.level > prevLevel + 1) {
            hierarchyIssues.push(
                `Skipped from H${prevLevel} to H${h.level}: "${h.text}"`
            );
        }
        prevLevel = h.level;
    }

    // --- Audit checklist ---
    const checks = {
        has_title_tag: isHtml ? !!titleTag : "N/A (non-HTML)",
        title_tag_length_ok: isHtml
            ? titleTag
                ? titleTag.length <= 60
                : false
            : "N/A",
        has_meta_description: isHtml ? !!metaDesc : "N/A (non-HTML)",
        meta_description_length_ok: isHtml
            ? metaDesc
                ? metaDesc.length <= 160
                : false
            : "N/A",
        single_h1: h1s.length === 1,
        has_h2s: h2s.length > 0,
        keyword_in_h1_or_title: kw ? kwInTitle : "N/A (no keyword provided)",
        keyword_in_first_paragraph: kw ? kwInFirstParagraph : "N/A",
        keyword_in_h2: kw ? kwInH2 : "N/A",
        keyword_in_meta: isHtml ? (kw ? kwInMeta : "N/A") : "N/A (non-HTML)",
        heading_hierarchy_clean: hierarchyIssues.length === 0,
        word_count_sufficient: wordCount >= 700,
    };

    return {
        summary: {
            word_count: wordCount,
            content_type: isHtml ? "HTML" : "Markdown / Plain Text",
            h1_count: h1s.length,
            h2_count: h2s.length,
            h3_count: h3s.length,
            internal_link_count: internalLinks ? internalLinks.length : "N/A",
            external_link_count: externalLinks ? externalLinks.length : "N/A",
        },
        title_tag: titleTag,
        meta_description: metaDesc,
        headings,
        keyword_analysis: kw
            ? {
                primary_keyword,
                count_in_body: kwCountBody,
                density_percent: parseFloat(kwDensity),
                in_title_or_h1: kwInTitle,
                in_first_paragraph: kwInFirstParagraph,
                in_h2: kwInH2,
                in_meta_description: isHtml ? kwInMeta : "N/A",
                secondary_keywords: secondaryResults,
            }
            : "No primary keyword provided",
        heading_hierarchy_issues:
            hierarchyIssues.length > 0 ? hierarchyIssues : "None",
        internal_links: internalLinks,
        audit_checklist: checks,
    };
}

module.exports = { schema, handler };
