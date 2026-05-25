const { parseContent, extractPlainText } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_semantic_coverage",
    description:
        "Analyzes content to check if it covers expected semantic/LSI keywords. This ensures topical breadth and authority rather than just keyword density.",
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
            expected_terms: {
                type: "array",
                items: {
                    type: "string"
                },
                description: "List of LSI / related semantic terms expected in the content (e.g., ['ISC2', 'exam format', 'CPE credits'])",
            }
        },
        required: ["expected_terms"],
    },
};

async function handler({ content, filepath, expected_terms }) {
    if (!expected_terms || !Array.isArray(expected_terms) || expected_terms.length === 0) {
        throw new Error("expected_terms must be a non-empty array of strings");
    }

    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);
    const plainText = extractPlainText($).toLowerCase();

    const foundTerms = [];
    const missingTerms = [];

    expected_terms.forEach(term => {
        const cleanTerm = term.trim().toLowerCase();
        if (plainText.includes(cleanTerm)) {
            foundTerms.push(term);
        } else {
            missingTerms.push(term);
        }
    });

    const scorePercent = Math.round((foundTerms.length / expected_terms.length) * 100);

    let status = "";
    if (scorePercent >= 80) {
        status = "Excellent Semantic Coverage";
    } else if (scorePercent >= 50) {
        status = "Moderate Semantic Coverage - consider adding missing topics";
    } else {
        status = "Poor Semantic Coverage - significant topical gaps detected";
    }

    return {
        coverage_score_percent: scorePercent,
        status,
        terms_found: foundTerms,
        terms_missing: missingTerms,
        tips: [
            "Search engines look for 'topical authority'. Using natural variations and related concepts proves you've covered the subject comprehensively.",
            "Avoid awkwardly stuffing missing terms into existing sentences. Add new paragraphs or sections to address the missing concepts properly."
        ]
    };
}

module.exports = { schema, handler };
