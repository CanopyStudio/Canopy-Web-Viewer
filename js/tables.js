// Tables, laid out as Canopy Board lays them out (its Canvas/Layers/TableLayer.cs): a grid of cells, each set as type in
// its paragraph style (the header rows', the first column's or the body's; a cell style's for the odd one out), with
// the table's look (its own, over its table style from the library): fills, row and column lines, a border, padding.
// Drawn as the shapes and type it is made of; made again only when it changes. Also the library's styles, as type
// takes them (styles.js would be one more file for these few lines).

// ---- the library (a .clib, or a document's copy of it) ----

const find = (all, id) => id && Array.isArray(all) ? all.find(o => o && o.id === id) || null : null;

// A color as "#RRGGBB": a library color's id, or a hex given directly.
function colorOf(lib, v)
{
    if (typeof v !== "string") return null;
    if (v.startsWith("#")) return v;
    const c = lib ? find(lib.colors, v) : null;
    return c ? c.value : null;
}

// A style as it comes out: what it sets, over what the styles it is based on set.
function resolve(lib, id)
{
    if (!lib) return null;
    const all = (lib.paragraphStyles || []).concat(lib.characterStyles || []);
    const made = {}, seen = new Set();
    for (let s = find(all, id); s && !seen.has(s.id); s = find(all, s.basedOn))
    {
        seen.add(s.id);
        for (const k of Object.keys(s)) if (made[k] === undefined) made[k] = s[k];
    }
    return seen.size ? made : null;
}

// Type given a paragraph style's values (Board's NamedStyles.Apply), as a copy.
function styled(o, lib, id)
{
    const s = resolve(lib, id);
    if (!s) return o;
    const q = { ...o };
    if (s.font) q.font = s.font;
    if (s.weight !== undefined) q.weight = s.weight;
    if (s.italic !== undefined) q.italic = !!s.italic;
    if (s.size !== undefined) q.size = s.size;
    if (s.tracking !== undefined) q.tracking = s.tracking;
    if (s.color) { const c = colorOf(lib, s.color); if (c) q.fill = c; }
    if (typeof s.lineHeight === "number") q.leading = s.lineHeight;
    else if (s.lineHeight === "auto") q.leading = 0;
    else if (typeof s.lineHeight === "string" && s.lineHeight.endsWith("%")) q.leading = -parseFloat(s.lineHeight) / 100;
    q.align = ["left", "center", "right", "justify"].indexOf(s.align); if (q.align < 0) q.align = 0;
    q.textCase = ["asTyped", "upper", "lower", "title"].indexOf(s.case); if (q.textCase < 0) q.textCase = 0;
    if (Array.isArray(s.decorations)) q.deco = s.decorations.reduce((a, d) => a | (d === "underline" ? 1 : d === "strike" ? 2 : 0), 0);
    return q;
}

// ---- a table's look ----

const num = (v, or) => typeof v === "number" && isFinite(v) ? v : or;

function lookOf(grid, lib)
{
    const st = lib ? find(lib.tableStyles, grid.tableStyle) : null;
    const s = st ? { ...st } : { rowLine: { width: 1, color: "#BFC1CC" }, border: { width: 1, color: "#BFC1CC" }, columnLines: true };
    if (grid.look) for (const k of Object.keys(grid.look)) s[k] = grid.look[k];
    const k = { pad: [4, 6, 4, 6], inset: [0, 0, 0, 0], headerFill: null, altFill: null, line: "#E2E3EC", border: null, fill: null, lineWidth: 1, borderWidth: 0, corner: 0, columnLines: false };
    if (Array.isArray(s.padding) && s.padding.length === 4) k.pad = s.padding.map(v => num(v, 0));
    if (Array.isArray(s.inset) && s.inset.length === 2) k.inset = [0, num(s.inset[1], 0), 0, num(s.inset[0], 0)];
    else if (Array.isArray(s.inset) && s.inset.length === 4) k.inset = s.inset.map(v => num(v, 0));
    k.body = s.body; k.header = s.header; k.first = s.firstColumn;
    k.headerFill = colorOf(lib, s.headerFill); k.altFill = colorOf(lib, s.altFill);
    if (s.rowLine && typeof s.rowLine === "object") { k.lineWidth = num(s.rowLine.width, 1); k.line = colorOf(lib, s.rowLine.color) || k.line; }
    else if ("rowLine" in s) k.lineWidth = 0;   // (null: none)
    if (s.border && typeof s.border === "object") { k.borderWidth = num(s.border.width, 1); k.border = colorOf(lib, s.border.color) || k.line; }
    k.fill = colorOf(lib, s.fill);
    k.corner = Math.max(0, num(s.corner, 0));
    k.columnLines = s.columnLines === true;
    return k;
}
function cellLook(cell, lib)
{
    const cs = lib ? find(lib.cellStyles, cell.cellStyle) : null;
    if (!cell.look || !Object.keys(cell.look).length) return cs;
    return { ...(cs || {}), ...cell.look };
}
const seen = c => c && !/^#00[0-9A-Fa-f]{6}$/.test(c);   // (a color that shows: not fully clear)

