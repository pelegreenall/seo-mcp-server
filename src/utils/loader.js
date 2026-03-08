/**
 * Resolves the raw content string from a tool's arguments.
 * - If `filepath` is provided, reads the file from disk (.docx → HTML, others → utf8 text).
 * - If `content` is provided, returns it as-is.
 * - Throws a clear Error if neither is provided or the file can't be found.
 *
 * @param {{ content?: string, filepath?: string }} args
 * @returns {Promise<string>}
 */
const fs = require("fs");
const path = require("path");
const { extractHtmlFromDocx } = require("./docx");

async function loadContent({ content, filepath }) {
    if (filepath) {
        if (!fs.existsSync(filepath)) {
            throw new Error(`File not found: ${filepath}`);
        }
        const ext = path.extname(filepath).toLowerCase();
        if (ext === ".docx") {
            return extractHtmlFromDocx(filepath);
        }
        return fs.readFileSync(filepath, "utf8");
    }

    if (content !== undefined && content !== null && content !== "") {
        return content;
    }

    throw new Error("No content provided. Supply either 'content' or a valid 'filepath'.");
}

module.exports = { loadContent };
