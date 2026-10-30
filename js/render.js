// The canvas drawn in the browser, as the desktop app draws it: boards, pictures, drawings, shapes, lines, paths,
// type and lists, each turned, slanted, faded, blended and clipped as it is there. Close, not exact: type lays out
// with the browser's own shaping, and blurs and a path's dynamic corners are left out.

import { placed } from "./cnpy.js";

const T = 256;   // a drawing's tiles, in pixels

// ---- colours ----

function rgba(c, alpha)   // "#RRGGBB" or "#AARRGGBB" as CSS, its own alpha times "alpha"
{
    if (!c) return null;
    const h = c.replace("#", "");
    const a = h.length === 8 ? parseInt(h.slice(0, 2), 16) / 255 : 1, s = h.slice(-6);
    return "rgba(" + parseInt(s.slice(0, 2), 16) + "," + parseInt(s.slice(2, 4), 16) + "," + parseInt(s.slice(4, 6), 16) + "," + (a * (alpha === undefined ? 1 : alpha)) + ")";
}
function rgb(c) { const s = (c || "#000000").replace("#", "").slice(-6); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]; }
function hex(v) { return "#" + v.map(x => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join(""); }
export function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => Math.floor(v + (y[i] - v) * t + 0.5))); }
export function dark(c) { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000 <= 140; }
export function shade(c, t) { return mix(c, dark(c) ? "#ffffff" : "#000000", t); }
function toHsv([r, g, b])
{
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    const h = d === 0 ? 0 : max === r ? 60 * (((g - b) / d + 6) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
    return [h, max === 0 ? 0 : d / max, max];
}
function fromHsv(h, s, v)
{
    const c = v * s, x = c * (1 - Math.abs(h / 60 % 2 - 1)), m = v - c, k = Math.floor(h / 60) % 6;
    const [r, g, b] = k === 0 ? [c, x, 0] : k === 1 ? [x, c, 0] : k === 2 ? [0, c, x] : k === 3 ? [0, x, c] : k === 4 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function derived(fill, i)   // one colour of the set made from a list's colour (7 its headings, 10 its card, 11 its entries)
{
    const [h, s] = toHsv(rgb(fill)), k = Math.min(1, s / 0.5);
    const at = { 7: [0.32, 1.0], 10: [0.22, 0.22], 11: [0.22, 0.29] }[i];
    return hex(fromHsv(h, at[0] * k, at[1]));
}
// A list colour's stripe, as Board makes one from it (bright enough to read as the list's own).
export function bright(c)
{
    const [h, s, v] = toHsv(rgb(c)), sa = s < 0.15 ? s : Math.max(s, 0.6), va = Math.max(v, 0.82);
    return hex(fromHsv(h, sa * 0.82, va)).toUpperCase();
}
// A list's colours, as Board makes them from its own colour (or the theme's, with none).
export function listLook(list)
{
    const card = list.fill ? derived(list.fill, 10) : "#262927", tile = list.fill ? derived(list.fill, 11) : "#313534";
    const head = list.fill ? derived(list.fill, 7) : "#D2F6D1";
    return { card, tile, head, stripe: list.ink || "#DAFF00", ink: dark(tile) ? "#EAECEB" : "#151616", onCard: dark(card) ? "#EAECEB" : "#151616", box: mix(tile, head, 0.35) };
}

// ---- fonts: the two that come with the desktop app, fetched the first time a project uses them ----

const bundled = { "IBM Plex Sans": "IBMPlexSans", "Rubik": "Rubik" };
const weights = { 300: "Light", 400: "Regular", 500: "Medium", 600: "SemiBold", 700: "Bold", 800: "ExtraBold", 900: "Black" };
const fontsAsked = new Set();
function wantFont(family, weight, italic, redraw)
{
    const file = bundled[family];
    if (!file) return;
    let w = Object.keys(weights).map(Number).reduce((a, b) => Math.abs(b - weight) < Math.abs(a - weight) ? b : a, 400);
    if (family === "IBM Plex Sans" && (w < 400 || w > 700)) w = w < 400 ? 400 : 700;
    const name = weights[w] === "Regular" && italic ? "Italic" : weights[w] + (italic ? "Italic" : "");
    const key = file + "-" + (name === "Regular" ? "Regular" : name);
    if (fontsAsked.has(key)) return;
    fontsAsked.add(key);
    const face = new FontFace(family, "url(fonts/" + key + ".ttf)", { weight: String(w), style: italic ? "italic" : "normal" });
    face.load().then(f => { document.fonts.add(f); redraw(); }).catch(() => { });
}

// ---- pictures, read from the project file once each ----

export function pictures(doc, added, redraw)
{
    const seen = new Map();   // file name → ImageBitmap (or "loading")
    return function get(file)
    {
        const got = seen.get(file);
        if (got) return got === "loading" ? null : got;
        seen.set(file, "loading");
        const bytes = added && added.has(file) ? Promise.resolve(added.get(file)) : doc.zip.file(file) ? doc.zip.file(file).async("uint8array") : null;
        if (!bytes) { seen.set(file, "none"); return null; }
        bytes.then(b => createImageBitmap(new Blob([b]))).then(img => { seen.set(file, img); redraw(); }).catch(() => seen.set(file, "none"));
        return null;
    };
}
function tilesOf(doc, folder)   // a drawing's tiles: their places (column, row) and file names
{
    if (!doc._tiles) doc._tiles = new Map();
    if (doc._tiles.has(folder)) return doc._tiles.get(folder);
    const out = [];
    doc.zip.forEach((path, entry) =>
    {
        if (!path.startsWith(folder) || path.length <= folder.length || entry.dir) return;
        const at = path.substring(folder.length).replace(".png", "").replace(/−/g, "-").split("_");
        if (at.length === 2) out.push({ c: parseInt(at[0], 10), r: parseInt(at[1], 10), file: path });
    });
    doc._tiles.set(folder, out);
    return out;
}

// ---- what is drawn: the file's objects, the lists as they are here, and the photos added ----

export function scene(doc, view)
{
    const lists = new Map(view.lists.map(l => [l.id, l]));
    const items = doc.items.filter(o => !view.deleted.has(o.id) && !view.removed.has(o.id))
        .map(o => o.kind === "list" && lists.has(o.id) ? lists.get(o.id) : view.moved.has(o.id) ? placed(o, view.moved.get(o.id)) : o)
        .map(o => view.locks.has(o.id) ? { ...o, locked: view.locks.get(o.id) } : o);
    for (const l of view.lists) if (l.fresh) items.push(l);
    for (const p of view.photos) items.push({ kind: "image", locked: !!p.locked, id: p.id, file: p.file, x: p.x, y: p.y, w: p.w, h: p.h, cx: 0, cy: 0, cw: p.pw, ch: p.ph, opacity: 1, blend: "normal", angle: 0, shear: 0, group: p.layer ? p.layer.id : null, name: p.name });
    const masks = new Map();   // a clipped group's path → its mask (the topmost of it, marked as one)
    const top = new Map();
    for (const o of items) if (o.group) { const ids = o.group.split("/"); for (let k = 1; k <= ids.length; k++) top.set(ids.slice(0, k).join("/"), o); }
    for (const [g, o] of top) if (o.clip && o.group === g) masks.set(g, o);
    return { doc, items, masks, boards: doc.boards.concat(view.boards) };
}

function hidden(doc, o)
{
    if (o.hidden) return true;
    if (!o.group || doc.hides.size === 0) return false;
    return o.group.split("/").some(id => doc.hides.has(id));
}
function fade(doc, o) { let a = o.opacity === undefined ? 1 : o.opacity; if (o.group && doc.fades.size) for (const id of o.group.split("/")) if (doc.fades.has(id)) a *= doc.fades.get(id); return a; }

// Where an object is (its own box, before any turn), and its box on the canvas with any turn.
export function box(o, ctx)
{
    if (o.kind === "list") return { x: o.x, y: o.y, w: o.w, h: listLayout(o, ctx).h * o.scale };
    return { x: o.x, y: o.y, w: o.w, h: o.h };
}
export function outer(o, ctx)
{
    const b = box(o, ctx);
    if (!o.angle && !o.shear) return b;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, m = placing(o, b), pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
    void cx; void cy;
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}
function placing(o, b)   // slanted, then turned, about the box's middle
{
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    return new DOMMatrix().translate(cx, cy).rotate(o.angle || 0).multiply(new DOMMatrix([1, 0, -Math.tan((o.shear || 0) * Math.PI / 180), 1, 0, 0])).translate(-cx, -cy);
}

// Everything's extent; and one board's.
export function extent(sc, ctx)
{
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = b => { if (!(b.w >= 0) || !isFinite(b.x)) return; x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
    sc.items.forEach(o => { if (!hidden(sc.doc, o)) add(outer(o, ctx)); });
    sc.boards.forEach(add);
    return x0 === Infinity ? { x: 0, y: 0, w: 1000, h: 800 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// ---- drawing ----

// The scene onto ctx (a canvas "w" by "h" CSS pixels at "dpr"), the canvas at scale s, offset tx, ty.
export function draw(ctx, sc, cam, w, h, dpr, get, redraw, opts)
{
    opts = opts || {};
    const doc = sc.doc;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = opts.background || doc.canvas;
    ctx.fillRect(0, 0, w, h);
    const s = cam.s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * cam.tx, dpr * cam.ty);
    const view = { x: -cam.tx / s, y: -cam.ty / s, w: w / s, h: h / s };
    const meets = b => b.x <= view.x + view.w && b.x + b.w >= view.x && b.y <= view.y + view.h && b.y + b.h >= view.y;
    // Boards, under everything.
    const fill = doc.boardLook === 2 ? "#ffffff" : doc.boardColor ? rgba(doc.boardColor) : shade(doc.canvas, 0.07);
    for (const b of sc.boards)
    {
        if (!meets(b)) continue;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, doc.boardLook !== 0 ? 0 : Math.min(8 / s, b.w / 2, b.h / 2));
        if (doc.boardLook === 1) { ctx.strokeStyle = shade(doc.canvas, 0.3); ctx.lineWidth = 1 / s; ctx.stroke(); }
        else { ctx.fillStyle = fill; ctx.fill(); }
        if (opts.names !== false)
        {
            ctx.font = "500 " + 12 / s + "px 'IBM Plex Sans', system-ui, sans-serif";
            ctx.fillStyle = dark(doc.canvas) ? "rgba(234,236,235,.55)" : "rgba(21,22,22,.55)";
            ctx.textBaseline = "bottom";
            ctx.fillText(b.name, b.x, b.y - 6 / s);
        }
    }
    for (const o of sc.items)
    {
        if (hidden(doc, o) || (o.clip && sc.masks.get(o.group) === o)) continue;
        if (!meets(outer(o, ctx))) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, fade(doc, o)));
        ctx.globalCompositeOperation = o.blend && o.blend !== "normal" ? o.blend : "source-over";
        // Clipped by the mask of any group it is in.
        if (o.group && sc.masks.size)
        {
            const ids = o.group.split("/");
            for (let k = 1; k <= ids.length; k++) { const m = sc.masks.get(ids.slice(0, k).join("/")); if (m && m !== o) { const p = outline(m); if (p) ctx.clip(p); } }
        }
        try { drawOne(ctx, o, doc, s, get, redraw); } catch (e) { }
        ctx.restore();
    }
}

function turn(ctx, o, b) { if (o.angle || o.shear) { const m = placing(o, b); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); } }
function flip(ctx, o, b)
{
    if (!o.flipX && !o.flipY) return;
    ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
    ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
    ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
}

