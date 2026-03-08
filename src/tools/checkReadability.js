const {
    parseContent,
    extractPlainText,
    countWords,
    avg,
} = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_readability",
    description:
        "Analyse readability of the content. Returns Flesch Reading Ease score, average sentence and paragraph length, and flags long sentences or paragraphs.",
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
    const plain = extractPlainText($);
    const wordCount = countWords(plain);

    const sentences = plain
        .split(/[.!?]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    const sentenceCount = sentences.length;

    const wordsPerSentence = sentences.map((s) => countWords(s));
    const avgWordsPerSentence = parseFloat(avg(wordsPerSentence).toFixed(1));
    const longSentences = sentences.filter((s) => countWords(s) > 25);

    const paragraphs = plain
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
    const paragraphCount = paragraphs.length;
    const avgWordsPerParagraph = parseFloat(
        (wordCount / Math.max(paragraphCount, 1)).toFixed(1)
    );
    const longParagraphs = paragraphs.filter((p) => countWords(p) > 100);

    // Flesch Reading Ease (simplified syllable approximation)
    const syllableCount = plain
        .toLowerCase()
        .replace(/[^a-z]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .reduce((acc, word) => {
            const syls = word
                .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
                .replace(/^y/, "")
                .match(/[aeiouy]{1,2}/g);
            return acc + (syls ? syls.length : 1);
        }, 0);

    const fre =
        sentenceCount > 0
            ? parseFloat(
                (
                    206.835 -
                    1.015 * (wordCount / sentenceCount) -
                    84.6 * (syllableCount / wordCount)
                ).toFixed(1)
            )
            : 0;

    let freLabel;
    if (fre >= 70) freLabel = "Easy to read (suitable for general web)";
    else if (fre >= 60)
        freLabel = "Standard (good for B2B / professional content)";
    else if (fre >= 50) freLabel = "Fairly difficult";
    else freLabel = "Difficult - consider simplifying";

    const issues = [];
    if (avgWordsPerSentence > 25)
        issues.push(
            `Average sentence length is ${avgWordsPerSentence} words - aim for under 25`
        );
    if (longSentences.length > 0)
        issues.push(
            `${longSentences.length} sentence(s) exceed 25 words - consider splitting`
        );
    if (avgWordsPerParagraph > 80)
        issues.push(
            `Average paragraph length is ${avgWordsPerParagraph} words - break into shorter chunks`
        );
    if (wordCount < 700)
        issues.push(`Word count (${wordCount}) is below the recommended 700 minimum`);

    return {
        word_count: wordCount,
        sentence_count: sentenceCount,
        paragraph_count: paragraphCount,
        avg_words_per_sentence: avgWordsPerSentence,
        avg_words_per_paragraph: avgWordsPerParagraph,
        long_sentence_count: longSentences.length,
        long_paragraph_count: longParagraphs.length,
        flesch_reading_ease: fre,
        flesch_label: freLabel,
        issues: issues.length > 0 ? issues : ["No readability issues found"],
        long_sentences:
            longSentences.length > 0
                ? longSentences.slice(0, 5).map((s) => s.slice(0, 120) + "...")
                : [],
    };
}

module.exports = { schema, handler };
