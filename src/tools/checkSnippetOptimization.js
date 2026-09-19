const { parseContent, isQuestionHeading, detectPreamble, splitSentences } = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_snippet_optimization",
    description:
        "Scans content for question-based H2/H3 headings and analyzes the immediately following paragraph to see if it is optimized for Google Featured Snippets (Position Zero). Checks both the 40-60 word target and whether the paragraph opens with the answer rather than a preamble.",
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

function wordCount(text) {
    return text.split(/\s+/).filter(Boolean).length;
}

async function handler({ content, filepath }) {
    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);

    const snippetOpportunities = [];
    let totalQuestions = 0;
    let totalOptimized = 0;
    let totalBuried = 0;

    $("h2, h3").each((_, el) => {
        const headingText = $(el).text().trim();
        
        if (isQuestionHeading(headingText)) {
            totalQuestions++;
            
            // Look at the immediate next sibling
            const nextEl = $(el).next();
            
            if (nextEl.length && nextEl[0].tagName.toLowerCase() === 'p') {
                const paraText = nextEl.text().trim();
                const count = wordCount(paraText);
                
                let status = "";
                let advice = "";

                // Length is only half of it — a 50-word preamble still wastes
                // the snippet, so check the opening sentence answers directly.
                const firstSentence = splitSentences(paraText)[0] || "";
                const buried = detectPreamble(firstSentence);

                if (buried) {
                    status = "Buried Answer";
                    advice = `The paragraph opens with a preamble ("${firstSentence.slice(0, 60)}…") instead of the answer. Google lifts the opening sentence — lead with the answer itself, then elaborate.`;
                } else if (count >= 40 && count <= 60) {
                    status = "Optimized";
                    advice = "Perfect length for a featured snippet, and it opens with the answer.";
                    totalOptimized++;
                } else if (count < 40) {
                    status = "Too Short";
                    advice = `Currently ${count} words. Expand to 40-60 words to improve snippet chances.`;
                } else {
                    status = "Too Long";
                    advice = `Currently ${count} words. Condense the direct answer to 40-60 words. You can elaborate in the following paragraphs.`;
                }

                if (buried) totalBuried++;

                snippetOpportunities.push({
                    heading: headingText,
                    paragraph_word_count: count,
                    status,
                    advice,
                    opens_with_answer: !buried,
                    paragraph_preview: paraText.slice(0, 100) + "..."
                });
            } else {
                snippetOpportunities.push({
                    heading: headingText,
                    paragraph_word_count: 0,
                    status: "Missing",
                    advice: "Missing a direct paragraph response immediately after the heading.",
                    paragraph_preview: null
                });
            }
        }
    });

    return {
        total_questions_found: totalQuestions,
        total_optimized_snippets: totalOptimized,
        total_buried_answers: totalBuried,
        snippet_opportunities: snippetOpportunities,
        tips: [
            "Featured snippets prefer a concise 40-60 word paragraph directly answering the question.",
            "A 40-60 word paragraph that opens with a preamble still loses the snippet — the opening sentence is what gets lifted.",
            "Ensure the paragraph starts directly with the answer (e.g. 'Data security is...' instead of 'In this article we will discuss...').",
            "Place the paragraph immediately after the H2/H3 question without any images or elements in between."
        ]
    };
}

module.exports = { schema, handler };