// A shape's or path's outline on the canvas (its turn included), for a mask; null for what can't be one.
function outline(o)
{
    const p = new Path2D(), b = box(o);
    let own = null;
    if (o.kind === "rect") { own = new Path2D(); own.roundRect(b.x, b.y, b.w, b.h, radii(o)); }
    else if (o.kind === "oval") { own = new Path2D(); own.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.abs(b.w / 2), Math.abs(b.h / 2), 0, 0, Math.PI * 2); }
    else if (o.kind === "path") own = pathOf(o);
    if (!own) return null;
    p.addPath(own, o.angle || o.shear ? placing(o, b) : undefined);
    return p;
}
function radii(o) { const c = o.corners || [0]; const lim = Math.min(Math.abs(o.w), Math.abs(o.h)) / 2; return (c.length >= 4 ? c.slice(0, 4) : [c[0]]).map(v => Math.max(0, Math.min(lim, v))); }
function pathOf(o)
{
    if (!o._path)
    {
        const own = new Path2D(o.d || "");
        const sx = o.bw > 0 ? o.w / o.bw : 1, sy = o.bh > 0 ? o.h / o.bh : 1;
        o._path = new Path2D();
        o._path.addPath(own, new DOMMatrix([sx, 0, 0, sy, o.x - o.bx * sx, o.y - o.by * sy]));
    }
    return o._path;
}

