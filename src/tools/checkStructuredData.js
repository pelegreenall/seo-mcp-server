const { parseContent, extractPlainText, getSections, normalise, similarity } = require("../utils/content");
const { measureTitle, measureDescription } = require("../utils/serp");
const { loadContent } = require("../utils/loader");

const schema = {
    name: "check_structured_data",
    description:
        "Parses and validates JSON-LD structured data (schema.org) in HTML content. Checks required and recommended properties per type, and — most importantly — verifies the markup matches the visible content, since a mismatch between schema and page copy is a manual-action risk rather than just a missed rich result. Also recommends the schema types the content's structure calls for, and returns a ready-to-paste JSON-LD stub when markup is missing.",
    inputSchema: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "The raw HTML content (JSON-LD only exists in HTML)",
            },
            filepath: {
                type: "string",
                description: "Absolute path to a local file (.html, .tsx, .jsx, .md, .txt)",
            },
            page_url: {
                type: "string",
                description: "Optional. The canonical URL of the page, used to fill the suggested JSON-LD stub.",
            },
            author_name: {
                type: "string",
                description: "Optional. Author name, used to fill the suggested JSON-LD stub.",
            },
            organisation_name: {
                type: "string",
                description: "Optional. Publisher / organisation name, used to fill the suggested JSON-LD stub.",
            },
        },
        required: [],
    },
};

// ─── Type rules ───────────────────────────────────────────────────────────────

const TYPE_RULES = {
    Article: {
        required: ["headline", "author", "datePublished"],
        recommended: ["image", "dateModified", "publisher", "description", "mainEntityOfPage"],
    },
    BlogPosting: {
        required: ["headline", "author", "datePublished"],
        recommended: ["image", "dateModified", "publisher", "description", "mainEntityOfPage"],
    },
    NewsArticle: {
        required: ["headline", "author", "datePublished", "publisher"],
        recommended: ["image", "dateModified", "description"],
    },
    TechArticle: {
        required: ["headline", "author", "datePublished"],
        recommended: ["image", "dateModified", "proficiencyLevel", "publisher"],
    },
    FAQPage: {
        required: ["mainEntity"],
        recommended: [],
    },
    HowTo: {
        required: ["name", "step"],
        recommended: ["image", "totalTime", "supply", "tool", "description"],
    },
    Product: {
        required: ["name", "offers"],
        recommended: ["image", "description", "brand", "sku", "aggregateRating", "review"],
    },
    Organization: {
        required: ["name"],
        recommended: ["url", "logo", "sameAs", "description"],
    },
    Person: {
        required: ["name"],
        recommended: ["url", "jobTitle", "sameAs", "image", "description"],
    },
    BreadcrumbList: {
        required: ["itemListElement"],
        recommended: [],
    },
    VideoObject: {
        required: ["name", "description", "thumbnailUrl", "uploadDate"],
        recommended: ["duration", "contentUrl", "embedUrl"],
    },
    WebPage: {
        required: ["name"],
        recommended: ["url", "description", "datePublished"],
    },
    WebSite: {
        required: ["name"],
        recommended: ["url", "potentialAction"],
    },
    Review: {
        required: ["itemReviewed", "reviewRating", "author"],
        recommended: ["datePublished", "reviewBody"],
    },
    Recipe: {
        required: ["name", "recipeIngredient", "recipeInstructions"],
        recommended: ["image", "author", "prepTime", "cookTime", "nutrition"],
    },
    SoftwareApplication: {
        required: ["name", "offers", "applicationCategory"],
        recommended: ["operatingSystem", "aggregateRating", "screenshot"],
    },
};

const HEADLINE_MAX = 110;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Collect every schema node, flattening @graph and top-level arrays. */
function collectNodes(parsed, out = []) {
    if (Array.isArray(parsed)) {
        parsed.forEach((item) => collectNodes(item, out));
        return out;
    }
    if (parsed && typeof parsed === "object") {
        if (Array.isArray(parsed["@graph"])) {
            collectNodes(parsed["@graph"], out);
        }
        if (parsed["@type"]) out.push(parsed);
    }
    return out;
}

