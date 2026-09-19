const {
    parseContent,
    getSections,
    splitSentences,
    countWords,
    isQuestionHeading,
    detectPreamble,
} = require("../utils/content");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_ai_retrievability",
    description:
        "Scores how likely the content is to be retrieved and cited by AI Overviews, ChatGPT, Perplexity and other LLM answer engines. Unlike classic SEO checks, this analyses the content chunk-by-chunk (one chunk per H2), because retrievers pull a single section out of context rather than reading the whole page. Checks self-contained sections, orphan pronoun openers, extractable/quantified claims, answer-first paragraphs, chunk sizing and structured formats.",
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
                description:
                    "Optional. The main entity/topic of the page. Used to check that sections restate the subject instead of relying on pronouns.",
            },
        },
        required: [],
    },
};

// ─── Orphan-reference detection ───────────────────────────────────────────────
// A chunk that opens by pointing backwards is unusable on its own: the retriever
// hands the model "It also supports…" with nothing to resolve "it" against.

const BARE_PRONOUN =
    /^(it|they|them|these|those|this|that|he|she|its|their|his|her|such|both|either|neither|the former|the latter)\b(?!\s+[a-z]*(?:ing|ed)\b)/i;

const VAGUE_DEMONSTRATIVE =
    /^(this|that|these|those)\s+(approach|method|process|tool|feature|step|steps|technique|strategy|issue|problem|concept|idea|change|option|setting|solution|system|point|reason|benefit|way|thing|topic|area|section|part)\b/i;

