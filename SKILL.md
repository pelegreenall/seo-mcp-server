---
name: SEO Content Analysis
description: Audit unpublished HTML, Markdown, or Word (.docx) content for SEO quality using the seo-content-analysis MCP tools. Use these tools before publishing to check keyword optimisation, readability, heading structure, and meta tags. Accepts raw text via the `content` parameter or a local file path via `filepath`.
---

## When to use these tools

Use these tools when the user provides **unpublished** content (a draft blog post, landing page copy, article, .docx file, etc.) and asks about SEO, rankings, readability, or content quality. These tools work on raw HTML, Markdown, or Word (.docx) files — not live URLs.

---

## Pre-flight: Ask for missing inputs before starting

When the user uploads or pastes a document that is **not HTML**, ask for any missing inputs **before running any tools**:

> "Before I run the audit, I just need a couple of things:
> 1. **Primary keyword** — what is the main keyword this piece should rank for? *(e.g. 'cohort analysis for analysts')*
> 2. **Meta title and meta description** — do you have planned versions of these? If so, share them and I'll include them in the score. If not, I'll flag them as missing and suggest options after."

Only proceed once you have their answers (or they confirm they don't have them yet). The primary keyword is needed for Keyword Optimisation points; the meta tags are needed for Technical SEO points.
*Note:* You (the AI) must automatically generate 5-10 LSI keywords (`expected_terms`) based on the primary keyword to pass to `calculate_seo_score` if the user doesn't provide them!

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

For a quick headline result, start with `calculate_seo_score`. For a deep audit, use `analyse_content` followed by the specialist tools.

> **`check_meta_tags` vs `suggest_meta_tags`:** use `check_meta_tags` when the user already has a title/meta and wants it validated. Use `suggest_meta_tags` when they need new ones written.

---

## Interpreting results

### `calculate_seo_score`
- Lead with `score` and `grade_label` (e.g. *"Your content scored 85% (128/150 raw points) — Grade B"*)
- Walk through `category_breakdown` so the user sees where points were lost
- Present `prioritised_fixes` as a numbered action list — highest-impact fixes are first
- Grade scale (based on percentage): **A (90–100%)** Excellent · **B (75–89%)** Good · **C (60–74%)** Needs improvement · **D (40–59%)** Poor · **F (<40%)** Critical
- **Remember**: The mega score evaluates up to 150 raw points, but scales down to a final percentage out of 100. You MUST generate and provide `expected_terms` (LSI keywords) to unlock the 35 points for Topical Authority!

### `analyse_content`
Focus on `audit_checklist` — each item is `true` (pass), `false` (fail), or `"N/A"`. Prioritise:
1. `single_h1` — must be exactly one H1
2. `keyword_in_h1_or_title` — critical for rankings
3. `word_count_sufficient` — 700+ words recommended
4. `heading_hierarchy_clean` — no skipped levels

### `check_meta_tags`
- Check `summary.status` first: `"Pass"`, `"Needs minor fixes"`, or `"Needs attention"`
- Present `title_tag.issues` and `meta_description.issues` as a clear action list
- If `open_graph.has_og_tags` is `false`, mention that OG tags are missing (important for social sharing)
- Key thresholds:
  - Title: **30–60 characters** — under 30 is too short, over 60 gets truncated in SERPs
  - Meta description: **120–160 characters** — under 70 is too short, over 160 gets truncated


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
- Use the first `title_suggestions` entry as the primary recommendation
- Check `within_limit` on both title (60 chars) and meta description (160 chars)
- Present the `url_slug_suggestion` alongside the meta tags

### `check_heading_structure`
- Present `heading_tree` as a visual outline to the user
- Any item in `issues` is an actionable fix — address each one

---

### `check_semantic_coverage`
- Requires `expected_terms`. If the user doesn't provide them, generate 5-10 yourself based on the topic.
- A score of ≥80% is Excellent.
- Explicitly list the missing terms so the user can weave them into the copy.

### `analyze_links`
- Ensure at least one internal and one external link exists.
- Flag any "toxic" anchor text (e.g. "click here") and suggest keyword-rich alternatives.

### `check_snippet_optimization`
- Reviews H2/H3s that contain questions.
- Google prefers the immediately following paragraph to be exactly 40-60 words long to capture Position Zero snippets.

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
9. Summarise all recommended actions using `prioritised_fixes` as the backbone

---

## Tips

- Always pass `primary_keyword` in lowercase — matching is case-insensitive but consistency helps
- All tools now accept an optional `filepath` parameter to analyze local files (`.docx`, `.html`, `.md`, `.txt`) directly.
- ⚠️ **`filepath` is for local disk paths only** (e.g. `C:\Users\peleg\Documents\post.docx`). Do NOT use `filepath` for files uploaded to the chat — these are stored at `/mnt/user-data/uploads/` and cannot be accessed by the local server.
- **For uploaded files**: extract the full text content from the file and pass it as the `content` parameter instead.
- `secondary_keywords` in `analyse_content` is optional but useful for topic-cluster content
- `check_meta_tags` only works on HTML with `<title>` / `<meta>` tags. For Markdown or `.docx` input it will return a clear error directing you to use `suggest_meta_tags` instead.
- Don't flag `N/A` values as issues — they simply mean the check doesn't apply to the content type
