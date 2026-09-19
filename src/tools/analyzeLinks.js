const { parseContent, classifyHref, hostnameOf, normalizeDomain } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const DEFAULT_SITE_DOMAIN = "veritly.co";

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
            site_domain: {
                type: "string",
                description:
                    `The domain being audited (e.g. "example.com"). Absolute links to this domain or its subdomains count as internal. Defaults to "${DEFAULT_SITE_DOMAIN}" — set it when auditing content for any other site, otherwise internal links will be miscounted as external.`,
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

async function handler({ content, filepath, site_domain }) {
    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);

    const siteDomain = normalizeDomain(site_domain) || DEFAULT_SITE_DOMAIN;

    const internalLinks = [];
    const externalLinks = [];
    const otherLinks = [];
    const warnings = [];

    $("a").each((_, el) => {
        const href = $(el).attr("href") || "";
        const anchorText = $(el).text().trim();

        const linkData = {
            href,
            anchor_text: anchorText,
            toxic_anchor: isToxicAnchor(anchorText),
        };

        const kind = classifyHref(href, siteDomain);

        if (kind === "internal") {
            internalLinks.push(linkData);
        } else if (kind === "external") {
            externalLinks.push({ ...linkData, domain: hostnameOf(href) });
        } else {
            otherLinks.push(linkData);
            return; // mailto:/tel: links aren't SEO anchors — don't flag them
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
        site_domain_used: siteDomain,
        internal_link_count: internalLinks.length,
        external_link_count: externalLinks.length,
        other_link_count: otherLinks.length,
        total_links: internalLinks.length + externalLinks.length,
        warnings: warnings.length > 0 ? warnings : ["All links look optimized and healthy!"],
        internal_links_details: internalLinks,
        external_links_details: externalLinks,
        other_links_details: otherLinks,
        tips: [
            "Internal links help search engines crawl your site and distribute page authority.",
            "External links should point to reputable, high-authority domains.",
            "Always use descriptive, keyword-rich anchor text instead of generic phrases like 'click here'.",
            `Internal/external split was calculated against "${siteDomain}" — pass site_domain if that is not the site being audited.`,
        ],
    };
}

module.exports = { schema, handler };