const BACKWARD_CONNECTIVE =
    /^(also|however|additionally|furthermore|moreover|therefore|thus|consequently|meanwhile|similarly|likewise|nonetheless|nevertheless|in contrast|on the other hand|as mentioned|as we saw|as discussed|as noted|as covered|as explained|building on|following on|continuing|next|then|finally|lastly|again|in addition|by contrast|that said|with that in mind|once you(?:'ve| have) done)\b/i;

function detectOrphanOpener(sentence) {
    if (!sentence) return null;
    const s = sentence.trim();

    if (VAGUE_DEMONSTRATIVE.test(s)) {
        return {
            type: "vague_demonstrative",
            reason: `Opens with a vague back-reference ("${s.split(/\s+/).slice(0, 2).join(" ")}…") that only makes sense if the reader has the previous section.`,
        };
    }
    if (BARE_PRONOUN.test(s)) {
        return {
            type: "bare_pronoun",
            reason: `Opens with the pronoun "${s.split(/\s+/)[0]}" — a retriever has nothing to resolve it against.`,
        };
    }
    if (BACKWARD_CONNECTIVE.test(s)) {
        return {
            type: "backward_connective",
            reason: `Opens with "${s.split(/\s+/)[0].replace(/[,:]$/, "")}", which points back at content the retriever will not have.`,
        };
    }
    return null;
}

// ─── Extractable claim detection ──────────────────────────────────────────────

const QUANTIFIED = [
    /\d+(?:\.\d+)?\s?%/,
    /\bper cent\b/i,
    /[$£€¥]\s?\d/,
    /\b(?:19|20)\d{2}\b/,
    /\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion|trillion|thousand|bn|m\b|k\b|x\b|times|percent|percentage points|bps|ms|seconds|minutes|hours|days|weeks|months|years|users|customers|respondents|participants|sites|pages|words)\b/i,
    /\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
    /\b\d+(?:\.\d+)?\s*(?:out of|in)\s*\d+/i,
];

const COMMON_CAPITALISED = new Set([
    "The", "A", "An", "I", "We", "You", "It", "This", "That", "These", "Those",
    "If", "When", "While", "But", "And", "Or", "For", "So", "In", "On", "At",
    "To", "Of", "As", "By", "With", "From", "Your", "Our", "Their", "His",
    "Her", "They", "He", "She", "There", "Here", "What", "Why", "How", "Who",
    "Where", "Which", "Most", "Many", "Some", "All", "Each", "Every", "Both",
    "After", "Before", "Once", "Because", "Although", "However", "Instead",
]);

function hasQuantifiedClaim(sentence) {
    return QUANTIFIED.some((re) => re.test(sentence));
}

function namedEntities(sentence) {
    const words = sentence.split(/\s+/);
    return words
        .slice(1) // skip the sentence-initial capital
        .filter((w) => {
            const clean = w.replace(/[^A-Za-z0-9.\-&]/g, "");
            if (clean.length < 2) return false;
            if (COMMON_CAPITALISED.has(clean)) return false;
            return /^[A-Z][A-Za-z0-9.\-&]*$/.test(clean);
        });
}

// ─── Answer-first detection ──────────────────────────────────────────────────
// isQuestionHeading / detectPreamble are shared with check_snippet_optimization
// via utils/content so the two tools can never contradict each other.

const STOPWORDS = new Set([
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with",
    "is", "are", "was", "were", "be", "been", "do", "does", "did", "can", "will",
    "should", "your", "you", "my", "our", "it", "its", "this", "that", "these",
    "those", "what", "why", "how", "who", "when", "where", "which", "about",
    "from", "as", "at", "by", "into", "more", "most", "best", "top",
]);

function contentWords(text) {
    return (text || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// ─── Handler ──────────────────────────────────────────────────────────────────

const IDEAL_MIN = 150;
const IDEAL_MAX = 400;
const HARD_MAX = 700;
const THIN_MIN = 120;
const INTRO_MIN = 40;

async function handler({ content, filepath, primary_keyword }) {
    const rawContent = await loadContent({ content, filepath });
    const { $ } = parseContent(rawContent);

    const sections = getSections($);
    const h1Text = $("h1").first().text().trim();

    if (sections.length === 0) {
        // Degrade rather than throw — calculate_seo_score folds this result in,
        // and one empty document shouldn't take the whole audit down.
        return {
            retrievability_score_percent: 0,
            status: "No analysable content — nothing here can be retrieved or cited",
            summary: {
                sections_analysed: 0,
                self_contained_sections: 0,
                question_headings: 0,
                answer_first_sections: 0,
                quantified_claim_sentences: 0,
                entity_bearing_sentences: 0,
                total_sentences: 0,
                sections_with_list_or_table: 0,
                average_section_words: 0,
            },
            score_components: [],
            section_analysis: [],
            prioritised_fixes: [
                { priority_points: 100, area: "Content", action: "The document has no body content to analyse." },
            ],
            tips: ["Add body content with H2 headings — each H2 section becomes one retrievable chunk."],
        };
    }

    const kwWords = primary_keyword ? contentWords(primary_keyword) : [];

    let totalSentences = 0;
    let quantifiedSentences = 0;
    let entitySentences = 0;
    let questionSections = 0;
    let answerFirstSections = 0;
    let selfContainedSections = 0;
    let idealSizedSections = 0;
    let sectionsWithStructure = 0;

    const sectionReports = sections.map((section) => {
        const sentences = splitSentences(section.text);
        totalSentences += sentences.length;

        const sectionQuantified = sentences.filter(hasQuantifiedClaim);
        const sectionEntities = sentences.filter((s) => namedEntities(s).length > 0);
        quantifiedSentences += sectionQuantified.length;
        entitySentences += sectionEntities.length;

        // An intro often opens with a byline or date line — skip past that to the
        // first real paragraph, or the check grades the metadata instead of the copy.
        const firstParagraph = section.is_intro
            ? section.paragraphs.find((para) => countWords(para) >= 12) || section.paragraphs[0] || ""
            : section.paragraphs[0] || "";
        const firstSentence = splitSentences(firstParagraph)[0] || "";

        // 1. Self-contained?
        const orphan = detectOrphanOpener(firstSentence);

        // 2. Subject restated?
        // Judge the subject against the opening ~60 words rather than a fixed
        // sentence count, so a short lead-in sentence doesn't hide the subject.
        const openingText = section.text.split(/\s+/).slice(0, 60).join(" ").toLowerCase();
        const headingWords = section.is_intro
            ? contentWords(h1Text).concat(kwWords)
            : contentWords(section.heading);
        const subjectTerms = headingWords.length > 0 ? headingWords : kwWords;
        const subjectRestated =
            subjectTerms.length === 0
                ? null
                : subjectTerms.some((w) => openingText.includes(w)) ||
                  (kwWords.length > 0 && kwWords.every((w) => openingText.includes(w)));

        const selfContained = !orphan && subjectRestated !== false;
        if (selfContained) selfContainedSections++;

        // 3. Chunk sizing
        let sizeVerdict, sizeAdvice;
        if (section.is_intro) {
            // An intro is a lede, not a body chunk — it only needs to stand alone.
            if (section.word_count < INTRO_MIN) {
                sizeVerdict = "Thin";
                sizeAdvice = `${section.word_count} words — too short to work as the opening chunk. Give it at least ${INTRO_MIN}.`;
            } else if (section.word_count <= IDEAL_MAX) {
                sizeVerdict = "Ideal";
                sizeAdvice = `${section.word_count} words — appropriate for an opening chunk.`;
                idealSizedSections++;
            } else {
                sizeVerdict = "Too long";
                sizeAdvice = `${section.word_count} words before the first H2 — add a heading so this becomes a targetable chunk.`;
            }
        } else if (section.word_count < THIN_MIN) {
            sizeVerdict = "Thin";
            sizeAdvice = `${section.word_count} words — too thin to stand alone as a retrievable chunk. Aim for ${IDEAL_MIN}–${IDEAL_MAX}.`;
        } else if (section.word_count <= IDEAL_MAX) {
            sizeVerdict = "Ideal";
            sizeAdvice = `${section.word_count} words — sits in the ${IDEAL_MIN}–${IDEAL_MAX} sweet spot for retrieval.`;
            idealSizedSections++;
        } else if (section.word_count <= HARD_MAX) {
            sizeVerdict = "Long";
            sizeAdvice = `${section.word_count} words — still usable, but the answer may get diluted. Consider splitting with an H3.`;
        } else {
            sizeVerdict = "Too long";
            sizeAdvice = `${section.word_count} words — this is one oversized chunk. Split it with H3 subheadings so each idea is retrievable separately.`;
        }

        // 4. Answer-first (question headings only)
        let answerFirst = null;
        let answerFirstNote = null;
        if (isQuestionHeading(section.heading) && !section.is_intro) {
            questionSections++;
            if (!firstSentence) {
                answerFirst = false;
                answerFirstNote = "No paragraph directly follows this question heading.";
            } else {
                const preamble = detectPreamble(firstSentence);
                const restates = headingWords.some((w) => firstSentence.toLowerCase().includes(w));
                if (preamble) {
                    answerFirst = false;
                    answerFirstNote = `Opens with a preamble instead of the answer: "${firstSentence.slice(0, 80)}…" — lead with the answer itself.`;
                } else if (!restates) {
                    answerFirst = false;
                    const definitional = /^what\s+(is|are|was|were)\s+(.+?)\??$/i.exec(section.heading.trim());
                    answerFirstNote = definitional
                        ? `The opening sentence does not restate the subject. Start with "${definitional[2]} ${/s$/i.test(definitional[2]) ? "are" : "is"}…" so the answer stands alone.`
                        : "The opening sentence does not name the subject of the question. Restate it explicitly so the paragraph works as a standalone answer.";
                } else {
                    answerFirst = true;
                    answerFirstNote = "Opens with a direct, self-contained answer.";
                    answerFirstSections++;
                }
            }
        }

        // 5. Structured formats
        const hasStructure = section.list_count > 0 || section.table_count > 0;
        if (hasStructure) sectionsWithStructure++;

        const issues = [];
        if (orphan) issues.push(orphan.reason);
        if (subjectRestated === false) {
            issues.push("The opening sentences never name the section's subject — a retrieved chunk would read as being about nothing in particular.");
        }
        if (sizeVerdict !== "Ideal") issues.push(sizeAdvice);
        if (answerFirst === false) issues.push(answerFirstNote);
        if (sectionQuantified.length === 0 && section.word_count >= THIN_MIN) {
            issues.push("No quantified claims (figures, dates, percentages) — nothing here is concrete enough for an AI answer to quote and attribute.");
        }

        return {
            heading: section.heading,
            word_count: section.word_count,
            chunk_size: sizeVerdict,
            self_contained: selfContained,
            orphan_opener: orphan ? orphan.type : null,
            subject_restated: subjectRestated === null ? "N/A" : subjectRestated,
            is_question_heading: isQuestionHeading(section.heading) && !section.is_intro,
            answer_first: answerFirst === null ? "N/A" : answerFirst,
            answer_first_note: answerFirstNote,
            quantified_claim_count: sectionQuantified.length,
            sentence_count: sentences.length,
            has_list_or_table: hasStructure,
            first_sentence: firstSentence ? firstSentence.slice(0, 160) : null,
            quantified_claim_examples: sectionQuantified.slice(0, 2).map((s) => s.slice(0, 140)),
            issues: issues.length ? issues : ["This chunk would survive retrieval intact."],
        };
    });

    // ─── Scoring (out of 100) ─────────────────────────────────────────────────

    const components = [];
    const sectionCount = sections.length;

    const selfContainedRatio = selfContainedSections / sectionCount;
    components.push({
        key: "self_contained_chunks",
        label: `Self-contained sections (${selfContainedSections}/${sectionCount})`,
        earned: Math.round(selfContainedRatio * 30),
        max: 30,
        passed: selfContainedRatio >= 0.8,
        fix:
            selfContainedRatio >= 0.8
                ? null
                : "Rewrite section openers so each one names its own subject instead of starting with a pronoun or a backward connective.",
    });

    const quantifiedRatio = totalSentences > 0 ? quantifiedSentences / totalSentences : 0;
    const quantifiedPercent = Math.round(quantifiedRatio * 100);
    let quantifiedEarned;
    if (quantifiedRatio >= 0.15) quantifiedEarned = 20;
    else if (quantifiedRatio >= 0.08) quantifiedEarned = 12;
    else if (quantifiedRatio >= 0.04) quantifiedEarned = 6;
    else quantifiedEarned = 0;
    components.push({
        key: "extractable_claims",
        label: `Quantified claim density (${quantifiedPercent}% of sentences)`,
        earned: quantifiedEarned,
        max: 20,
        passed: quantifiedRatio >= 0.15,
        fix:
            quantifiedRatio >= 0.15
                ? null
                : "Add specific figures, dates, percentages and named sources. Generic prose gets paraphrased away; a concrete stat gets quoted and cited.",
    });

    const sizeRatio = idealSizedSections / sectionCount;
    components.push({
        key: "chunk_sizing",
        label: `Sections sized ${IDEAL_MIN}–${IDEAL_MAX} words (${idealSizedSections}/${sectionCount})`,
        earned: Math.round(sizeRatio * 20),
        max: 20,
        passed: sizeRatio >= 0.6,
        fix:
            sizeRatio >= 0.6
                ? null
                : `Resize sections toward ${IDEAL_MIN}–${IDEAL_MAX} words — split oversized ones with H3s and merge or expand thin ones.`,
    });

    const hasQuestions = questionSections > 0;
    const answerRatio = hasQuestions ? answerFirstSections / questionSections : 0;
    components.push({
        key: "answer_first",
        label: hasQuestions
            ? `Answer-first paragraphs under question headings (${answerFirstSections}/${questionSections})`
            : "Answer-first paragraphs (no question headings found)",
        earned: hasQuestions ? Math.round(answerRatio * 15) : 0,
        max: 15,
        passed: hasQuestions ? answerRatio >= 0.8 : false,
        applicable: hasQuestions,
        fix: hasQuestions
            ? answerRatio >= 0.8
                ? null
                : "Make the paragraph under each question heading open with the answer, restating the subject — not with a preamble."
            : "Add question-phrased H2/H3s with direct answers beneath them — question headings are the main hook for AI Overview citations.",
    });

    const structureRatio = sectionsWithStructure / sectionCount;
    let structureEarned;
    if (structureRatio >= 0.4) structureEarned = 15;
    else if (structureRatio >= 0.2) structureEarned = 9;
    else if (structureRatio > 0) structureEarned = 4;
    else structureEarned = 0;
    components.push({
        key: "structured_formats",
        label: `Sections with a list or table (${sectionsWithStructure}/${sectionCount})`,
        earned: structureEarned,
        max: 15,
        passed: structureRatio >= 0.4,
        fix:
            structureRatio >= 0.4
                ? null
                : "Convert some prose into lists, steps or comparison tables. Structured blocks are cited by AI answers far more often than paragraphs.",
    });

    const applicable = components.filter((c) => c.applicable !== false);
    const earned = applicable.reduce((s, c) => s + c.earned, 0);
    const max = applicable.reduce((s, c) => s + c.max, 0);
    const scorePercent = max > 0 ? Math.round((earned / max) * 100) : 0;

    let status;
    if (scorePercent >= 80) status = "Strong — this content is shaped for AI retrieval and citation";
    else if (scorePercent >= 60) status = "Moderate — retrievable, but several chunks would break out of context";
    else if (scorePercent >= 40) status = "Weak — most chunks depend on surrounding context to make sense";
    else status = "Poor — this reads as one linear page, not as retrievable chunks";

    const prioritisedFixes = components
        .filter((c) => !c.passed && c.fix)
        .sort((a, b) => b.max - a.max)
        .map((c) => ({ priority_points: c.max, area: c.label, action: c.fix }));

    return {
        retrievability_score_percent: scorePercent,
        status,
        summary: {
            sections_analysed: sectionCount,
            self_contained_sections: selfContainedSections,
            question_headings: questionSections,
            answer_first_sections: answerFirstSections,
            quantified_claim_sentences: quantifiedSentences,
            entity_bearing_sentences: entitySentences,
            total_sentences: totalSentences,
            sections_with_list_or_table: sectionsWithStructure,
            average_section_words:
                sectionCount > 0
                    ? Math.round(sections.reduce((s, x) => s + x.word_count, 0) / sectionCount)
                    : 0,
        },
        score_components: components,
        section_analysis: sectionReports,
        prioritised_fixes: prioritisedFixes.length
            ? prioritisedFixes
            : ["No retrievability issues found — every chunk stands on its own."],
        tips: [
            "AI answer engines retrieve one section at a time. Write every H2 section as if it were the only thing the model will see.",
            "Never open a section with 'It', 'This approach' or 'Also' — restate the subject by name.",
            "Specific, attributable facts (figures, dates, named sources) get quoted; generic advice gets paraphrased without a citation.",
            "Lists, steps and comparison tables are cited disproportionately often — convert prose where the content allows it.",
        ],
    };
}

module.exports = { schema, handler };