function typesOf(node) {
    const t = node["@type"];
    if (!t) return [];
    return Array.isArray(t) ? t : [t];
}

function asText(value) {
    if (value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(asText).join(" ");
    if (typeof value === "object") {
        return asText(value.name || value.text || value["@id"] || value.url || "");
    }
    return "";
}

function isPresent(value) {
    if (value == null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value).length > 0;
    return true;
}

function isValidDate(value) {
    const text = asText(value);
    if (!text) return false;
    return !Number.isNaN(Date.parse(text));
}

function isAbsoluteUrl(value) {
    const text = asText(value);
    return /^https?:\/\//i.test(text);
}


/**
 * Schema earns visible SERP real estate, and a physically larger listing takes
 * clicks from its neighbours regardless of how good the copy is. This maps what
 * the page currently earns against what its content would support.
 */
function assessSerpFootprint($, presentTypes, nodes, titleMetrics, descMetrics) {
    const has = (t) => presentTypes.includes(t);
    const nodeOf = (t) => nodes.find((n) => [].concat(n["@type"] || []).includes(t));

    const current = [];
    const missing = [];

    function element(name, earned, requirement, impact, caveat) {
        const entry = { element: name, impact };
        if (caveat) entry.caveat = caveat;
        if (earned) current.push(entry);
        else missing.push({ ...entry, to_earn_it: requirement });
    }

    const ratingNode = nodes.find((n) => n.aggregateRating || [].concat(n["@type"] || []).includes("Review"));
    element(
        "Star rating",
        !!ratingNode,
        "Add AggregateRating or Review markup — only where genuine ratings exist and are visible on the page.",
        "High — stars are the single most visually distinctive SERP element."
    );

    const productNode = nodeOf("Product");
    element(
        "Price and availability",
        !!(productNode && productNode.offers),
        "Add Product markup with an offers block carrying price, priceCurrency and availability.",
        "High for commercial pages — price shows before the click."
    );

    element(
        "Breadcrumb trail",
        has("BreadcrumbList"),
        "Add BreadcrumbList markup matching your visible breadcrumbs.",
        "Moderate — replaces a raw URL with a readable hierarchy."
    );

    element(
        "Video thumbnail",
        has("VideoObject"),
        $("video, iframe[src*='youtube'], iframe[src*='vimeo']").length > 0
            ? "You have an embedded video — add VideoObject markup with name, description, thumbnailUrl and uploadDate."
            : "Only applicable if the page embeds video.",
        "High where video exists — a thumbnail dominates the listing."
    );

    element(
        "Expandable FAQ rows",
        has("FAQPage"),
        "Add FAQPage markup, with every question and answer visible on the page.",
        "Variable — adds vertical space when granted.",
        "Google narrowed FAQ rich results to mainly authoritative health and government sites, so a general site may get the markup indexed without the visual expansion. Verify current eligibility before counting on it — the markup still helps semantic and AI understanding either way."
    );

    element(
        "Step carousel",
        has("HowTo"),
        "Add HowTo markup if the page genuinely documents a procedure.",
        "Moderate — verify current HowTo rich-result eligibility, which Google has also changed.",
        "HowTo rich results have been restricted on some surfaces. Treat as semantic value first, visual footprint second."
    );

    const siteNode = nodeOf("WebSite");
    element(
        "Sitelinks searchbox",
        !!(siteNode && siteNode.potentialAction),
        "Add WebSite markup with a SearchAction potentialAction — site-wide, not per page.",
        "Low per page, useful for brand queries."
    );

    const articleNode = nodes.find((n) => [].concat(n["@type"] || []).some((t) => /Article|BlogPosting|NewsArticle/.test(t)));
    element(
        "Article thumbnail",
        !!(articleNode && articleNode.image),
        "Add an absolute image URL to your Article/BlogPosting markup.",
        "Moderate on mobile, where a thumbnail sits beside the listing."
    );

    element(
        "Favicon",
        $('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0,
        "Declare a favicon with <link rel=\"icon\">. It renders next to every result.",
        "Low individually, but its absence looks unfinished beside competitors."
    );

    // Footprint you get from copy length alone, not from schema.
    const widthNotes = [];
    if (titleMetrics.status === "Under-using space") {
        widthNotes.push(`The title uses only ${titleMetrics.width_used_percent}% of the available width — roughly ${Math.round(titleMetrics.pixel_limit - titleMetrics.pixel_width)}px of free space that costs nothing to fill.`);
    }
    if (descMetrics.status === "Under-using space") {
        widthNotes.push(`The meta description uses only ${descMetrics.width_used_percent}% of its width — the cheapest footprint gain available, and it needs no markup at all.`);
    }

    return {
        earned_now: current.length ? current : ["No rich-result elements currently earned."],
        available_but_missing: missing,
        unused_width: widthNotes.length ? widthNotes : ["Title and description already use their available width well."],
        note: "A bigger listing takes clicks from neighbouring results independent of copy quality. Only mark up what is genuinely on the page — fabricated ratings or hidden FAQs are a policy violation, not a shortcut.",
    };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function handler({ content, filepath, page_url, author_name, organisation_name }) {
    const rawContent = await loadContent({ content, filepath });
    const { $, isHtml } = parseContent(rawContent);
    const plainText = extractPlainText($);
    const normalisedPlain = normalise(plainText);

    const h1 = $("h1").first().text().trim() || null;
    const titleTag = $("title").text().trim() || null;
    const sections = getSections($);

    // ─── Parse every JSON-LD block ────────────────────────────────────────────
    const parseErrors = [];
    const nodes = [];

    $('script[type="application/ld+json"]').each((i, el) => {
        const raw = $(el).contents().text() || $(el).text();
        if (!raw || !raw.trim()) {
            parseErrors.push({ block: i + 1, error: "Empty <script type=\"application/ld+json\"> block." });
            return;
        }
        try {
            const parsed = JSON.parse(raw.trim());
            const found = collectNodes(parsed);
            if (found.length === 0) {
                parseErrors.push({
                    block: i + 1,
                    error: "Valid JSON but no node carries an @type — this markup will be ignored.",
                });
            }
            nodes.push(...found);
        } catch (err) {
            parseErrors.push({
                block: i + 1,
                error: `Invalid JSON — ${err.message}. Google discards the entire block when parsing fails.`,
                preview: raw.trim().slice(0, 160),
            });
        }
    });

    const microdataCount = $("[itemscope]").length;
    const presentTypes = [...new Set(nodes.flatMap(typesOf))];

    // ─── Validate each node ───────────────────────────────────────────────────
    const nodeReports = nodes.map((node) => {
        const types = typesOf(node);
        const knownType = types.find((t) => TYPE_RULES[t]);
        const rules = knownType ? TYPE_RULES[knownType] : null;

        const missingRequired = [];
        const missingRecommended = [];
        const errors = [];
        const warnings = [];

        if (!node["@context"] && !node["@id"]) {
            warnings.push("No @context on this node — make sure the enclosing block declares \"@context\": \"https://schema.org\".");
        }

        if (!rules) {
            warnings.push(`Type "${types.join(", ")}" has no validation rules here — checked for structure only.`);
        } else {
            rules.required.forEach((prop) => {
                if (!isPresent(node[prop])) missingRequired.push(prop);
            });
            rules.recommended.forEach((prop) => {
                if (!isPresent(node[prop])) missingRecommended.push(prop);
            });
        }

        // Per-type deep checks
        if (knownType && /Article|BlogPosting|NewsArticle|TechArticle/.test(knownType)) {
            const headline = asText(node.headline);
            if (headline && headline.length > HEADLINE_MAX) {
                errors.push(`headline is ${headline.length} characters — Google truncates/ignores headlines over ${HEADLINE_MAX}. Shorten it.`);
            }
            if (isPresent(node.datePublished) && !isValidDate(node.datePublished)) {
                errors.push(`datePublished ("${asText(node.datePublished)}") is not a parseable ISO 8601 date.`);
            }
            if (isPresent(node.dateModified) && !isValidDate(node.dateModified)) {
                errors.push(`dateModified ("${asText(node.dateModified)}") is not a parseable ISO 8601 date.`);
            }
            if (isValidDate(node.datePublished) && isValidDate(node.dateModified)) {
                if (Date.parse(asText(node.dateModified)) < Date.parse(asText(node.datePublished))) {
                    errors.push("dateModified is earlier than datePublished.");
                }
            }
            if (isValidDate(node.datePublished) && Date.parse(asText(node.datePublished)) > Date.now()) {
                warnings.push("datePublished is in the future.");
            }
            if (isPresent(node.image) && !isAbsoluteUrl(node.image)) {
                errors.push("image must be an absolute URL (https://…), not a relative path.");
            }
            if (isPresent(node.author) && typeof node.author === "string") {
                warnings.push("author is a plain string — use a nested { \"@type\": \"Person\", \"name\": …, \"url\": … } object so the author becomes a recognisable entity.");
            }
        }

        if (knownType === "FAQPage") {
            const entities = Array.isArray(node.mainEntity) ? node.mainEntity : node.mainEntity ? [node.mainEntity] : [];
            if (entities.length === 0) {
                errors.push("mainEntity is empty — FAQPage needs at least one Question.");
            }
            entities.forEach((q, i) => {
                if (!isPresent(q.name)) errors.push(`Question ${i + 1} is missing "name" (the question text).`);
                const answer = q.acceptedAnswer;
                if (!isPresent(answer) || !isPresent(answer && answer.text)) {
                    errors.push(`Question ${i + 1} ("${asText(q.name).slice(0, 50)}") is missing acceptedAnswer.text.`);
                }
            });
        }

        if (knownType === "HowTo") {
            const steps = Array.isArray(node.step) ? node.step : node.step ? [node.step] : [];
            if (steps.length < 2) {
                warnings.push(`Only ${steps.length} step(s) defined — HowTo rich results generally need at least 2.`);
            }
            steps.forEach((s, i) => {
                if (!isPresent(s.text) && !isPresent(s.itemListElement)) {
                    errors.push(`Step ${i + 1} has no "text" — each HowToStep needs its instruction text.`);
                }
            });
        }

        if (knownType === "Product") {
            const offers = node.offers;
            const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];
            if (offerList.length === 0) {
                errors.push("offers is missing — Product rich results require price information.");
            }
            offerList.forEach((o, i) => {
                if (!isPresent(o.price) && !isPresent(o.lowPrice)) errors.push(`Offer ${i + 1} is missing "price".`);
                if (!isPresent(o.priceCurrency)) errors.push(`Offer ${i + 1} is missing "priceCurrency".`);
                if (!isPresent(o.availability)) warnings.push(`Offer ${i + 1} is missing "availability".`);
            });
        }

        if (knownType === "BreadcrumbList") {
            const items = Array.isArray(node.itemListElement) ? node.itemListElement : [];
            items.forEach((item, i) => {
                if (!isPresent(item.position)) errors.push(`Breadcrumb ${i + 1} is missing "position".`);
                if (!isPresent(item.name) && !isPresent(item.item && item.item.name)) {
                    errors.push(`Breadcrumb ${i + 1} is missing "name".`);
                }
            });
        }

        return {
            type: types.join(", "),
            validated_as: knownType || "unknown",
            missing_required: missingRequired,
            missing_recommended: missingRecommended,
            errors,
            warnings,
            valid: missingRequired.length === 0 && errors.length === 0,
        };
    });

    // ─── Consistency with visible content ─────────────────────────────────────
    const consistencyChecks = [];

    const articleNode = nodes.find((n) => typesOf(n).some((t) => /Article|BlogPosting|NewsArticle|TechArticle/.test(t)));
    if (articleNode && isPresent(articleNode.headline)) {
        const headline = asText(articleNode.headline);
        if (h1) {
            const sim = similarity(headline, h1);
            consistencyChecks.push({
                check: "headline matches visible H1",
                passed: sim >= 0.6,
                detail:
                    sim >= 0.6
                        ? `schema headline and H1 align (${Math.round(sim * 100)}% overlap).`
                        : `schema headline "${headline}" does not match the visible H1 "${h1}" (${Math.round(sim * 100)}% overlap). Google treats schema that contradicts visible content as misleading markup.`,
            });
        } else {
            consistencyChecks.push({
                check: "headline matches visible H1",
                passed: false,
                detail: "Article schema declares a headline but the page has no H1 to match it against.",
            });
        }
    }

    const faqNode = nodes.find((n) => typesOf(n).includes("FAQPage"));
    if (faqNode) {
        const entities = Array.isArray(faqNode.mainEntity) ? faqNode.mainEntity : faqNode.mainEntity ? [faqNode.mainEntity] : [];
        const invisible = [];
        entities.forEach((q) => {
            const questionText = asText(q.name);
            const answerText = asText(q.acceptedAnswer && q.acceptedAnswer.text)
                .replace(/<[^>]+>/g, " ");
            const questionVisible = questionText && normalisedPlain.includes(normalise(questionText).slice(0, 40));
            const answerProbe = normalise(answerText).split(" ").slice(0, 8).join(" ");
            const answerVisible = answerProbe.length > 0 && normalisedPlain.includes(answerProbe);
            if (!questionVisible || !answerVisible) {
                invisible.push({
                    question: questionText.slice(0, 80),
                    question_visible: !!questionVisible,
                    answer_visible: !!answerVisible,
                });
            }
        });
        consistencyChecks.push({
            check: "FAQ content is visible on the page",
            passed: invisible.length === 0,
            detail:
                invisible.length === 0
                    ? `All ${entities.length} FAQ entries also appear in the visible copy.`
                    : `${invisible.length} of ${entities.length} FAQ entries are not visible in the page copy. Google requires FAQPage content to be visible to users — hidden FAQ markup is a manual-action risk.`,
            offending_entries: invisible.length ? invisible : undefined,
        });
    }

    const howToNode = nodes.find((n) => typesOf(n).includes("HowTo"));
    if (howToNode) {
        const steps = Array.isArray(howToNode.step) ? howToNode.step : howToNode.step ? [howToNode.step] : [];
        const hidden = steps.filter((s) => {
            const probe = normalise(asText(s.text)).split(" ").slice(0, 8).join(" ");
            return probe.length > 0 && !normalisedPlain.includes(probe);
        });
        consistencyChecks.push({
            check: "HowTo steps are visible on the page",
            passed: hidden.length === 0,
            detail:
                hidden.length === 0
                    ? `All ${steps.length} steps appear in the visible copy.`
                    : `${hidden.length} of ${steps.length} HowTo steps do not appear in the visible copy.`,
        });
    }

    const productNode = nodes.find((n) => typesOf(n).includes("Product"));
    if (productNode && isPresent(productNode.name)) {
        const name = asText(productNode.name);
        const visible = normalisedPlain.includes(normalise(name));
        consistencyChecks.push({
            check: "Product name appears in visible content",
            passed: visible,
            detail: visible
                ? `"${name}" appears in the page copy.`
                : `Product name "${name}" does not appear anywhere in the visible copy.`,
        });
    }

    // ─── Recommend types from content structure ───────────────────────────────
    const QUESTION_RE = /^(who|what|where|when|why|how|is|are|can|do|does|should|will|which)\b|\?$/i;
    const questionHeadings = sections.filter((s) => !s.is_intro && QUESTION_RE.test(s.heading.trim()));
    const orderedListCount = $("ol").length;
    const stepHeadings = sections.filter((s) => /^(step\s*\d|\d+[.)]\s)/i.test(s.heading.trim()));
    const hasBreadcrumbMarkup = $("nav[aria-label*='readcrumb'], .breadcrumb, .breadcrumbs, [class*='breadcrumb']").length > 0;

    const recommendations = [];

    if (!presentTypes.some((t) => /Article|BlogPosting|NewsArticle|TechArticle/.test(t))) {
        recommendations.push({
            type: "Article / BlogPosting",
            reason: "No article-level schema found. This is the baseline markup for any editorial page — it carries author, dates and publisher into Search.",
            priority: "High",
        });
    }
    if (questionHeadings.length >= 3 && !presentTypes.includes("FAQPage")) {
        recommendations.push({
            type: "FAQPage",
            reason: `${questionHeadings.length} question-phrased headings found (e.g. "${questionHeadings[0].heading}") but no FAQPage markup. Add it — but only if every Q&A stays visible on the page.`,
            priority: "High",
        });
    }
    if ((stepHeadings.length >= 2 || orderedListCount > 0) && !presentTypes.includes("HowTo")) {
        recommendations.push({
            type: "HowTo",
            reason:
                stepHeadings.length >= 2
                    ? `${stepHeadings.length} step-style headings found but no HowTo markup.`
                    : "An ordered list of instructions was found but no HowTo markup.",
            priority: "Medium",
        });
    }
    if (hasBreadcrumbMarkup && !presentTypes.includes("BreadcrumbList")) {
        recommendations.push({
            type: "BreadcrumbList",
            reason: "Breadcrumb navigation exists in the HTML but is not marked up. BreadcrumbList replaces the raw URL in the SERP.",
            priority: "Medium",
        });
    }
    if (!presentTypes.includes("Organization") && !presentTypes.includes("Person")) {
        recommendations.push({
            type: "Organization or Person",
            reason: "No publisher entity declared. Organization/Person markup with sameAs links is how Search resolves who is behind the content — a direct E-E-A-T signal.",
            priority: "Medium",
        });
    }
    if ($("video, iframe[src*='youtube'], iframe[src*='vimeo']").length > 0 && !presentTypes.includes("VideoObject")) {
        recommendations.push({
            type: "VideoObject",
            reason: "Embedded video found with no VideoObject markup — video rich results and key-moment links are unavailable without it.",
            priority: "Medium",
        });
    }

    // ─── Suggested stub ───────────────────────────────────────────────────────
    const today = new Date().toISOString().slice(0, 10);
    const suggestedStub = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: (h1 || titleTag || "REPLACE — your headline, max 110 characters").slice(0, HEADLINE_MAX),
        description: $('meta[name="description"]').attr("content") || "REPLACE — one-sentence summary",
        image: "https://REPLACE.example.com/path/to/hero-image.jpg",
        author: {
            "@type": "Person",
            name: author_name || "REPLACE — author name",
            url: "https://REPLACE.example.com/about/author",
        },
        publisher: {
            "@type": "Organization",
            name: organisation_name || "REPLACE — organisation name",
            logo: { "@type": "ImageObject", url: "https://REPLACE.example.com/logo.png" },
        },
        datePublished: today,
        dateModified: today,
        mainEntityOfPage: { "@type": "WebPage", "@id": page_url || "https://REPLACE.example.com/this-page" },
    };

    // ─── SERP footprint ───────────────────────────────────────────────────────
    const titleMetrics = measureTitle(titleTag);
    const descMetrics = measureDescription($('meta[name="description"]').attr("content") || null);
    const serpFootprint = assessSerpFootprint($, presentTypes, nodes, titleMetrics, descMetrics);

    // ─── Score components (out of 100) ────────────────────────────────────────
    const hasAnySchema = nodes.length > 0;
    const allNodesValid = nodeReports.length > 0 && nodeReports.every((n) => n.valid);
    const consistencyPassed = consistencyChecks.length === 0 || consistencyChecks.every((c) => c.passed);
    const noParseErrors = parseErrors.length === 0;

    const components = [
        {
            key: "schema_present",
            label: "JSON-LD structured data present",
            earned: hasAnySchema ? 30 : 0,
            max: 30,
            passed: hasAnySchema,
            fix: hasAnySchema ? null : "Add JSON-LD structured data — start from the suggested_jsonld stub in this result.",
        },
        {
            key: "schema_parses",
            label: "All JSON-LD blocks parse cleanly",
            earned: hasAnySchema && noParseErrors ? 15 : 0,
            max: 15,
            passed: hasAnySchema && noParseErrors,
            fix: noParseErrors ? null : "Fix the JSON syntax errors — Google discards an entire block when it fails to parse.",
        },
        {
            key: "required_properties",
            label: "Required properties present on every node",
            earned: allNodesValid ? 25 : hasAnySchema ? Math.round((nodeReports.filter((n) => n.valid).length / nodeReports.length) * 25) : 0,
            max: 25,
            passed: allNodesValid,
            fix: allNodesValid ? null : "Add the missing required properties listed under node_validation.",
        },
        {
            key: "schema_matches_content",
            label: "Markup matches the visible content",
            earned: hasAnySchema && consistencyPassed ? 30 : 0,
            max: 30,
            passed: hasAnySchema && consistencyPassed,
            fix: consistencyPassed
                ? null
                : "Reconcile the schema with the visible page copy — mismatched or hidden markup risks a manual action, not just a lost rich result.",
        },
    ];

    const earned = components.reduce((s, c) => s + c.earned, 0);
    const max = components.reduce((s, c) => s + c.max, 0);
    const scorePercent = Math.round((earned / max) * 100);

    let status;
    if (!isHtml && nodes.length === 0) {
        status = "N/A — structured data only exists in HTML. Add JSON-LD when this draft is published.";
    } else if (!hasAnySchema && parseErrors.length > 0) {
        status = `${parseErrors.length} JSON-LD block(s) found but none parsed — Google discards a block entirely when its JSON is invalid`;
    } else if (!hasAnySchema) {
        status = "No structured data found — the page is invisible to rich results";
    } else if (scorePercent >= 90) {
        status = "Valid and consistent with the visible content";
    } else if (scorePercent >= 60) {
        status = "Present but incomplete — fix the listed properties";
    } else {
        status = "Broken or misleading markup — needs attention before publishing";
    }

    return {
        structured_data_score_percent: scorePercent,
        status,
        content_type: isHtml ? "HTML" : "Markdown / Plain Text (no JSON-LD possible)",
        summary: {
            jsonld_blocks_found: $('script[type="application/ld+json"]').length,
            schema_nodes_found: nodes.length,
            types_present: presentTypes,
            parse_errors: parseErrors.length,
            microdata_elements_found: microdataCount,
        },
        parse_errors: parseErrors,
        node_validation: nodeReports,
        consistency_with_visible_content: consistencyChecks.length
            ? consistencyChecks
            : ["No cross-checkable schema types found (Article, FAQPage, HowTo or Product)."],
        recommended_types: recommendations.length ? recommendations : ["Schema coverage looks appropriate for this content."],
        serp_footprint: serpFootprint,
        score_components: components,
        suggested_jsonld: hasAnySchema && allNodesValid ? undefined : suggestedStub,
        tips: [
            "Schema must describe what the user actually sees. Hidden FAQ or HowTo content is an explicit Google policy violation.",
            "headline must be 110 characters or fewer, and should match your H1.",
            "Nest author as a Person object with a url — a plain string cannot be resolved to an entity.",
            "image, logo and @id values must be absolute URLs.",
            "Validate the final markup in Google's Rich Results Test before publishing.",
        ],
    };
}

module.exports = { schema, handler };
