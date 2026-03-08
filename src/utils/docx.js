const mammoth = require("mammoth");
const fs = require("fs");

/**
 * Extracts clean HTML from a .docx file using mammoth.
 * Maps Word headers to standard HTML headers.
 * 
 * @param {string} filePath Path to the .docx file
 * @returns {Promise<string>} The extracted HTML
 */
async function extractHtmlFromDocx(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    const options = {
        styleMap: [
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
            "p[style-name='Heading 4'] => h4:fresh",
            "p[style-name='Heading 5'] => h5:fresh",
            "p[style-name='Heading 6'] => h6:fresh",
        ]
    };

    const result = await mammoth.convertToHtml({ path: filePath }, options);
    return result.value; // The generated HTML
}

module.exports = {
    extractHtmlFromDocx,
};
