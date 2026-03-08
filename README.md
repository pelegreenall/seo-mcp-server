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
- "Check keyword density for 'cohort analysis'"
- "Suggest a meta title and description for this article"
- "Is the heading structure correct in this Word doc?"

### Providing content

Tools accept either:
- **`content`** — paste raw HTML, Markdown, or plain text directly
- **`filepath`** — an absolute Windows path to a local file (`.docx`, `.html`, `.md`, `.txt`)

> **Note:** Files uploaded via the Claude chat interface cannot be accessed as a `filepath`. Paste the text content directly instead.

### Workflow

For the most accurate score, Claude will ask for two things before running the audit on a non-HTML document:

1. **Primary keyword** — needed for 30/100 of the score (keyword optimisation category)
2. **Meta title + description** — needed for 25/100 (Technical SEO category)

If these are not in your document, Claude will ask for them during the pre-flight check.

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
├── SKILL.md                  # Master instructions for Claude (copy and rename to use)
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
