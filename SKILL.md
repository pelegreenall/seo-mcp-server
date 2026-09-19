---
name: SEO Content Analysis
description: Audit unpublished HTML, Markdown, TSX, or Word (.docx) content for SEO quality using the seo-content-analysis MCP tools. Use these tools before publishing to check keyword optimisation, readability, heading structure, meta tags, search intent, schema/JSON-LD markup, E-E-A-T trust signals, and readiness to be cited by AI answer engines (AI Overviews, ChatGPT, Perplexity). Accepts raw text via the `content` parameter or a local file path via `filepath`.
---

## When to use these tools

Use these tools when the user provides **unpublished** content (a draft blog post, landing page copy, article, .docx file, etc.) and asks about SEO, rankings, readability, or content quality. They work on raw HTML, Markdown, TSX/JSX, or Word (.docx) files — **not live URLs**.

They also cover the questions classic SEO checks miss:

- *"Will AI Overviews / ChatGPT cite this?"* → `check_ai_retrievability`
- *"Is my schema markup right?"* → `check_structured_data`
- *"Does this have enough E-E-A-T?"* → `check_eeat_signals`

For anything about a **live, published URL** — impressions, clicks, rankings, indexing — these tools are the wrong ones; use Google Search Console instead.

---

## Pre-flight: Ask for missing inputs before starting

When the user uploads or pastes a document that is **not HTML**, ask for any missing inputs **before running any tools**:

> "Before I run the audit, I just need a couple of things:
> 1. **Primary keyword** — what is the main keyword this piece should rank for? *(e.g. 'cohort analysis for analysts')*
> 2. **Meta title and meta description** — do you have planned versions of these? If so, share them and I'll include them in the score. If not, I'll flag them as missing and suggest options after."

If the content contains links and you don't know which site it's for, also ask for the **domain** — without it, links to the user's own site are counted as external and both the Link Profile and E-E-A-T citation scores will be wrong.

*Note:* The `expected_terms` parameter is optional. Do not dynamically generate LSI keywords for `calculate_seo_score` unless specifically requested by the user, as this can lead to inconsistent scoring results between runs.

---

## Tool decision guide

| User asks about… | Tool to use |
|---|---|
| Overall SEO score / mega score | `calculate_seo_score` |
| General SEO / "audit this content" | `analyse_content` |
| Validate existing title/meta description | `check_meta_tags` |
| Generate new title/meta/slug suggestions | `suggest_meta_tags` |
| How often a keyword appears | `check_keyword_density` |
| Readability / sentence length / Flesch score | `check_readability` |
| Heading structure / H1 / H2 levels | `check_heading_structure` |
| Internal/External link profile & anchor text | `analyze_links` |
| Topical authority / LSI keyword coverage | `check_semantic_coverage` |
| Featured Snippet opportunities (Position Zero) | `check_snippet_optimization` |
| AI Overviews / ChatGPT / Perplexity citation readiness | `check_ai_retrievability` |
| Schema.org / JSON-LD / rich results | `check_structured_data` |
| Author, dates, experience, source quality (E-E-A-T) | `check_eeat_signals` |
| Search intent match (informational vs commercial etc.) | `check_meta_tags` (validate) or `suggest_meta_tags` (rewrite) |
| How the SERP listing will look | `check_seo_preview` |
| Low CTR / impressions but no clicks | `check_meta_tags` (rewrite risk + width), then `suggest_meta_tags` (assets + scoring) |
| Will Google rewrite my title? | `check_meta_tags` → `title_rewrite_risk` |
| Score a title I wrote | `suggest_meta_tags` with `candidate_titles` |
| Auditing a React component file | `convert_tsx_to_html`, then the usual tools |

For a quick headline result, start with `calculate_seo_score`. For a deep audit, use `analyse_content` followed by the specialist tools.

> **`check_meta_tags` vs `suggest_meta_tags`:** use `check_meta_tags` when the user already has a title/meta and wants it validated. Use `suggest_meta_tags` when they need new ones written.

---

## Interpreting results

