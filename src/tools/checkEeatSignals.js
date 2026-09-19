const {
    parseContent,
    extractPlainText,
    splitSentences,
    classifyHref,
    hostnameOf,
    normalizeDomain,
    countWords,
} = require("../utils/content");
const { loadContent } = require("../utils/loader");

const DEFAULT_SITE_DOMAIN = "veritly.co";

const schema = {
    name: "check_eeat_signals",
    description:
        "Detects the Experience, Expertise, Authoritativeness and Trust signals Google's quality systems look for: author identification, published/modified dates and content staleness, first-hand experience markers, the authority tier of the sources cited, and statistics stated without any supporting citation. These are the signals that separate content rewarded by the helpful content system from commodity content.",
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
                description: `The domain being audited, so self-links aren't counted as external citations. Defaults to "${DEFAULT_SITE_DOMAIN}".`,
            },
            author_name: {
                type: "string",
                description: "Optional. The intended author, if it isn't in the draft yet — lets the check confirm attribution plans rather than just flagging it missing.",
            },
        },
        required: [],
    },
};

// ─── Source authority tiers ───────────────────────────────────────────────────

const TIER1_SUFFIXES = [".gov", ".edu", ".mil", ".int", ".gov.uk", ".ac.uk", ".edu.au", ".gov.au", ".ac.nz", ".europa.eu"];

const TIER1_DOMAINS = [
    "nist.gov", "iso.org", "w3.org", "ietf.org", "rfc-editor.org", "ieee.org",
    "who.int", "un.org", "oecd.org", "imf.org", "worldbank.org",
    "nature.com", "science.org", "sciencedirect.com", "springer.com", "link.springer.com",
    "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "arxiv.org", "jstor.org", "doi.org",
    "cochranelibrary.com", "bmj.com", "thelancet.com", "nejm.org", "plos.org",
    "acm.org", "owasp.org", "cisa.gov", "enisa.europa.eu", "ons.gov.uk",
];

const TIER2_DOMAINS = [
    "reuters.com", "apnews.com", "bbc.co.uk", "bbc.com", "ft.com", "wsj.com",
    "economist.com", "nytimes.com", "bloomberg.com", "theguardian.com",
    "pewresearch.org", "gartner.com", "forrester.com", "mckinsey.com",
    "developer.mozilla.org", "github.com", "stackoverflow.com",
    "google.com", "developers.google.com", "microsoft.com", "learn.microsoft.com",
    "aws.amazon.com", "cloud.google.com", "apache.org", "python.org", "nodejs.org",
    "statista.com", "harvard.edu", "hbr.org", "mit.edu",
];

