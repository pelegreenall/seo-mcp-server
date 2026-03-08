# SEO Content Analysis MCP

An MCP server for Claude Co-work that gives Claude the tools to do a full SEO audit on **unpublished** HTML or Markdown content.

---

## Tools included

| Tool | What it does |
|---|---|
| `analyse_content` | Full SEO audit: word count, headings, keyword placement, meta tags, internal links, pass/fail checklist |
| `check_keyword_density` | Counts occurrences of a keyword, calculates density %, flags over/under optimisation |
| `check_readability` | Flesch Reading Ease score, avg sentence/paragraph length, flags long sentences |
| `suggest_meta_tags` | Generates title tag, meta description, and URL slug suggestions |
| `check_heading_structure` | Validates H1 > H2 > H3 hierarchy, flags skipped levels and missing H1 |

---

## Setup

### 1. Install dependencies

```bash
cd seo-mcp
npm install
```

### 2. Add to Claude Co-work

In Claude Co-work, open **Settings > MCP Servers** and add a new server with this config:

```json
{
  "mcpServers": {
    "seo-content-analysis": {
      "command": "node",
      "args": ["/absolute/path/to/seo-mcp/index.js"]
    }
  }
}
```

Replace `/absolute/path/to/seo-mcp/` with the actual path on your machine.

### 3. Restart Claude Co-work

After adding the server, restart Co-work. You should see the 5 SEO tools available.

---

## Usage examples

Once connected, you can ask Claude things like:

- "Analyse this draft blog post for SEO" (paste HTML or Markdown)
- "Check the keyword density for 'workflow automation' in this content"
- "Suggest a title tag and meta description for this article"
- "Is the heading structure correct in this draft?"
- "Run a readability check on this copy"

---

## Dependencies

- `@modelcontextprotocol/sdk` - MCP server framework
- `cheerio` - HTML parsing (also handles plain text / Markdown)

Both are installed via `npm install`.