### `calculate_seo_score`
- Lead with `score` and `grade_label` (e.g. *"Your content scored 85% (183/215 raw points) — Grade B"*)
- Walk through `category_breakdown` so the user sees where points were lost
- Present `prioritised_fixes` as a numbered action list — highest-impact fixes are first
- Grade scale (based on percentage): **A (90–100%)** Excellent · **B (75–89%)** Good · **C (60–74%)** Needs improvement · **D (40–59%)** Poor · **F (<40%)** Critical
- **Remember**: The mega score scales automatically. Topical Authority (35 pts) is excluded when `expected_terms` is not provided, Keyword Optimisation (25 pts) when `primary_keyword` is not provided, and Structured Data (15 pts) for non-HTML input. The percentage is adjusted so grades stay consistent.
- The score covers **10 categories** out of a 215-point maximum (200 for non-HTML): Technical SEO (20), Keyword Optimisation (25), Content Structure (25), Readability (15), Link Profile (20), Snippet Readiness (10), Topical Authority (35), AI Retrievability (25), E-E-A-T Signals (25), Structured Data (15).
- `scoring_version` identifies the rubric that produced the score. Version 2 measures title and meta width in pixels rather than characters, so a score is only comparable with another of the same version
- `sub_scores` gives the standalone percentage for AI Retrievability, E-E-A-T and Structured Data — quote these when the user asks specifically about AI visibility or trust signals.
- Pass `site_domain` whenever the content is for a site other than veritly.co, or internal links will be counted as external and Link Profile + E-E-A-T citation scores will both be wrong.

### `analyse_content`
Focus on `audit_checklist` — each item is `true` (pass), `false` (fail), or `"N/A"`. Prioritise:
1. `single_h1` — must be exactly one H1
2. `keyword_in_h1_or_title` — critical for rankings
3. `word_count_sufficient` — 700+ words recommended
4. `heading_hierarchy_clean` — no skipped levels
5. `keyword_intent_aligned` — the title and meta match the keyword's search intent (see [Search intent](#search-intent) below)

`keyword_analysis.detected_intent` tells you which intent the keyword implies. Mention it when it explains a finding — e.g. a "best X" keyword is Commercial, so the piece should compare options rather than only explain the concept.

### `check_meta_tags`
- Check `summary.status` first: `"Pass"`, `"Needs minor fixes"`, or `"Needs attention"`
- Present `title_tag.issues` and `meta_description.issues` as a clear action list
- If `open_graph.has_og_tags` is `false`, mention that OG tags are missing (important for social sharing)
- **Judge length by `pixel_width`, not `char_count`.** Google truncates on rendered width, so character counts are unreliable — two 60-character titles can differ threefold on screen. The tools now measure both; quote pixels.
  - Title: **~600px** limit. Under ~60% used is wasted space, over 95% is borderline
  - Meta description: **~920px** limit
  - `renders_as` shows the listing as Google will display it, and `lost_to_truncation` names the words that never appear — lead with those
- `title_rewrite_risk` predicts whether Google replaces your title with something else (often the H1). Any `High` or `Very high` is worth fixing before publishing, since a rewritten title means the copy never reaches the SERP. Each entry in `triggers` is a documented Google reason: over-width, repeated keywords, separator stuffing, title diverging from the H1, ALL CAPS, or a generic placeholder
- `detected_intent` plus `title_tag.intent_aligned` / `meta_description.intent_aligned` flag a mismatch between the keyword's intent and the copy — a Commercial keyword ("best CRM") with a purely explanatory title will be flagged here, with suggested intent words in the issue text


### `check_keyword_density`
- **0%** — keyword is missing entirely, add it
- **0.5%–2.0%** — ideal range, no action needed
- **2.0%–3.0%** — borderline, review `occurrences` and thin out where it feels forced
- **>3%** — over-optimised, trim occurrences or use synonyms

### `check_readability`
- **Flesch ≥ 70** — easy, good for general audiences
- **Flesch 60–70** — standard, fine for B2B/professional
- **Flesch < 60** — difficult; suggest breaking up long sentences and paragraphs
- Always flag `long_sentences` (>25 words) directly to the user with suggested splits

### `suggest_meta_tags`
**This tool no longer emits formula titles, and there is no `title_suggestions` field.** It supplies raw material and grades drafts; you write the copy.

The loop is:
1. Read `distinguishing_assets` — quantified facts pulled from the draft (figures, sample sizes, dates). These are what competitors cannot copy.
2. **Write two or three titles yourself**, built around those facts rather than around the keyword alone.
3. Call the tool again with `candidate_titles` to score them — and `competitor_titles` if the user can supply what currently ranks, which enables the differentiation check.

- `title_scores` ranks every candidate by `click_appeal_score` (0–100) with per-signal `findings`. Present the negative findings as the rewrite brief.
- Scoring bands: **≥75** strong · **55–74** workable · **35–54** weak · **<35** actively costs the click
- Penalised: truncation, template phrasing ("a complete guide", "everything you need to know"), no numeral, buried keyword, phrasing shared with competitor titles, clickbait
- If `distinguishing_assets` comes back empty, say so plainly — a draft with no concrete facts is a content problem before it is a title problem, and no title can be more specific than the page behind it
- `meta_description_source` is drawn from the draft's own copy where possible. Treat it as a starting sentence to edit, not a finished description
- Still shaped by search intent; pass `target_intent` to override a wrong inference