// ---- laid out ----

const made = new WeakMap();
// The shapes and type a table is drawn as, in place ("measure": how tall type comes out at its width).
export function tableParts(o, doc, measure)
{
    const grid = o.grid;
    if (!grid || !Array.isArray(grid.rows)) return [];
    const lib = doc ? doc.styles : null;
    const key = [o.x, o.y, o.w, o.font, o.size, o.fill, JSON.stringify(grid), lib ? lib._key || (lib._key = JSON.stringify([lib.colors, lib.paragraphStyles, lib.tableStyles, lib.cellStyles])) : ""].join("|");
    const was = made.get(o);
    if (was && was.key === key) return was.parts;
    const k = lookOf(grid, lib);
    // Its columns: fixed widths, and shares of what is left.
    const cols = (grid.columns && grid.columns.length ? grid.columns : ["*"]).map(c => typeof c === "number" ? Math.max(1, c) : -(parseFloat(String(c).replace(/\*$/, "")) || 1));
    const fixed = cols.filter(w => w > 0).reduce((a, b) => a + b, 0), shares = cols.filter(w => w < 0).reduce((a, b) => a - b, 0);
    const left = Math.max(0, o.w - fixed), w = cols.map(c => c > 0 ? c : shares > 0 ? left * -c / shares : 0);
    const x = [0]; for (const v of w) x.push(x[x.length - 1] + v);
    const nc = w.length;
    const rows = grid.rows.map(r => { const cells = (Array.isArray(r) ? r : []).slice(0, nc).map(c => typeof c === "string" ? { text: c } : { text: c.text || "", runs: c.runs || null, cellStyle: c.cellStyle || null, look: c.look || null, span: Array.isArray(c.span) ? c.span : null }); while (cells.length < nc) cells.push({ text: "" }); return cells; });
    const nr = rows.length, header = Math.min(Math.max(0, Math.min(3, num(grid.headerRows, 1))), nr);
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) { const cell = rows[r][c]; cell.across = Math.max(1, Math.min(cell.span ? cell.span[0] | 0 : 1, nc - c)); cell.down = Math.max(1, Math.min(cell.span ? cell.span[1] | 0 : 1, nr - r)); }
    // Which cell covers each place (a merged cell covers others).
    const owner = rows.map(() => new Array(nc).fill(null));
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++)
    {
        if (owner[r][c]) continue;
        const cell = rows[r][c];
        for (let dr = 0; dr < cell.down; dr++) for (let dc = 0; dc < cell.across; dc++) if (!owner[r + dr][c + dc]) owner[r + dr][c + dc] = r + "," + c;
    }
    const colStyle = c => Array.isArray(grid.columnStyles) ? grid.columnStyles[c] || null : null;
    // Each cell's type at its width; then each row as tall as its tallest cell.
    const types = new Map(), h = new Array(nr).fill(0);
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++)
    {
        if (owner[r][c] !== r + "," + c) continue;
        const cell = rows[r][c], cs = cellLook(cell, lib);
        const width = x[Math.min(nc, c + cell.across)] - x[c];
        let t = { kind: "type", id: o.id + ":" + r + "," + c, text: cell.text, runs: cell.runs, font: o.font, weight: o.weight || 400, italic: false, size: o.size, fill: o.fill, leading: o.leading || 0, tracking: 0, align: 0, textCase: 0, deco: 0, hscale: 1, fixed: true, x: 0, y: 0, w: Math.max(1, width - k.pad[1] - k.pad[3] - (c === 0 ? k.inset[3] : 0) - (c + cell.across >= nc ? k.inset[1] : 0)), h: 0 };
        const ps = cs && cs.paragraphStyle ? cs.paragraphStyle : r < header ? k.header || k.body : colStyle(c) || (c === 0 && k.first ? k.first : k.body);
        if (r < header && !ps) t.weight = 600;
        if (lib && ps) t = styled(t, lib, ps);
        t.h = measure(t);
        types.set(r + "," + c, t);
        if (cell.down === 1) h[r] = Math.max(h[r], t.h + k.pad[0] + k.pad[2]);
    }
    for (let r = 0; r < nr; r++) if (h[r] <= 0) h[r] = k.pad[0] + k.pad[2] + 12;
    if (nr > 0) { h[0] += k.inset[0]; h[nr - 1] += k.inset[2]; }
    for (const [at, t] of types)
    {
        const [r0, c0] = at.split(",").map(Number), cell = rows[r0][c0];
        if (cell.down <= 1) continue;
        const last = Math.min(nr, r0 + cell.down) - 1;
        let have = 0; for (let r = r0; r <= last; r++) have += h[r];
        const need = t.h + k.pad[0] + k.pad[2];
        if (need > have) h[last] += need - have;
    }
    if (Array.isArray(grid.rowHeights)) for (let r = 0; r < nr; r++) h[r] = Math.max(h[r], num(grid.rowHeights[r], 0));
    const total = h.reduce((a, b) => a + b, 0), want = num(grid.height, 0);
    if (want > total && nr > 0) for (let r = 0; r < nr; r++) h[r] += (want - total) / nr;   // (a height set by hand: the rows stretched to fill it)
    const y = [0]; for (const v of h) y.push(y[y.length - 1] + v);

    const fills = [], lines = [], words = [];
    const box = (bx, by, bw, bh, fill) => ({ kind: "rect", id: o.id + ":box", x: o.x + bx, y: o.y + by, w: Math.max(0, bw), h: Math.max(0, bh), fill, stroke: null, width: 0, corners: [0] });
    const round = (r, b) => { if (k.corner <= 0 || (r > 0 && r < nr - 1)) return b; const top = r === 0 ? k.corner : 0, bottom = r === nr - 1 ? k.corner : 0; b.corners = [top, top, bottom, bottom]; return b; };
    if (seen(k.fill)) { const back = box(0, 0, x[nc], y[nr], k.fill); back.corners = [k.corner]; fills.push(back); }
    for (let r = 0; r < nr; r++)
    {
        const head = r < header, alt = !head && (r - header) % 2 === 1, row = head ? k.headerFill : alt ? k.altFill : null;
        if (seen(row)) fills.push(round(r, box(0, y[r], x[nc], h[r], row)));
        if (r < nr - 1 && k.lineWidth > 0 && seen(k.line))   // between rows (not through a merged cell)
            for (let c = 0; c < nc; c++) if (!owner[r][c] || owner[r][c] !== owner[r + 1][c]) lines.push(box(x[c], y[r + 1] - k.lineWidth / 2, w[c], k.lineWidth, k.line));
        if (k.columnLines && k.lineWidth > 0 && seen(k.line))   // between columns
            for (let c = 1; c < nc; c++) if (!owner[r][c] || owner[r][c] !== owner[r][c - 1]) lines.push(box(x[c] - k.lineWidth / 2, y[r], k.lineWidth, h[r], k.line));
    }
    for (const [at, t] of types)
    {
        const [r, c] = at.split(",").map(Number), cell = rows[r][c], cs = cellLook(cell, lib);
        const cw = x[Math.min(nc, c + cell.across)] - x[c], ch = y[Math.min(nr, r + cell.down)] - y[r];
        if (cs && cs.fill) { const f = colorOf(lib, cs.fill); if (seen(f)) fills.push(cell.across === nc ? round(r, box(x[c], y[r], cw, ch, f)) : box(x[c], y[r], cw, ch, f)); }
        if (cs && cs.lineBelow && typeof cs.lineBelow === "object") { const lw = num(cs.lineBelow.width, 1); lines.push(box(x[c], y[r] + ch - lw / 2, cw, lw, colorOf(lib, cs.lineBelow.color) || k.line)); }
        t.x = o.x + x[c] + k.pad[3] + (c === 0 ? k.inset[3] : 0); t.y = o.y + y[r] + k.pad[0] + (r === 0 ? k.inset[0] : 0);
        words.push(t);
        if (cs && typeof cs.marker === "string")   // a list's bullets: a dot, a dash or a tick where its first line starts
        {
            const ink = colorOf(lib, cs.markerColor) || t.fill, size = t.size, mid = t.y + (t.leading > 0 ? t.leading : size * 1.36) / 2;
            if (cs.marker === "dot") words.push({ kind: "oval", id: t.id + ":m", x: t.x + size * 0.02, y: mid - size * 0.16, w: size * 0.32, h: size * 0.32, fill: ink, stroke: null, width: 0 });
            else if (cs.marker === "dash") words.push({ kind: "rect", id: t.id + ":m", x: t.x, y: mid - size * 0.06, w: size * 0.5, h: size * 0.12, fill: ink, stroke: null, width: 0, corners: [0] });
            else
            {
                const tick = (ax, ay, bx, by) => words.push({ kind: "line", id: t.id + ":m", ax: t.x + ax * size, ay: mid + ay * size, bx: t.x + bx * size, by: mid + by * size, x: 0, y: 0, w: 0, h: 0, fill: null, stroke: ink, width: Math.max(0.5, size * 0.12), cap: 1 });
                tick(0, 0.02, 0.26, 0.26); tick(0.26, 0.26, 0.72, -0.26);
            }
        }
    }
    if (k.borderWidth > 0 && seen(k.border))
    {
        const b = k.borderWidth;
        if (k.corner > 0) lines.push({ kind: "rect", id: o.id + ":border", x: o.x + b / 2, y: o.y + b / 2, w: Math.max(0, x[nc] - b), h: Math.max(0, y[nr] - b), fill: null, stroke: k.border, width: b, corners: [Math.max(0, k.corner - b / 2)] });
        else { lines.push(box(0, -b / 2, x[nc], b, k.border)); lines.push(box(0, y[nr] - b / 2, x[nc], b, k.border)); lines.push(box(-b / 2, 0, b, y[nr], k.border)); lines.push(box(x[nc] - b / 2, 0, b, y[nr], k.border)); }
    }
    const parts = fills.concat(lines, words);
    made.set(o, { key, parts });
    return parts;
}
