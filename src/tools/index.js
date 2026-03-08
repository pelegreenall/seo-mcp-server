/**
 * Auto-discovers and loads every tool module in this directory.
 * Each module must export { schema, handler }.
 *
 * To add a new tool: create a new .js file here — no other file needs touching.
 */

const path = require("path");
const fs = require("fs");

const tools = fs
    .readdirSync(__dirname)
    .filter((f) => f !== "index.js" && f.endsWith(".js"))
    .map((f) => require(path.join(__dirname, f)));

module.exports = tools;
