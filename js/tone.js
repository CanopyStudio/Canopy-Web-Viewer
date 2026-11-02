// A theme's tone, as Canopy Board and Viewer make it (Kit/Look/Appearance.cs, Toned): the theme, whichever it is, made
// darker and richer ("dark") or lighter ("light"). Dark: surfaces lose about a sixth of their lightness and take more of
// the theme's own color, borders a little less so panels stay apart; the accent a little richer, text a touch softer.
// Light: surfaces a fifth lighter and a little calmer, text a touch brighter. Notice and guide as they are. Worked in
// OKLCH, where lightness and color move apart.
const SURFACE = ["Canvas", "Chrome", "Card", "Button", "Note", "Note row", "Field", "Chosen"];
const EDGE = ["Border", "Note edge", "Field edge", "Faded"];
const TEXT = ["Ink", "Muted", "Heading"];
const ACCENT = ["Accent", "Accent deep"];
const BY = 0.6;

export function toned(colors, tone)
{
    if (tone !== "dark" && tone !== "light") return colors;
    const k = BY, dark = tone === "dark";
    const card = oklch(colors.Card), accent = oklch(colors.Accent), gray = card[1] <= 0.008;   // (a near-gray theme leans toward its accent's hue)
    const out = {};
    for (const role in colors)
    {
        const c = oklch(colors[role]);
        if (dark)
        {
            if (SURFACE.includes(role)) { c[0] *= 1 - 0.30 * k; c[1] = c[1] * (1 + 0.9 * k) + 0.006 * k; if (gray) c[2] = accent[2]; }
            else if (EDGE.includes(role)) { c[0] *= 1 - 0.20 * k; c[1] = c[1] * (1 + 0.7 * k) + 0.004 * k; if (gray) c[2] = accent[2]; }
            else if (TEXT.includes(role)) { c[0] -= 0.04 * k; c[1] *= 1 + 0.3 * k; }
            else if (ACCENT.includes(role)) { c[0] -= 0.02 * k; c[1] *= 1 + 0.22 * k; }
        }
        else
        {
            if (SURFACE.includes(role)) { c[0] *= 1 + 0.38 * k; c[1] *= 1 - 0.3 * k; }
            else if (EDGE.includes(role)) { c[0] *= 1 + 0.30 * k; c[1] *= 1 - 0.25 * k; }
            else if (TEXT.includes(role)) c[0] = Math.min(0.97, c[0] + 0.03 * k);
            else if (ACCENT.includes(role)) c[0] += 0.03 * k;
        }
        out[role] = hex(c);
    }
    return out;
}

function oklch(h)
{
    const lin = v => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    h = h.replace("#", "");
    const r = lin(parseInt(h.slice(0, 2), 16)), g = lin(parseInt(h.slice(2, 4), 16)), b = lin(parseInt(h.slice(4, 6), 16));
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s, B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
    return [L, Math.hypot(A, B), Math.atan2(B, A)];
}

function hex([L, C, H])
{
    const A = C * Math.cos(H), B = C * Math.sin(H);
    const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3, m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3, s = (L - 0.0894841775 * A - 1.2914855480 * B) ** 3;
    const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
    const gam = x => { x = x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055; return Math.round(Math.min(1, Math.max(0, x)) * 255); };
    return "#" + rgb.map(gam).map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}
