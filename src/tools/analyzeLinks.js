const { parseContent } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "analyze_links",
    description:
        "Analyzes internal and external links within the content. Checks for missing internal links, external link counts, and identifies unoptimized 'toxic' anchor text (e.g. 'click here').",
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
        },
        required: [],
    },
};

const TOXIC_ANCHORS = ["click here", "read more", "learn more", "here", "this link", "this article", "this page", "more info", "website"];

function isToxicAnchor(text) {
    if (!text) return true;
    const clean = text.toLowerCase().trim().replace(/[.,!?'"]/g, "");
    return TOXIC_ANCHORS.includes(clean);
}

function isInternal(href) {
    if (!href) return false;
    // Assume internal if it starts with / or #, or contains 'veritly'
    if (href.startsWith("/") || href.startsWith("#")) return true;
    if (href.toLowerCase().includes("veritly.co")) return true;
    return false;
}

async function handler({ content, filepath }) {
    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);

    const internalLinks = [];
    const externalLinks = [];
    const warnings = [];

    $("a").each((_, el) => {
        const href = $(el).attr("href") || "";
        const anchorText = $(el).text().trim();
        
        const linkData = {
            href,
            anchor_text: anchorText,
            toxic_anchor: isToxicAnchor(anchorText)
        };

        if (isInternal(href)) {
            internalLinks.push(linkData);
        } else {
            externalLinks.push(linkData);
        }

        if (linkData.toxic_anchor) {
            warnings.push(`Unoptimized anchor text found: "${anchorText}" for link ${href}. Use descriptive keywords instead.`);
        }
    });

    if (internalLinks.length === 0) {
        warnings.push("No internal links found. Add links to other relevant posts on your site to improve SEO structure.");
    }
    
    if (externalLinks.length === 0) {
        warnings.push("No external links found. Linking to high-authority external sources can improve content credibility.");
    }

    return {
        internal_link_count: internalLinks.length,
        external_link_count: externalLinks.length,
        total_links: internalLinks.length + externalLinks.length,
        warnings: warnings.length > 0 ? warnings : ["All links look optimized and healthy!"],
        internal_links_details: internalLinks,
        external_links_details: externalLinks,
        tips: [
            "Internal links help search engines crawl your site and distribute page authority.",
            "External links should point to reputable, high-authority domains.",
            "Always use descriptive, keyword-rich anchor text instead of generic phrases like 'click here'."
        ]
    };
}

module.exports = { schema, handler };
