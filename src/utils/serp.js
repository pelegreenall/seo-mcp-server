/**
 * Rendered-width measurement for SERP listings.
 *
 * Google truncates titles and descriptions on RENDERED PIXEL WIDTH, not on
 * character count. "WWWWWWWWWW" and "iiiiiiiiii" are both ten characters and
 * differ by roughly 3x on screen, so a character limit passes titles that get
 * cut mid-sentence and fails titles that would have fitted.
 *
 * There's no browser here, so width is computed from an embedded table of
 * Arial advance widths (the standard Helvetica/Arial AFM metrics, in 1/1000 em
 * units). This is how SERP preview tools do it — no font file, no dependency,
 * deterministic.
 *
 * ── Accuracy ──
 * These are ESTIMATES. Google renders Arial around 20px on desktop, but uses
 * different fonts on Android and iOS, and has changed SERP typography before.
 * The limits below are the widely reported desktop values and are exported so
 * they can be corrected without touching the measurement code. Treat a result
 * within ~5% of a limit as "borderline" rather than a hard pass or fail.
 */

// Arial / Helvetica advance widths, 1/1000 em. Covers printable ASCII.
const ADVANCE = {
    " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191,
    "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333, ".": 278, "/": 278,
    0: 556, 1: 556, 2: 556, 3: 556, 4: 556, 5: 556, 6: 556, 7: 556, 8: 556, 9: 556,
    ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500,
    K: 667, L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
    U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222,
    k: 500, l: 222, m: 833, n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278,
    u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    "{": 334, "|": 260, "}": 334, "~": 584,
};

// Common non-ASCII that shows up in titles, mapped to their Arial widths.
const ADVANCE_EXTRA = {
    "‘": 222, "’": 222, "“": 333, "”": 333, // smart quotes
    "–": 556, "—": 1000, // en dash, em dash
    "…": 1000, // ellipsis
    " ": 278, // nbsp
    "·": 278, "•": 350, // middle dot, bullet
    "£": 556, "€": 556, "©": 737, "®": 737, "™": 1000,
};

/** Fallback for anything not in the tables — a lowercase-average advance. */
const DEFAULT_ADVANCE = 556;

// Desktop SERP rendering, as commonly reported. Exported so they can be tuned.
const TITLE_FONT_PX = 20;
const TITLE_LIMIT_PX = 600;
const DESC_FONT_PX = 14;
const DESC_LIMIT_PX = 920;

/** Width of a single character in 1/1000 em units. */
function advanceOf(ch) {
    if (Object.prototype.hasOwnProperty.call(ADVANCE, ch)) return ADVANCE[ch];
    if (Object.prototype.hasOwnProperty.call(ADVANCE_EXTRA, ch)) return ADVANCE_EXTRA[ch];
    // Emoji and CJK render far wider than Latin text.
    const code = ch.codePointAt(0);
    if (code > 0x1f000) return 1000;
    if (code >= 0x2e80 && code <= 0x9fff) return 1000;
    return DEFAULT_ADVANCE;
}

/** Rendered width of `text` at `fontSizePx`, in pixels (1 decimal place). */
function measureText(text, fontSizePx) {
    if (!text) return 0;
    let units = 0;
    for (const ch of String(text)) units += advanceOf(ch);
    return Math.round((units * fontSizePx) / 1000 * 10) / 10;
}

/**
 * Cut `text` to the widest prefix that fits `limitPx`, breaking on a word
 * boundary the way Google does, and return the kept and dropped halves.
 */
function truncateToWidth(text, fontSizePx, limitPx) {
    if (!text) return { kept: "", lost: "" };
    if (measureText(text, fontSizePx) <= limitPx) return { kept: text, lost: "" };

    // The ellipsis Google appends occupies width too.
    const budget = limitPx - measureText("…", fontSizePx);
    const words = text.split(/(\s+)/); // keep separators so we can rebuild exactly
    let kept = "";
    for (const part of words) {
        if (measureText(kept + part, fontSizePx) > budget) break;
        kept += part;
    }
    if (!kept.trim()) {
        // A single word wider than the whole budget — cut mid-word.
        for (const ch of text) {
            if (measureText(kept + ch, fontSizePx) > budget) break;
            kept += ch;
        }
    }
    return { kept: kept.trimEnd(), lost: text.slice(kept.length).trim() };
}

/** Shared shape for a measured SERP field. */
function measureField(text, { fontPx, limitPx, label }) {
    if (!text) {
        return {
            text: null,
            char_count: 0,
            pixel_width: 0,
            pixel_limit: limitPx,
            width_used_percent: 0,
            truncated: false,
            status: "Missing",
            advice: `No ${label} to measure.`,
        };
    }

    const px = measureText(text, fontPx);
    const { kept, lost } = truncateToWidth(text, fontPx, limitPx);
    const truncated = lost.length > 0;
    const usedPercent = Math.round((px / limitPx) * 100);

    let status, advice;
    if (truncated) {
        status = "Truncated";
        advice = `${px}px against a ~${limitPx}px limit. Google cuts it to "${kept}…" and drops "${lost}". Move anything load-bearing before the cut.`;
    } else if (usedPercent >= 95) {
        status = "Borderline";
        advice = `${px}px against a ~${limitPx}px limit (${usedPercent}% used). Fits, but with no margin — rendering varies by device, so it may truncate on some.`;
    } else if (usedPercent < 60) {
        status = "Under-using space";
        advice = `${px}px of a ~${limitPx}px limit (${usedPercent}% used). Roughly ${Math.round(limitPx - px)}px of free SERP real estate — a longer, more specific ${label} costs nothing and takes more attention.`;
    } else {
        status = "Good";
        advice = `${px}px of a ~${limitPx}px limit (${usedPercent}% used) — uses the space without risking a cut.`;
    }

    return {
        text,
        char_count: text.length,
        pixel_width: px,
        pixel_limit: limitPx,
        width_used_percent: usedPercent,
        truncated,
        renders_as: truncated ? `${kept}…` : text,
        lost_to_truncation: truncated ? lost : null,
        status,
        advice,
    };
}

/** Measure a title tag as Google renders it on desktop. */
function measureTitle(text) {
    return measureField(text, { fontPx: TITLE_FONT_PX, limitPx: TITLE_LIMIT_PX, label: "title" });
}

/** Measure a meta description as Google renders it on desktop. */
function measureDescription(text) {
    return measureField(text, { fontPx: DESC_FONT_PX, limitPx: DESC_LIMIT_PX, label: "description" });
}

module.exports = {
    measureText,
    truncateToWidth,
    measureTitle,
    measureDescription,
    TITLE_FONT_PX,
    TITLE_LIMIT_PX,
    DESC_FONT_PX,
    DESC_LIMIT_PX,
};
