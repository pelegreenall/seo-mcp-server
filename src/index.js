#!/usr/bin/env node

const { start } = require("./server");

start().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