### `check_heading_structure`
- Present `heading_tree` as a visual outline to the user
- Any item in `issues` is an actionable fix — address each one

### `check_semantic_coverage`
- Requires `expected_terms`. If the user has not provided LSI keywords, ask them first or generate them only when explicitly requested.
- A score of ≥80% is Excellent.
- Explicitly list the missing terms so the user can weave them into the copy.

### `check_seo_preview`
- `serp_render_preview` shows how the listing is expected to render — show it to the user, it communicates better than any metric
- Pixel widths are estimates derived from Arial metrics. Treat anything within ~5% of a limit as borderline rather than a hard pass or fail, and say so
- An `Under-using space` status is a real finding, not a pass — unused width is free SERP real estate

### `check_ai_retrievability`
This is the tool for "will AI Overviews / ChatGPT cite this?" It analyses content **chunk by chunk** (one chunk per H2), because answer engines retrieve a single section, not the page.

- Lead with `retrievability_score_percent` and `status`
- Walk `section_analysis` — each entry is one retrievable chunk. The `issues` array is the rewrite brief for that section
- Key failures, in priority order:
  1. `self_contained: false` — the chunk opens with a pronoun ("It also…"), a vague back-reference ("This approach…") or a backward connective ("However…"). Retrieved alone, it reads as being about nothing. **This is the highest-value fix.**
  2. `answer_first: false` — the paragraph under a question heading opens with a preamble instead of the answer
  3. Low `quantified_claim_count` — AI answers quote specific figures, dates and named sources; generic prose gets paraphrased without attribution
  4. `chunk_size` other than "Ideal" — aim for 150–400 words per H2 (an intro just needs 40+)
- Scoring bands: **≥80%** strong · **60–79%** moderate · **40–59%** weak · **<40%** poor
- When rewriting for this tool, the fix is almost always: restate the subject by name at the start of each section, and add a concrete figure with a source

### `check_structured_data`
- HTML only — on Markdown/.docx it returns an N/A status, which is not a failure
- Check `parse_errors` first: a JSON syntax error means Google discards that entire block
- `node_validation` lists `missing_required`, `missing_recommended` and hard `errors` per schema node
- **`consistency_with_visible_content` is the most important section.** A schema `headline` that contradicts the H1, or FAQ/HowTo content that isn't visible on the page, is a Google policy violation and a manual-action risk — not merely a lost rich result. Flag any failure here as urgent
- `recommended_types` suggests schema the content's structure calls for (3+ question headings → FAQPage, step headings → HowTo)
- `serp_footprint` reframes schema as visible SERP real estate — star ratings, price, breadcrumbs, video thumbnails. A physically bigger listing takes clicks from neighbours regardless of copy quality. `earned_now` is what the page already gets, `available_but_missing` is what its content would support, and `unused_width` flags a title or description leaving free space on the table
- Respect the `caveat` fields: Google has narrowed FAQ and HowTo rich results, so those may be indexed without granting the visual expansion. Recommend them for semantic value and tell the user to verify current eligibility rather than promising a rich result
- When markup is missing or invalid, the result includes `suggested_jsonld` — a ready-to-paste stub. Offer it to the user, and tell them to replace every `REPLACE —` placeholder
- Always finish by recommending they validate in Google's Rich Results Test

### `check_eeat_signals`
Detects the Experience, Expertise, Authoritativeness and Trust signals Google's helpful content system rewards.

