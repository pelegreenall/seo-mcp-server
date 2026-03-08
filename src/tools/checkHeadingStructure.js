const { parseContent } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_heading_structure",
    description:
        "Validate the heading hierarchy (H1 > H2 > H3) of the content. Flags skipped levels, multiple H1s, missing H1s, and empty heading tags. Returns a visual heading tree.",
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

async function handler({ content, filepath }) {
    const rawContent = await loadContent({ content, filepath });

    const { $ } = parseContent(rawContent);

    const headings = [];
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
        const tag = el.tagName.toLowerCase();
        headings.push({ level: parseInt(tag[1]), text: $(el).text().trim() });
    });

    const issues = [];

    // H1 count checks
    const h1s = headings.filter((h) => h.level === 1);
    if (h1s.length === 0)
        issues.push("No H1 found - every page needs exactly one H1");
    if (h1s.length > 1)
        issues.push(
            `${h1s.length} H1 tags found - there should only be one H1 per page`
        );

    // Hierarchy / order checks
    let prevLevel = 0;
    for (const h of headings) {
        if (prevLevel === 0 && h.level !== 1) {
            issues.push(
                `First heading is H${h.level} ("${h.text}") - content should start with H1`
            );
        } else if (prevLevel > 0 && h.level > prevLevel + 1) {
            issues.push(
                `Heading level skipped: H${prevLevel} to H${h.level} at "${h.text}"`
            );
        }
        prevLevel = h.level;
    }

    // Empty heading check
    headings.forEach((h) => {
        if (!h.text) issues.push(`Empty H${h.level} tag found`);
    });

    // Visual tree
    const tree = headings.map(
        (h) => "  ".repeat(h.level - 1) + `H${h.level}: ${h.text || "(empty)"}`
    );

    return {
        heading_count: headings.length,
        h1_count: headings.filter((h) => h.level === 1).length,
        h2_count: headings.filter((h) => h.level === 2).length,
        h3_count: headings.filter((h) => h.level === 3).length,
        h4_plus_count: headings.filter((h) => h.level >= 4).length,
        issues: issues.length > 0 ? issues : ["Heading structure looks clean"],
        heading_tree: tree,
        all_headings: headings,
    };
}

module.exports = { schema, handler };