// A fill: a colour, or the gradient its text describes, across its box at its angle.
function paint(ctx, o, b)
{
    if (o.grad)
    {
        const f = o.grad.split(" "), stops = [];
        let steps = 0;
        for (const s of f.slice(2)) { if (s.startsWith("steps=")) { steps = parseInt(s.slice(6), 10) || 0; continue; } const i = s.indexOf(":"); stops.push([parseFloat(s.slice(0, i)), s.slice(i + 1)]); }
        if (stops.length >= 2)
        {
            stops.sort((p, q) => p[0] - q[0]);
            let g;
            const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
            if (f[0] === "radial") g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.hypot(b.w, b.h) / 2);
            else
            {
                const a = parseFloat(f[1]) * Math.PI / 180, dx = Math.cos(a), dy = Math.sin(a), half = (Math.abs(b.w * dx) + Math.abs(b.h * dy)) / 2;
                g = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
            }
            const at = t => { for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) { const [a0, c0] = stops[i - 1], [a1, c1] = stops[i], u = a1 > a0 ? (t - a0) / (a1 - a0) : 0; return mixA(c0, c1, u); } return stops[stops.length - 1][1]; };
            if (steps >= 2) for (let j = 0; j < steps; j++) { const c = rgba(at(j / (steps - 1))); g.addColorStop(j / steps, c); g.addColorStop((j + 1) / steps, c); }
            else for (const [t, c] of stops) g.addColorStop(Math.max(0, Math.min(1, t)), rgba(c));
            return g;
        }
    }
    return rgba(o.fill);
}
function mixA(a, b, t)   // two "#AARRGGBB" colours mixed
{
    const p = s => { const h = s.replace("#", ""); return h.length === 8 ? [0, 2, 4, 6].map(i => parseInt(h.slice(i, i + 2), 16)) : [255, ...[0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))]; };
    const x = p(a), y = p(b);
    return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

