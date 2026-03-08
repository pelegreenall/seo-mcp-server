# SEO Content Analysis MCP

An MCP server for Claude Desktop that gives Claude the tools to do a full SEO audit on **unpublished** content — HTML, Markdown, or Word (.docx) files.

---

## Tools included

| Tool | What it does |
|---|---|
| `calculate_seo_score` | Overall score out of 100 — Technical SEO, keyword optimisation, structure, readability — with a prioritised fix list |
| `analyse_content` | Full audit: word count, headings, keyword placement, meta tags, internal links, pass/fail checklist |
| `check_meta_tags` | Validates an existing title tag and meta description in HTML |
| `suggest_meta_tags` | Generates title, meta description, and URL slug suggestions from draft content |
| `check_keyword_density` | Counts keyword occurrences, calculates density %, flags over/under optimisation |
| `check_readability` | Flesch Reading Ease score, avg sentence length, flags long sentences |
| `check_heading_structure` | Validates H1 > H2 > H3 hierarchy, flags skipped levels and missing H1 |

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

After saving the config, restart Claude Desktop. You should see 7 SEO tools available in the tools palette.

---

## Usage

Once connected, you can ask Claude things like:

- "Audit this blog post for SEO" — paste content, or provide a local file path
- "Score this draft out of 100" — give it a `.docx` path or paste the text
- "Check keyword density for 'cohort analysis'"
- "Suggest a meta title and description for this article"
- "Is the heading structure correct in this Word doc?"

### Providing content

Tools accept either:
- **`content`** — paste raw HTML, Markdown, or plain text directly
- **`filepath`** — an absolute Windows path to a local file (`.docx`, `.html`, `.md`, `.txt`)

> **Note:** Files uploaded via the Claude chat interface cannot be accessed as a `filepath`. Paste the text content directly instead.

### Meta tag heuristics

For Word/Markdown files that don't have HTML `<title>` / `<meta>` tags, the tools will detect meta tags written in your document using:
- A table with "Meta Title" / "Meta Description" label-value rows
- Inline text like `Meta Title: Your title here`

---

## Project structure

```
seo-mcp-server/
├── src/
│   ├── index.js              # Entry point
│   ├── server.js             # MCP server setup & request routing
│   ├── utils/
│   │   ├── content.js        # HTML/Markdown parsing, keyword matching
│   │   ├── docx.js           # Word (.docx) → HTML via mammoth
│   │   └── loader.js         # Shared file-loading utility for all tools
│   └── tools/
│       ├── index.js          # Auto-discovers and loads all tool modules
│       ├── analyseContent.js
│       ├── calculateSeoScore.js
│       ├── checkKeywordDensity.js
│       ├── checkReadability.js
│       ├── checkMetaTags.js
│       ├── suggestMetaTags.js
│       └── checkHeadingStructure.js
├── SKILL.md                  # AI assistant instructions for using these tools
├── package.json
└── README.md
```

> **Adding a new tool:** create a new file in `src/tools/` that exports `{ schema, handler }` and call `await loadContent({ content, filepath })` at the top — nothing else needs changing.

---

## Dependencies

- `@modelcontextprotocol/sdk` — MCP server framework
- `cheerio` — HTML/DOM parsing
- `mammoth` — Word (.docx) to HTML conversion
- `marked` — Markdown to HTML conversion
