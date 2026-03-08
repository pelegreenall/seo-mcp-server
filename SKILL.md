---
name: SEO Content Analysis
description: Audit unpublished HTML or Markdown content for SEO quality using the seo-content-analysis MCP tools. Use these tools before publishing to check keyword optimisation, readability, heading structure, and meta tags.
---

## When to use these tools

Use these tools when the user provides **unpublished** content (a draft blog post, landing page copy, article, etc.) and asks about SEO, rankings, readability, or content quality. These tools work on raw HTML or Markdown — not live URLs.

---

## Tool decision guide

| User asks about… | Tool to use |
|---|---|
| Overall SEO score / quick rating | `calculate_seo_score` |
| General SEO / "audit this content" | `analyse_content` |
| Validate existing title/meta description | `check_meta_tags` |
| Generate new title/meta description suggestions | `suggest_meta_tags` |
| How often a keyword appears | `check_keyword_density` |
| Readability / sentence length / Flesch score | `check_readability` |
| Heading structure / H1 / H2 levels | `check_heading_structure` |

For a quick headline result, start with `calculate_seo_score`. For a deep audit, use `analyse_content` followed by the specialist tools.

> **`check_meta_tags` vs `suggest_meta_tags`:** use `check_meta_tags` when the user already has a title/meta and wants it validated. Use `suggest_meta_tags` when they need new ones written.

---

## Interpreting results

### `calculate_seo_score`
- Lead with `score` and `grade_label` (e.g. *"Your content scored 74/100 — Good"*)
- Walk through `category_breakdown` so the user sees where points were lost
- Present `prioritised_fixes` as a numbered action list — highest-impact fixes are first
- If `keyword_scoring_active` is `false`, note that 30 keyword points were excluded and ask for a primary keyword to get a complete score
- Grade scale: **A (90–100)** Excellent · **B (75–89)** Good · **C (60–74)** Needs improvement · **D (40–59)** Poor · **F (<40)** Critical

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

**⚠️ Missing meta tags — required behaviour:**
If `title_tag.text` is `null` OR `meta_description.text` is `null`, you **must stop and ask the user** before continuing:

> "I noticed your content is missing a [title tag / meta description]. Would you like to:
> 1. **Provide one yourself** — paste it in and I'll validate it
> 2. **Have me generate one** — I'll use your content and keyword to suggest options"

Do not silently run `suggest_meta_tags` and present results without asking first.

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

## Workflow for a full SEO review

1. Run `calculate_seo_score` to get an immediate headline score and prioritised fix list
2. Share the score, grade, and category breakdown with the user
3. Run `check_meta_tags` to check for existing meta title and description
   - If either is **missing** → **stop and ask the user** (see prompt in the `check_meta_tags` section above) before proceeding
   - If both exist → present the validation results and continue
4. For deeper analysis, run `analyse_content` and summarise the `audit_checklist`
5. If keyword density issues exist → run `check_keyword_density` for detail
6. If readability issues exist → run `check_readability` for detail
7. If heading issues exist → run `check_heading_structure` for the visual tree
8. Summarise all recommended actions using `prioritised_fixes` from the score as the backbone

---

## Tips

- Always pass `primary_keyword` in lowercase — matching is case-insensitive but consistency helps
- `secondary_keywords` in `analyse_content` is optional but useful for topic-cluster content
- `check_meta_tags` requires HTML — it will return an error for Markdown input (redirect to `suggest_meta_tags`)
- For plain Markdown, `title_tag` and `meta_description` fields in `analyse_content` will be `null` — that's expected; focus on H1 and body keyword checks instead
- Don't flag `N/A` values as issues — they simply mean the check doesn't apply to the content type