function stroke(ctx, o, path, s)
{
    if (!o.stroke || !(o.width > 0)) return;
    ctx.strokeStyle = rgba(o.stroke);
    ctx.lineWidth = o.width;
    ctx.lineCap = ["butt", "round", "square"][Math.max(0, o.cap)] || "butt";
    ctx.lineJoin = ["miter", "round", "bevel"][Math.max(0, o.join)] || "miter";
    if (o.dash) ctx.setLineDash(o.dash.split(",").map(v => parseFloat(v) * o.width).filter(v => v > 0));
    if (o.place && path)
    {
        // Inside or outside its edge: twice as wide, the other half cut away.
        ctx.save();
        ctx.lineWidth = o.width * 2;
        if (o.place < 0) { ctx.clip(path); ctx.stroke(path); }
        else { const out = new Path2D(); out.rect(-1e7, -1e7, 2e7, 2e7); out.addPath(path); ctx.clip(out, "evenodd"); ctx.stroke(path); }
        ctx.restore();
    }
    else if (path) ctx.stroke(path); else ctx.stroke();
    ctx.setLineDash([]);
    void s;
}

function drawOne(ctx, o, doc, s, get, redraw)
{
    const b = box(o, ctx);
    turn(ctx, o, b);
    switch (o.kind)
    {
        case "image":
        {
            const img = get(o.file);
            if (!img) { ctx.fillStyle = "rgba(128,128,128,.18)"; ctx.fillRect(b.x, b.y, b.w, b.h); return; }
            flip(ctx, o, b);
            ctx.imageSmoothingQuality = "high";
            const cw = o.cw > 0 ? o.cw : img.width, ch = o.ch > 0 ? o.ch : img.height;
            ctx.drawImage(img, o.cx, o.cy, cw, ch, b.x, b.y, b.w, b.h);
            return;
        }
        case "paint":
        {
            const tiles = tilesOf(doc, o.file);
            if (tiles.length === 0) return;
            let a = o.frame && o.frame.w > 0 ? o.frame : null;
            if (!a)
            {
                // (an older file: what its tiles cover)
                const cs = tiles.map(t => t.c), rs = tiles.map(t => t.r);
                a = { x: Math.min(...cs) * T, y: Math.min(...rs) * T, w: (Math.max(...cs) - Math.min(...cs) + 1) * T, h: (Math.max(...rs) - Math.min(...rs) + 1) * T };
            }
            if (!(b.w > 0) || !(b.h > 0)) return;
            const sx = b.w / a.w, sy = b.h / a.h;
            ctx.transform(sx, 0, 0, sy, b.x - a.x * sx, b.y - a.y * sy);
            for (const t of tiles) { const img = get(t.file); if (img) ctx.drawImage(img, t.c * T, t.r * T); }
            return;
        }
        case "rect": case "oval":
        {
            const p = new Path2D();
            if (o.kind === "rect") p.roundRect(b.x, b.y, b.w, b.h, radii(o));
            else p.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.abs(b.w / 2), Math.abs(b.h / 2), 0, 0, Math.PI * 2);
            flip(ctx, o, b);
            const f = paint(ctx, o, b);
            if (f) { ctx.fillStyle = f; ctx.fill(p); }
            stroke(ctx, o, p, s);
            return;
        }
        case "line": case "arrow":
        {
            const p = new Path2D();
            p.moveTo(o.ax, o.ay); p.lineTo(o.bx, o.by);
            const c = { ...o, stroke: o.stroke || o.fill, place: 0 };
            stroke(ctx, c, p, s);
            if (o.kind === "arrow" || o.arrowhead)
            {
                // Its head: a filled point at the end.
                const ang = Math.atan2(o.by - o.ay, o.bx - o.ax), len = Math.max(8, c.width * 4) * (o.head || 1), wid = len * 0.6;
                ctx.beginPath();
                ctx.moveTo(o.bx, o.by);
                ctx.lineTo(o.bx - Math.cos(ang) * len + Math.sin(ang) * wid, o.by - Math.sin(ang) * len - Math.cos(ang) * wid);
                ctx.lineTo(o.bx - Math.cos(ang) * len - Math.sin(ang) * wid, o.by - Math.sin(ang) * len + Math.cos(ang) * wid);
                ctx.closePath();
                ctx.fillStyle = rgba(c.stroke);
                ctx.fill();
            }
            return;
        }
        case "path":
        {
            const p = pathOf(o);
            const f = paint(ctx, o, b);
            if (f) { ctx.fillStyle = f; ctx.fill(p); }
            stroke(ctx, o, p, s);
            return;
        }
        case "type": drawType(ctx, o, b, redraw); return;
        case "list": drawList(ctx, o); return;
    }
}

