const fs = require("fs");
const path = require("path");
const {
    parseContent,
    extractPlainText,
    countWords,
} = require("../utils/content");
const { extractHtmlFromDocx } = require("../utils/docx");

const schema = {
    name: "check_keyword_density",
    description:
        "Check how often a specific keyword appears in the content, its density percentage, and where each occurrence sits in context.",
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
            keyword: {
                type: "string",
                description: "The keyword to check",
            },
            context_window: {
                type: "number",
                description:
                    "Number of characters to show around each match (default 50)",
            },
        },
        required: ["keyword"],
    },
};

async function handler({ content, filepath, keyword, context_window = 50 }) {
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

    const { $ } = parseContent(rawContent);
    const plain = extractPlainText($);
    const wordCount = countWords(plain);
    const kw = keyword.toLowerCase();

    const re = new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    const matches = [...plain.matchAll(re)];

    const occurrences = matches.map((m) => {
        const start = Math.max(0, m.index - context_window);
        const end = Math.min(plain.length, m.index + kw.length + context_window);
        return {
            position: m.index,
            context: "..." + plain.slice(start, end).trim() + "...",
        };
    });

    const density = wordCount > 0 ? (matches.length / wordCount) * 100 : 0;

    let assessment;
    if (density === 0) assessment = "Keyword not found";
    else if (density < 0.5) assessment = "Under-optimised (below 0.5%)";
    else if (density <= 2.0) assessment = "Good range (0.5% - 2.0%)";
    else if (density <= 3.0)
        assessment = "Borderline - risk of over-optimisation";
    else assessment = "Over-optimised - likely to hurt rankings";

    return {
        keyword,
        total_words: wordCount,
        occurrences_count: matches.length,
        density_percent: parseFloat(density.toFixed(2)),
        assessment,
        occurrences,
    };
}

module.exports = { schema, handler };
