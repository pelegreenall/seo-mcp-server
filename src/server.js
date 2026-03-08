const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { ListToolsRequestSchema, CallToolRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const tools = require("./tools");

// ─── Server instance ─────────────────────────────────────────────────────────

const server = new Server(
    { name: "seo-content-analysis", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

// ─── tools/list ──────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => t.schema),
}));

// ─── tools/call ──────────────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = tools.find((t) => t.schema.name === name);

    if (!tool) {
        return {
            content: [{ type: "text", text: `Error: Unknown tool "${name}"` }],
            isError: true,
        };
    }

    try {
        const { filepath } = args || {};

        // Detect upload paths (Claude sandbox) — can't be accessed by local server
        if (filepath && (filepath.startsWith("/mnt/user-data/uploads/") || filepath.startsWith("/mnt/"))) {
            return {
                content: [{ type: "text", text: `Error: The path "${filepath}" is an internal Claude upload path that cannot be accessed by the local MCP server. To analyse an uploaded file, paste the file's text content directly into the "content" parameter instead. For .docx files, provide the full local disk path (e.g. C:\\Users\\peleg\\Documents\\file.docx).` }],
                isError: true,
            };
        }

        const result = await tool.handler(args);
        return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
    } catch (err) {
        console.error(`[${name}] Error:`, err.message);
        return {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
        };
    }
});

// ─── Start ───────────────────────────────────────────────────────────────────

async function start() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error(
        `SEO Content Analysis MCP server running on stdio (${tools.length} tools loaded)`
    );
}

module.exports = { start };