- Lead with `eeat_score_percent` and `status`
- `unsupported_claims` is the fastest win — every entry is a statistic or an "experts say" claim with no source link in the same paragraph. Present these verbatim as a fix list
- `citation_quality` tiers external links: **tier 1** = government, academic, standards bodies, peer-reviewed research · **tier 2** = major publishers, official vendor docs · **tier 3** = everything else. Zero tier-1 sources is a real weakness even when the external link *count* looks healthy
- `first_hand_experience` counts markers like "we tested", "in our audit of", "I ran". Framing phrases ("real-world", "our team") are weighted lower than described work. Low scores here mean the content never demonstrates the author did anything — the hardest gap to fake and the most valuable to fix
- `freshness` flags a missing `dateModified`, malformed dates, and stale year references (a "2023" in the title when it's 2026)
- `authorship` checks byline, Person schema and author bio. A plain-string author in JSON-LD scores lower than a nested Person entity with a `url`

### `analyze_links`
- Pass `site_domain` for any site other than veritly.co — otherwise every absolute link to the user's own site is miscounted as external
- Ensure at least one internal and one external link exists.
- Flag any "toxic" anchor text (e.g. "click here") and suggest keyword-rich alternatives.

### `check_snippet_optimization`
- Reviews H2/H3s that contain questions.
- Google prefers the immediately following paragraph to be exactly 40-60 words long to capture Position Zero snippets.
- A `"Buried Answer"` status means the paragraph opens with a preamble ("In this article we'll explore…"). Google lifts the *opening sentence*, so a correctly-sized paragraph still loses the snippet if it starts with throat-clearing. Report `total_buried_answers` alongside `total_optimized_snippets`.
- This pairs with `check_ai_retrievability` — the snippet tool judges the paragraph (40–60 words), the retrievability tool judges the whole section (150–400 words). A strong section is a 40–60 word direct answer **followed by** further paragraphs.

---

## Search intent

Several tools classify the primary keyword into one of four intents and check the copy matches it. Intent is inferred from keyword modifiers:

| Intent | Triggered by | The content should |
|---|---|---|
| **Informational** | how, why, what, guide, tutorial, tips | Explain and teach |
| **Commercial** | best, top, review, vs, compare, alternative | Compare and rank options |
| **Transactional** | buy, order, price, deal, download, subscribe, trial | Drive the action, show pricing |
| **Navigational** | brand/product names | Get the user to the right page fast |

- `analyse_content` and `check_meta_tags` report `detected_intent` and flag misalignment
- `suggest_meta_tags` tailors its title formulas to the intent, and accepts `target_intent` to override
- A mismatch is a real finding: a Commercial keyword served by a purely explanatory page loses to competitors who ranked a comparison
- The inference is keyword-modifier based, so sanity-check it. If it looks wrong, say so and pass `target_intent` explicitly

---

## Workflow for a full SEO review

1. **Pre-flight**: If the content is uploaded as a document (not HTML), ask for meta title + description before proceeding (see above)
2. Run `calculate_seo_score` — pass `primary_keyword` and any meta tags the user provided.
3. Share the score, grade, and category breakdown
4. Run `check_meta_tags` if the content is HTML with existing tags, otherwise skip and move to step 5
   - If tags are **missing and user declined to provide them** → offer to generate them via `suggest_meta_tags`
5. For deeper analysis, run `analyse_content` and summarise the `audit_checklist`
6. If keyword density issues exist → run `check_keyword_density` for detail
7. If readability issues exist → run `check_readability` for detail
8. If heading issues exist → run `check_heading_structure` for the visual tree
9. Run `check_ai_retrievability` — present `section_analysis` as a per-section rewrite brief
10. For HTML, run `check_structured_data` — treat any `consistency_with_visible_content` failure as urgent
11. Run `check_eeat_signals` — lead with `unsupported_claims` and citation tiers
12. Summarise all recommended actions using `prioritised_fixes` as the backbone

---

## Tips

- Always pass `primary_keyword` in lowercase — matching is case-insensitive but consistency helps
- All tools now accept an optional `filepath` parameter to analyze local files (`.docx`, `.html`, `.md`, `.txt`, `.tsx`, `.jsx`) directly.
- ⚠️ **`filepath` is for local disk paths only** (e.g. `C:\Users\peleg\Documents\post.docx`). Do NOT use `filepath` for files uploaded to the chat — these are stored at `/mnt/user-data/uploads/` and cannot be accessed by the local server.
- **For uploaded files**: extract the full text content from the file and pass it as the `content` parameter instead.
- `secondary_keywords` in `analyse_content` is optional but useful for topic-cluster content
- `check_meta_tags` only works on HTML with `<title>` / `<meta>` tags. For Markdown or `.docx` input it will return a clear error directing you to use `suggest_meta_tags` instead.
- Don't flag `N/A` values as issues — they simply mean the check doesn't apply to the content type
- **Pass `site_domain` on `calculate_seo_score`, `analyze_links` and `check_eeat_signals`** whenever the content isn't for veritly.co. The default exists for convenience, not correctness
- `check_structured_data` and the Structured Data category need HTML. For a Markdown or .docx draft, run it after the content is converted, or use the `suggested_jsonld` stub as a publishing to-do
- **Never quote character counts as a limit.** Google truncates on pixel width; `char_count` is reported for reference only
- For a low-CTR complaint, check `title_rewrite_risk` first — if Google is replacing the title, rewriting it differently changes nothing until the triggers are fixed
- When a user asks about "AI search", "ChatGPT visibility", "AI Overviews" or "getting cited by AI", `check_ai_retrievability` is the tool — not `check_semantic_coverage`
