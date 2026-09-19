# SEO Content Analysis MCP

An MCP server for Claude Desktop that gives Claude the tools to do a full SEO audit on **unpublished** content — HTML, Markdown, TSX/JSX, or Word (.docx) files.

It covers classic on-page SEO (meta tags, headings, keyword placement, readability) and the signals that decide whether content gets surfaced by **AI answer engines** — chunk-level retrievability, structured data, and E-E-A-T.

---

## Tools included

### Scoring & full audits

| Tool | What it does |
|---|---|
| `calculate_seo_score` | Overall score out of 100 across 10 categories, with a prioritised fix list. See [Scoring](#scoring) |
| `analyse_content` | Full audit: word count, headings, keyword placement, search intent, meta tags, internal links, pass/fail checklist |

### AI answer engines & trust signals

| Tool | What it does |
|---|---|
| `check_ai_retrievability` | Scores content **chunk by chunk** (one chunk per H2) for AI Overview / ChatGPT / Perplexity citation — self-contained sections, orphan pronoun openers, quantified claims, answer-first paragraphs, chunk sizing, structured formats |
| `check_structured_data` | Parses and validates JSON-LD, checks it **matches the visible content**, recommends missing schema types, returns a ready-to-paste stub |
| `check_eeat_signals` | Author identification, published/modified dates and staleness, first-hand experience markers, source authority tiers, statistics stated without a citation |
| `check_snippet_optimization` | Featured-snippet readiness of paragraphs under question headings — length *and* whether they open with the answer |

### Keywords & topic coverage

| Tool | What it does |
|---|---|
| `check_keyword_density` | Counts keyword occurrences, calculates density %, flags over/under optimisation |
| `check_semantic_coverage` | Topical authority — how much of an expected LSI term set the content covers |

### Meta tags & SERP

| Tool | What it does |
|---|---|
| `check_meta_tags` | Validates an existing title tag and meta description, including search intent alignment |
| `suggest_meta_tags` | Generates title, meta description, and URL slug suggestions, tailored to search intent |
| `check_seo_preview` | SERP preview for slug, title and meta description |

### Structure & readability

| Tool | What it does |
|---|---|
| `check_heading_structure` | Validates H1 > H2 > H3 hierarchy, flags skipped levels and missing H1 |
| `check_readability` | Flesch Reading Ease score, avg sentence length, flags long sentences |
| `analyze_links` | Internal/external split, anchor-text quality |

### Input conversion

| Tool | What it does |
|---|---|
| `convert_tsx_to_html` | Converts `.tsx`/`.jsx` components to HTML so they can be audited |

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add to Claude Desktop config

Open `%APPDATA%\Claude\claude_desktop_config.json` and add:

```json
{
  "mcpServers": {
    "seo-content-analysis": {
      "command": "node",
      "args": ["C:\\absolute\\path\\to\\seo-mcp-server\\src\\index.js"]
    }
  }
}
```

### 3. Restart Claude Desktop

After saving the config, restart Claude Desktop. You should see 15 SEO tools available in the tools palette.

### 4. Activate SEO Skill (Recommended)

To ensure Claude follows the correct workflow (asking for keywords/meta tags before auditing), you should provide it with the instructions in `SKILL.md`.

1. Make a copy of `SKILL.md` and name it `seo-content-analysis.md`.
2. Upload this file to your Claude chat or add it to your **Project Knowledge** (if using Claude Projects).
3. If you uploaded it to a chat, ask Claude: *"Read seo-content-analysis.md and follow these pre-flight instructions for all SEO audits in this thread."*

---

## Usage

Once connected, you can ask Claude things like:

- "Audit this blog post for SEO" — paste content, or provide a local file path
- "Score this draft out of 100" — give it a `.docx` path or paste the text
- "Will this get cited by AI Overviews?" — runs `check_ai_retrievability`
- "Check my schema markup" — runs `check_structured_data`
- "Does this have enough E-E-A-T?" — runs `check_eeat_signals`
- "Check keyword density for 'cohort analysis'"
- "Suggest a meta title and description for this article"
- "Is the heading structure correct in this Word doc?"

### Providing content

Tools accept either:
- **`content`** — paste raw HTML, Markdown, or plain text directly
- **`filepath`** — an absolute path to a local file (`.docx`, `.html`, `.md`, `.txt`, `.tsx`, `.jsx`)

> **Note:** Files uploaded via the Claude chat interface cannot be accessed as a `filepath`. Paste the text content directly instead.

### Set `site_domain` for any site that isn't the default

`calculate_seo_score`, `analyze_links` and `check_eeat_signals` accept a **`site_domain`** parameter (e.g. `"example.com"`). It decides which links count as internal.

The default is `veritly.co`. If you audit content for a different site without setting it, every absolute link to that site is counted as **external** — which silently inflates the external link count and distorts both the Link Profile score and the E-E-A-T citation tiers.

---

## Scoring

`calculate_seo_score` returns a percentage out of a **215-point** maximum:

| Category | Points | What it measures |
|---|---:|---|
| Topical Authority | 35 | Coverage of the expected LSI/semantic term set |
| Keyword Optimisation | 25 | Keyword in title/H1, first paragraph, an H2, meta description |
| Content Structure | 25 | Single H1, H2s present, clean hierarchy, word count |
| AI Retrievability | 25 | Self-contained chunks, extractable claims, chunk sizing, answer-first, structured formats |
| E-E-A-T Signals | 25 | Authorship, dates, first-hand experience, source authority, claim support |
| Technical SEO | 20 | Title tag and meta description presence and length |
| Link Profile | 20 | Internal links, external links, anchor-text quality |
| Readability | 15 | Flesch Reading Ease |
| Structured Data | 15 | JSON-LD validity and consistency with visible content |
| Snippet Readiness | 10 | A 40–60 word direct answer under a question heading |

**Grades:** A (90–100%) · B (75–89%) · C (60–74%) · D (40–59%) · F (<40%)

### The maximum scales to the inputs

Categories that cannot be assessed are removed from the denominator, so grades stay comparable:

- No `expected_terms` → **Topical Authority (35)** excluded
- No `primary_keyword` → **Keyword Optimisation (25)** excluded
- Non-HTML input (Markdown, `.docx`) → **Structured Data (15)** excluded, since JSON-LD only exists in HTML

`sub_scores` additionally reports AI Retrievability, E-E-A-T and Structured Data as standalone percentages.

---

## Project structure

```
seo-mcp-server/
├── src/
│   ├── index.js                      # Entry point
│   ├── server.js                     # MCP server setup & request routing
│   ├── utils/
│   │   ├── content.js                # Parsing, section chunking, sentence splitting,
│   │   │                             #   link classification, intent detection
│   │   ├── docx.js                   # Word (.docx) → HTML via mammoth
│   │   └── loader.js                 # Shared file-loading utility for all tools
│   └── tools/
│       ├── index.js                  # Auto-discovers and loads all tool modules
│       ├── analyseContent.js
│       ├── analyzeLinks.js
│       ├── calculateSeoScore.js
│       ├── checkAiRetrievability.js
│       ├── checkEeatSignals.js
│       ├── checkHeadingStructure.js
│       ├── checkKeywordDensity.js
│       ├── checkMetaTags.js
│       ├── checkReadability.js
│       ├── checkSemanticCoverage.js
│       ├── checkSeoPreview.js
│       ├── checkSnippetOptimization.js
│       ├── checkStructuredData.js
│       ├── convertTsxToHtml.js
│       └── suggestMetaTags.js
├── SKILL.md                          # Master instructions for Claude (copy and rename to use)
├── package.json
└── README.md
```

> **Adding a new tool:** create a new file in `src/tools/` that exports `{ schema, handler }` and call `await loadContent({ content, filepath })` at the top — nothing else needs changing.

### Shared helpers worth knowing about

Anything reused across tools lives in `src/utils/content.js`, so two tools can't drift apart on the same judgement:

- **`getSections($)`** — splits content into retrieval chunks, one per H2, walking nested markup so React/CMS output chunks the same as flat Markdown
- **`isQuestionHeading()` / `detectPreamble()`** — shared by `check_snippet_optimization` and `check_ai_retrievability` so they can never contradict each other on whether a paragraph answers directly
- **`classifyHref()`** — internal/external/other link classification, subdomain-aware
- **`extractPlainText($)`** — body copy only; works on a clone, strips `<script>`/`<style>`, and strips `nav`/`header`/`footer`/`aside` only when they sit outside `<article>`/`<main>`
- **`detectIntent()` / `checkIntentAlignment()`** — search intent classification used by the meta tag tools

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `cheerio` — HTML/DOM parsing
- `mammoth` — Word (.docx) to HTML conversion
- `marked` — Markdown to HTML conversion