// ---- type ----

function cased(t, c) { return c === 1 ? t.toUpperCase() : c === 2 ? t.toLowerCase() : c === 3 ? t.replace(/\b\p{L}/gu, x => x.toUpperCase()) : t; }
export function wrap(ctx, text, width)
{
    const out = [];
    for (const para of text.split("\n"))
    {
        if (!(width > 0)) { out.push(para); continue; }
        let line = "";
        for (const word of para.split(/(\s+)/))
        {
            const next = line + word;
            if (line !== "" && ctx.measureText(next.trimEnd()).width > width && word.trim() !== "") { out.push(line.trimEnd()); line = word.trimStart(); }
            else line = next;
        }
        out.push(line);
    }
    return out;
}
function drawType(ctx, o, b, redraw)
{
    wantFont(o.font, o.weight, o.italic, redraw);
    ctx.font = (o.italic ? "italic " : "") + o.weight + " " + o.size + "px \"" + o.font + "\", system-ui, sans-serif";
    if ("letterSpacing" in ctx) ctx.letterSpacing = (o.tracking / 1000 * o.size) + "px";
    const hs = o.hscale || 1;
    const lines = wrap(ctx, cased(o.text, o.textCase), o.fixed ? b.w / hs : 0);
    const m = ctx.measureText("Hg");
    const asc = m.fontBoundingBoxAscent || o.size * 0.92, desc = m.fontBoundingBoxDescent || o.size * 0.24;
    const lh = o.leading > 0 ? o.leading : o.leading < 0 ? -o.leading * o.size : asc + desc;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.scale(hs, 1);
    if (o.tall) { ctx.beginPath(); ctx.rect(0, 0, b.w / hs, b.h); ctx.clip(); }
    const f = paint(ctx, o, { x: 0, y: 0, w: b.w / hs, h: b.h });
    ctx.textBaseline = "alphabetic";
    lines.forEach((line, i) =>
    {
        const wl = ctx.measureText(line).width, room = b.w / hs;
        const x = o.align === 1 ? (room - wl) / 2 : o.align === 2 ? room - wl : 0;
        const y = asc + i * lh;
        if (f) { ctx.fillStyle = f; ctx.fillText(line, x, y); }
        if (o.stroke && o.width > 0) { ctx.strokeStyle = rgba(o.stroke); ctx.lineWidth = o.width; ctx.lineJoin = "round"; ctx.strokeText(line, x, y); }
    });
    ctx.restore();
    if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

// ---- lists, as cards (the same numbers as the desktop app's, in the list's own units) ----

const NOTE = "system-ui, -apple-system, 'Segoe UI', sans-serif";
let measurer = null;
function measureCtx(ctx) { if (ctx) return ctx; if (!measurer) measurer = document.createElement("canvas").getContext("2d"); return measurer; }
export function listLayout(o, ctx)
{
    const key = o.w + "|" + o.name + "|" + o.showDone + "|" + o.rows.map(r => r.kind + r.done + r.text + (r.link ? 1 : 0)).join("\u0001");
    if (o._layout && o._layout.key === key) return o._layout;
    const c = measureCtx(ctx);
    const w = o.w / o.scale;
    c.save();
    c.font = "700 20px " + NOTE;
    const title = wrap(c, o.name || "", w - 40);
    let y = 42 + title.length * 25 + 16;
    const entries = [];
    for (const r of o.rows)
    {
        if (r.done && !o.showDone) continue;
        let h = 22, lines = [];
        if (r.kind !== "D")
        {
            const head = r.kind === "H";
            c.font = (head ? "700 17px " : "400 15px ") + NOTE;
            const left = r.kind === "T" ? 46 : head ? 4 : 16, right = r.link ? 38 : 14;
            lines = wrap(c, plainWords(r.text), w - 40 - left - right);
            const th = lines.length * (head ? 22 : 20);
            h = head ? Math.max(30, th + 10) : Math.max(44, th + 26);
        }
        entries.push({ r, y, h, lines });
        y += h + 10;
    }
    c.restore();
    o._layout = { key, title, entries, h: y + 10 };
    return o._layout;
}
function plainWords(t) { return (t || "").replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, "$1").replace(/\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*/g, "$1"); }
function drawList(ctx, o)
{
    const L = listLayout(o, ctx), look = listLook(o), w = o.w / o.scale;
    ctx.translate(o.x, o.y);
    ctx.scale(o.scale, o.scale);
    ctx.fillStyle = look.card;
    ctx.beginPath(); ctx.roundRect(0, 0, w, L.h, 6); ctx.fill();
    ctx.fillStyle = rgba(look.stripe);
    ctx.beginPath(); ctx.roundRect(20, 20, Math.max(0, w - 40), 8, 2); ctx.fill();
    ctx.fillStyle = look.onCard;
    ctx.font = "700 20px " + NOTE;
    ctx.textBaseline = "top";
    L.title.forEach((t, i) => ctx.fillText(t, 20, 42 + i * 25));
    for (const e of L.entries)
    {
        const r = e.r;
        if (r.kind === "D") { ctx.fillStyle = shade(look.tile, 0.14); ctx.beginPath(); ctx.roundRect(20 + (w - 40) * 0.25, e.y + e.h / 2 - 2, (w - 40) * 0.5, 4, 2); ctx.fill(); continue; }
        ctx.save();
        if (r.done) ctx.globalAlpha *= 0.5;
        if (r.kind !== "H") { ctx.fillStyle = look.tile; ctx.beginPath(); ctx.roundRect(20, e.y, w - 40, e.h, 4); ctx.fill(); }
        if (r.kind === "T")
        {
            const ink = r.color ? rgba(r.color) : look.box, bx = 36, by = e.y + e.h / 2 - 8;
            ctx.lineWidth = 1.6; ctx.strokeStyle = ink;
            ctx.beginPath(); ctx.roundRect(bx, by, 16, 16, 2);
            if (r.done) { ctx.fillStyle = ink; ctx.fill(); ctx.strokeStyle = ink; ctx.stroke(); ctx.strokeStyle = dark(r.color || look.box) ? "#fff" : "#000"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(bx + 3.8, by + 8.4); ctx.lineTo(bx + 6.8, by + 11.4); ctx.lineTo(bx + 12.2, by + 5); ctx.stroke(); }
            else ctx.stroke();
        }
        const head = r.kind === "H", left = r.kind === "T" ? 46 : head ? 4 : 16, lh = head ? 22 : 20;
        ctx.fillStyle = head ? look.onCard : look.ink;
        ctx.font = (head ? "700 17px " : "400 15px ") + NOTE;
        ctx.textBaseline = "middle";
        const top = e.y + (e.h - e.lines.length * lh) / 2;
        e.lines.forEach((t, i) =>
        {
            const x = 20 + left, y = top + lh * (i + 0.5);
            ctx.fillText(t, x, y);
            if (r.done) { const tw = ctx.measureText(t).width; ctx.fillRect(x, y, tw, 1.2); }
        });
        ctx.restore();
    }
}