function authorityTier(host) {
    if (!host) return 3;
    if (TIER1_SUFFIXES.some((s) => host === s.slice(1) || host.endsWith(s))) return 1;
    if (TIER1_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return 1;
    if (TIER2_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return 2;
    if (/^docs\./.test(host) || /^developer\./.test(host)) return 2;
    return 3;
}

// ─── First-hand experience markers ────────────────────────────────────────────

const EXPERIENCE_PATTERNS = [
    { re: /\b(we|i)\s+(tested|ran|built|measured|benchmarked|audited|surveyed|interviewed|tracked|monitored|compared|trialled|trialed|deployed|migrated|rebuilt)\b/gi, label: "direct testing / doing" },
    { re: /\bin our (test|tests|testing|audit|audits|study|research|experience|analysis|benchmark|benchmarks|trial|trials|survey|case study)\b/gi, label: "first-person research" },
    { re: /\b(we|i)\s+(found|discovered|noticed|observed|learned|learnt)\s+that\b/gi, label: "reported observation" },
    { re: /\b(we|i)'ve\s+(used|run|tested|built|worked|spent|seen|shipped)\b/gi, label: "stated track record" },
    { re: /\bafter\s+(\d+|several|many|two|three|four|five|six)\s+(years|months|weeks|clients|projects|audits|tests)\b/gi, label: "quantified track record" },
    { re: /\b(our|my)\s+(team|clients?|customers?|agency|company|results?|data|findings?|methodology)\b/gi, label: "ownership of the work", weight: 0.5 },
    { re: /\b(screenshot|screenshots|pictured above|shown below|our dashboard|our results)\b/gi, label: "original evidence" },
    { re: /\b(hands-on|first-hand|firsthand|in practice|in the field|real-world)\b/gi, label: "experience framing", weight: 0.25 },
];

// ─── Claims that need a citation ──────────────────────────────────────────────

const STAT_PATTERNS = [
    /\b\d+(?:\.\d+)?\s?%/,
    /\b\d+(?:\.\d+)?\s*(?:x|times)\s+(?:more|less|faster|slower|higher|lower|better|worse|likely)\b/i,
    /\b\d[\d,]*(?:\.\d+)?\s*(?:million|billion|trillion)\b/i,
    /\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:in|out of)\s+(?:two|three|four|five|ten|100|1,?000)\b/i,
    /\b\d+\s*(?:out of|in)\s*\d+\s+(?:people|users|companies|businesses|marketers|sites|websites|respondents)\b/i,
];

const VAGUE_ATTRIBUTION = [
    /\bstudies (?:show|have shown|suggest|find|found)\b/i,
    /\bresearch (?:shows|has shown|suggests|finds|found|indicates)\b/i,
    /\bexperts (?:say|agree|believe|recommend|suggest)\b/i,
    /\b(?:data|statistics|numbers|figures) (?:show|shows|suggest|suggests|indicate|indicates)\b/i,
    /\baccording to (?:some|many|most|recent|a recent) (?:studies|reports|research|surveys|sources)\b/i,
    /\bit(?:'s| is) (?:widely|well) (?:known|documented|established|understood)\b/i,
    /\b(?:many|most|some) (?:experts|people|businesses|marketers) (?:believe|say|agree|report)\b/i,
    /\breports? (?:suggest|indicate|show)\b/i,
    /\bsurveys? (?:show|found|suggest)\b/i,
];

const BYLINE_RE = /\b(?:by|written by|authored by|reviewed by|words by|posted by)\s+([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,3})/;

const MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december";
const VISIBLE_DATE_RE = new RegExp(
    `\\b(?:(?:${MONTHS})\\s+\\d{1,2},?\\s+(?:19|20)\\d{2}|\\d{1,2}\\s+(?:${MONTHS})\\s+(?:19|20)\\d{2}|(?:19|20)\\d{2}-\\d{2}-\\d{2})\\b`,
    "i"
);

// Only phrases that assert the content is current — a plain "in 2025" is a
// legitimate historical reference, not a staleness signal.
const CURRENCY_PHRASE_RE = /\b(?:as of|current as of|updated (?:for|in)|latest\s+(?:\w+\s+){0,2}|guide (?:for|to)|best of|so far in|this year,?|top\s+\d*\s*\w*\s+(?:for|of))\s*((?:19|20)\d{2})\b/gi;

async function handler({ content, filepath, site_domain, author_name }) {
    const rawContent = await loadContent({ content, filepath });
    const { $, isHtml } = parseContent(rawContent);
    const plain = extractPlainText($);
    const siteDomain = normalizeDomain(site_domain) || DEFAULT_SITE_DOMAIN;
    const now = new Date();
    const currentYear = now.getFullYear();

    // ─── 1. Authorship ────────────────────────────────────────────────────────
    const authorSignals = [];
    let authorDetected = null;

    const relAuthor = $('[rel="author"]').first().text().trim();
    if (relAuthor) {
        authorSignals.push(`rel="author" element ("${relAuthor}")`);
        authorDetected = relAuthor;
    }

    const itempropAuthor = $('[itemprop="author"]').first().text().trim();
    if (itempropAuthor) {
        authorSignals.push(`itemprop="author" element ("${itempropAuthor}")`);
        authorDetected = authorDetected || itempropAuthor;
    }

    const metaAuthor = $('meta[name="author"]').attr("content");
    if (metaAuthor) {
        authorSignals.push(`<meta name="author"> ("${metaAuthor}")`);
        authorDetected = authorDetected || metaAuthor;
    }

    const classAuthor = $('.author, .byline, .post-author, [class*="author-name"]').first().text().trim();
    if (classAuthor && classAuthor.length < 120) {
        authorSignals.push(`author/byline element ("${classAuthor.slice(0, 60)}")`);
        authorDetected = authorDetected || classAuthor;
    }

    // Person / author in JSON-LD
    let schemaAuthor = null;
    let schemaPersonEntity = false;
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const parsed = JSON.parse(($(el).contents().text() || "").trim());
            const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
            while (stack.length) {
                const node = stack.pop();
                if (!node || typeof node !== "object") continue;
                if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
                const types = [].concat(node["@type"] || []);
                if (types.includes("Person") && node.name) {
                    schemaPersonEntity = true;
                    schemaAuthor = schemaAuthor || node.name;
                }
                if (node.author) {
                    const a = node.author;
                    schemaAuthor = schemaAuthor || (typeof a === "string" ? a : a.name);
                    if (typeof a === "object" && [].concat(a["@type"] || []).includes("Person")) {
                        schemaPersonEntity = true;
                    }
                }
            }
        } catch (_) {
            /* parse errors are reported by check_structured_data */
        }
    });
    if (schemaAuthor) {
        authorSignals.push(`schema.org author ("${schemaAuthor}")${schemaPersonEntity ? " as a Person entity" : " as a plain string"}`);
        authorDetected = authorDetected || schemaAuthor;
    }

    const bylineMatch = plain.slice(0, 600).match(BYLINE_RE);
    if (bylineMatch) {
        authorSignals.push(`visible byline ("${bylineMatch[0]}")`);
        authorDetected = authorDetected || bylineMatch[1];
    }

    if (!authorDetected && author_name) {
        authorSignals.push(`author supplied via parameter ("${author_name}") but not present in the content`);
    }

    // Author bio: a short paragraph naming the author near the end
    let authorBioDetected = false;
    if (authorDetected) {
        const firstName = authorDetected.split(/\s+/)[0];
        const paragraphs = $("p").map((_, el) => $(el).text().trim()).get();
        const tail = paragraphs.slice(-4);
        authorBioDetected = tail.some(
            (p) =>
                p.includes(firstName) &&
                /\b(is an?|has|writes|works|specialis|specializ|years of|founder|editor|director|consultant|engineer|analyst)\b/i.test(p)
        );
    }

    // ─── 2. Freshness ─────────────────────────────────────────────────────────
    const publishedRaw =
        $('meta[property="article:published_time"]').attr("content") ||
        $("time[datetime]").first().attr("datetime") ||
        $('[itemprop="datePublished"]').attr("content") ||
        null;
    const modifiedRaw =
        $('meta[property="article:modified_time"]').attr("content") ||
        $('[itemprop="dateModified"]').attr("content") ||
        null;

    let schemaPublished = null;
    let schemaModified = null;
    $('script[type="application/ld+json"]').each((_, el) => {
        try {
            const parsed = JSON.parse(($(el).contents().text() || "").trim());
            const stack = Array.isArray(parsed) ? [...parsed] : [parsed];
            while (stack.length) {
                const node = stack.pop();
                if (!node || typeof node !== "object") continue;
                if (Array.isArray(node["@graph"])) stack.push(...node["@graph"]);
                schemaPublished = schemaPublished || node.datePublished || null;
                schemaModified = schemaModified || node.dateModified || null;
            }
        } catch (_) { /* ignore */ }
    });

    const rawPublished = publishedRaw || schemaPublished;
    const rawModified = modifiedRaw || schemaModified;
    const publishedValid = !!rawPublished && !Number.isNaN(Date.parse(rawPublished));
    const modifiedValid = !!rawModified && !Number.isNaN(Date.parse(rawModified));
    const publishedDate = publishedValid ? rawPublished : null;
    const modifiedDate = modifiedValid ? rawModified : null;
    const malformedDates = [];
    if (rawPublished && !publishedValid) malformedDates.push(`datePublished ("${rawPublished}") is not a parseable date, so Search cannot read it.`);
    if (rawModified && !modifiedValid) malformedDates.push(`dateModified ("${rawModified}") is not a parseable date, so Search cannot read it.`);
    const visibleDateMatch = plain.match(VISIBLE_DATE_RE);

    let ageMonths = null;
    if (publishedDate && !Number.isNaN(Date.parse(publishedDate))) {
        ageMonths = Math.round((now - new Date(publishedDate)) / (1000 * 60 * 60 * 24 * 30.44));
    }

    // Stale year references — "as of 2024", "2024 guide", "the latest 2023 data"
    const staleYearMentions = [];
    let m;
    while ((m = CURRENCY_PHRASE_RE.exec(plain)) !== null) {
        const year = parseInt(m[1], 10);
        if (year < currentYear) {
            staleYearMentions.push({ phrase: m[0], year, context: plain.slice(Math.max(0, m.index - 40), m.index + 60).trim() });
        }
    }
    const titleText = $("title").text() || "";
    const h1Text = $("h1").first().text() || "";
    const staleYearInTitle = [titleText, h1Text]
        .map((t) => (t.match(/\b(19|20)\d{2}\b/) || [])[0])
        .filter((y) => y && parseInt(y, 10) < currentYear);

    // ─── 3. First-hand experience ─────────────────────────────────────────────
    const experienceMatches = [];
    EXPERIENCE_PATTERNS.forEach(({ re, label, weight = 1 }) => {
        const found = plain.match(re);
        if (found) {
            experienceMatches.push({
                signal: label,
                count: found.length,
                strength: weight === 1 ? "strong" : "weak (framing only)",
                examples: [...new Set(found)].slice(0, 3),
            });
        }
    });
    // Framing phrases ("real-world", "our team") hint at experience; only
    // describing what you actually did demonstrates it. Weight accordingly.
    const experienceTotal = experienceMatches.reduce((s, x) => s + x.count, 0);
    const experienceWeighted = EXPERIENCE_PATTERNS.reduce((sum, { re, weight = 1 }) => {
        const found = plain.match(re);
        return sum + (found ? found.length * weight : 0);
    }, 0);
    const wordCount = countWords(plain);
    const experiencePer1000 = wordCount > 0 ? (experienceWeighted / wordCount) * 1000 : 0;

    // ─── 4. Citation quality ──────────────────────────────────────────────────
    const citations = [];
    $("a[href]").each((_, el) => {
        const href = $(el).attr("href") || "";
        if (classifyHref(href, siteDomain) !== "external") return;
        const host = hostnameOf(href);
        citations.push({
            domain: host,
            anchor_text: $(el).text().trim().slice(0, 80),
            authority_tier: authorityTier(host),
        });
    });

    const tier1 = citations.filter((c) => c.authority_tier === 1);
    const tier2 = citations.filter((c) => c.authority_tier === 2);
    const tier3 = citations.filter((c) => c.authority_tier === 3);

    // ─── 5. Unsupported claims ────────────────────────────────────────────────
    const unsupportedClaims = [];
    let supportedClaims = 0;

    $("p, li, blockquote").each((_, el) => {
        const $block = $(el);
        // Skip list items whose parent <li> already covers them
        if ($block.parents("p, li, blockquote").length > 0) return;
        const text = $block.text().replace(/\s+/g, " ").trim();
        if (!text) return;
        const blockHasLink = $block.find("a[href]").length > 0;

        splitSentences(text).forEach((sentence) => {
            const isStat = STAT_PATTERNS.some((re) => re.test(sentence));
            const vague = VAGUE_ATTRIBUTION.find((re) => re.test(sentence));
            if (!isStat && !vague) return;

            if (blockHasLink) {
                supportedClaims++;
                return;
            }
            unsupportedClaims.push({
                sentence: sentence.slice(0, 200),
                kind: isStat && vague ? "unsourced statistic with vague attribution" : isStat ? "unsourced statistic" : "vague attribution with no source",
                fix: vague
                    ? `"${sentence.match(vague)[0]}" names no source. Cite the specific study or organisation and link to it.`
                    : "Link this figure to its primary source in the same paragraph.",
            });
        });
    });

    const totalClaims = supportedClaims + unsupportedClaims.length;

    // ─── Scoring (out of 100) ─────────────────────────────────────────────────
    const components = [];

    let authorEarned = 0;
    if (authorDetected) authorEarned += 12;
    if (schemaPersonEntity) authorEarned += 7;
    if (authorBioDetected) authorEarned += 6;
    components.push({
        key: "authorship",
        label: authorDetected
            ? `Author identified ("${String(authorDetected).slice(0, 40)}")${schemaPersonEntity ? " + Person schema" : ""}${authorBioDetected ? " + bio" : ""}`
            : "No author identified",
        earned: authorEarned,
        max: 25,
        passed: authorEarned >= 19,
        fix:
            authorEarned >= 19
                ? null
                : !authorDetected
                    ? "Add a visible byline, and mark the author up as a Person entity with a link to a bio page."
                    : !schemaPersonEntity
                        ? "Mark the author up as a nested Person entity in JSON-LD (with url and sameAs) rather than a plain name."
                        : "Add a short author bio establishing why this person is qualified to write on this topic.",
    });

    let freshnessEarned = 0;
    if (publishedDate || visibleDateMatch) freshnessEarned += 8;
    if (modifiedDate) freshnessEarned += 6;
    if (staleYearMentions.length === 0 && staleYearInTitle.length === 0) freshnessEarned += 6;
    components.push({
        key: "freshness",
        label: `Date signals${publishedDate ? ` (published ${String(publishedDate).slice(0, 10)}${ageMonths !== null ? `, ${ageMonths} months old` : ""})` : " (no published date)"}`,
        earned: freshnessEarned,
        max: 20,
        passed: freshnessEarned >= 14,
        applicable: isHtml,
        fix:
            freshnessEarned >= 14
                ? null
                : malformedDates.length > 0
                    ? malformedDates.join(" ")
                    : !publishedDate && !visibleDateMatch
                    ? "Add a machine-readable published date (<time datetime> plus datePublished in schema)."
                    : !modifiedDate
                        ? "Add dateModified — without it, Search has no way to know the page has been maintained."
                        : `Update the stale year references (${[...staleYearInTitle, ...staleYearMentions.map((s) => s.year)].join(", ")}) — content that advertises an old year reads as abandoned.`,
    });

    let experienceEarned;
    if (experiencePer1000 >= 3) experienceEarned = 20;
    else if (experiencePer1000 >= 1.5) experienceEarned = 14;
    else if (experiencePer1000 >= 0.5) experienceEarned = 8;
    else experienceEarned = 0;
    components.push({
        key: "first_hand_experience",
        label: `First-hand experience markers (${experienceTotal} found, weighted ${experiencePer1000.toFixed(1)} per 1,000 words)`,
        earned: experienceEarned,
        max: 20,
        passed: experiencePer1000 >= 3,
        fix:
            experiencePer1000 >= 3
                ? null
                : "Add demonstrated experience — what you tested, what you measured, what happened, with original screenshots or data. This is the 'E' the helpful content system rewards and the hardest signal for competitors to copy.",
    });

    let citationEarned = 0;
    if (tier1.length >= 2) citationEarned = 20;
    else if (tier1.length === 1) citationEarned = 15;
    else if (tier2.length >= 2) citationEarned = 11;
    else if (tier2.length === 1) citationEarned = 7;
    else if (tier3.length > 0) citationEarned = 3;
    components.push({
        key: "citation_quality",
        label: `Source authority (tier 1: ${tier1.length}, tier 2: ${tier2.length}, tier 3: ${tier3.length})`,
        earned: citationEarned,
        max: 20,
        passed: tier1.length >= 2,
        fix:
            tier1.length >= 2
                ? null
                : "Cite primary sources — standards bodies, government statistics, peer-reviewed research, official documentation. Linking to other blogs covering the same topic adds no authority.",
    });

    let claimEarned;
    if (totalClaims === 0) claimEarned = 8; // nothing to support, but nothing concrete either
    else if (unsupportedClaims.length === 0) claimEarned = 15;
    else {
        const ratio = supportedClaims / totalClaims;
        claimEarned = Math.round(ratio * 15);
    }
    components.push({
        key: "claim_support",
        label:
            totalClaims === 0
                ? "No statistics or attributed claims found"
                : `Claims with a source in the same paragraph (${supportedClaims}/${totalClaims})`,
        earned: claimEarned,
        max: 15,
        passed: totalClaims > 0 && unsupportedClaims.length === 0,
        fix:
            totalClaims === 0
                ? "The content makes no verifiable claims at all. Add specific, sourced facts — they are what earns trust and citations."
                : unsupportedClaims.length === 0
                    ? null
                    : `${unsupportedClaims.length} statistic(s) or attributed claim(s) have no link to a source in the same paragraph. Cite each one.`,
    });

    const applicable = components.filter((c) => c.applicable !== false);
    const earned = applicable.reduce((s, c) => s + c.earned, 0);
    const max = applicable.reduce((s, c) => s + c.max, 0);
    const scorePercent = max > 0 ? Math.round((earned / max) * 100) : 0;

    let status;
    if (scorePercent >= 80) status = "Strong E-E-A-T signals";
    else if (scorePercent >= 60) status = "Moderate — the basics are there but experience and sourcing are thin";
    else if (scorePercent >= 40) status = "Weak — this reads as unattributed commodity content";
    else status = "Poor — no meaningful trust signals detected";

    const prioritisedFixes = components
        .filter((c) => c.applicable !== false && !c.passed && c.fix)
        .sort((a, b) => b.max - a.max)
        .map((c) => ({ priority_points: c.max, area: c.label, action: c.fix }));

    return {
        eeat_score_percent: scorePercent,
        status,
        content_type: isHtml ? "HTML" : "Markdown / Plain Text",
        authorship: {
            author_detected: authorDetected || null,
            signals_found: authorSignals.length ? authorSignals : ["None — no byline, meta author, or Person schema"],
            person_schema_entity: schemaPersonEntity,
            author_bio_detected: authorBioDetected,
        },
        freshness: {
            date_published: publishedDate || null,
            date_modified: modifiedDate || null,
            malformed_dates: malformedDates,
            visible_date_in_copy: visibleDateMatch ? visibleDateMatch[0] : null,
            age_months: ageMonths,
            stale_year_in_title_or_h1: staleYearInTitle,
            stale_year_mentions: staleYearMentions.slice(0, 10),
        },
        first_hand_experience: {
            total_markers: experienceTotal,
            weighted_markers_per_1000_words: parseFloat(experiencePer1000.toFixed(2)),
            signals: experienceMatches.length ? experienceMatches : ["None detected — the content never says what the author actually did"],
        },
        citation_quality: {
            external_citations: citations.length,
            tier_1_primary_sources: tier1.map((c) => c.domain),
            tier_2_reputable_sources: tier2.map((c) => c.domain),
            tier_3_general_sources: tier3.map((c) => c.domain),
            note: "Tier 1 = government, academic, standards bodies, peer-reviewed research. Tier 2 = major publishers and official vendor documentation. Tier 3 = everything else.",
        },
        unsupported_claims: {
            count: unsupportedClaims.length,
            supported_count: supportedClaims,
            claims: unsupportedClaims.slice(0, 15),
        },
        score_components: components,
        prioritised_fixes: prioritisedFixes.length ? prioritisedFixes : ["No E-E-A-T gaps found."],
        tips: [
            "Experience is the signal competitors cannot copy: what you tested, what you measured, what went wrong.",
            "An author needs to be a resolvable entity — byline, bio page, Person schema with sameAs links to their professional profiles.",
            "Every statistic should link to its primary source in the same paragraph. 'Studies show' with no link actively damages trust.",
            "dateModified matters more than datePublished for evergreen content — but only update it when the content genuinely changes.",
        ],
    };
}

module.exports = { schema, handler };