// The object at a point on the canvas (topmost first, as drawn; hidden ones passed over), or null. "slack": how near
// counts, in canvas units (a finger is not a pointer).
export function objectAt(sc, x, y, slack)
{
    for (let i = sc.items.length - 1; i >= 0; i--)
    {
        const o = sc.items[i];
        if (hidden(sc.doc, o) || (o.clip && sc.masks.get(o.group) === o)) continue;
        if (o.kind === "line" || o.kind === "arrow")
        {
            const dx = o.bx - o.ax, dy = o.by - o.ay, len = dx * dx + dy * dy, t = len ? Math.max(0, Math.min(1, ((x - o.ax) * dx + (y - o.ay) * dy) / len)) : 0;
            if (Math.hypot(x - o.ax - dx * t, y - o.ay - dy * t) <= slack + (o.width || 0)) return o;
            continue;
        }
        const b = box(o);
        let p = { x, y };
        if (o.angle || o.shear) { const q = placing(o, b).inverse().transformPoint(new DOMPoint(x, y)); p = { x: q.x, y: q.y }; }
        if (p.x >= b.x - slack && p.x <= b.x + b.w + slack && p.y >= b.y - slack && p.y <= b.y + b.h + slack) return o;
    }
    return null;
}

// The list (if any) at a point on the canvas, topmost first.
export function listAt(sc, x, y, ctx)
{
    for (let i = sc.items.length - 1; i >= 0; i--)
    {
        const o = sc.items[i];
        if (o.kind !== "list" || hidden(sc.doc, o)) continue;
        const b = box(o, ctx);
        if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return o;
    }
    return null;
}
// What an entry's link goes to, on the canvas: a board, or an object (with the group it is in, past its layer).
export function linked(sc, id, ctx)
{
    const b = sc.boards.find(o => o.id === id);
    if (b) return { board: b, area: b };
    const o = sc.items.find(x => x.id === id);
    if (!o) return null;
    let group = null;
    if (o.group) { const ids = o.group.split("/"); const k = sc.doc.folders.has(ids[0]) ? 1 : 0; if (ids.length > k) group = ids.slice(0, k + 1).join("/"); }
    const with_ = group ? sc.items.filter(x => x.group && (x.group === group || x.group.startsWith(group + "/"))) : [o];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const x of with_) { const q = outer(x, ctx); x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x + q.w); y1 = Math.max(y1, q.y + q.h); }
    return { item: o, area: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}
