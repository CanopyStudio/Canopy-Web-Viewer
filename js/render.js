// The canvas drawn in the browser, as the desktop app draws it: boards, pictures, drawings, shapes, lines, paths,
// type and lists, each turned, slanted, faded, blended and clipped as it is there. Close, not exact: type lays out
// with the browser's own shaping, and blurs and a path's dynamic corners are left out.

import { placed } from "./cnpy.js";

const T = 256;   // a drawing's tiles, in pixels

// ---- colors ----

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
function derived(fill, i)   // one color of the set made from a list's color (7 its headings, 10 its card, 11 its entries)
{
    const [h, s] = toHsv(rgb(fill)), k = Math.min(1, s / 0.5);
    const at = { 7: [0.32, 1.0], 10: [0.22, 0.22], 11: [0.22, 0.29] }[i];
    return hex(fromHsv(h, at[0] * k, at[1]));
}
// A list color's stripe, as Board makes one from it (bright enough to read as the list's own).
export function bright(c)
{
    const [h, s, v] = toHsv(rgb(c)), sa = s < 0.15 ? s : Math.max(s, 0.6), va = Math.max(v, 0.82);
    return hex(fromHsv(h, sa * 0.82, va)).toUpperCase();
}
// A list's colors, as Board makes them from its own color (or the theme's, with none).
// The theme on show (one of Canopy Board's: its colors by their names there), for lists without a color of their own.
let look = { Note: "#262927", "Note row": "#313534", Heading: "#D2F6D1", Ink: "#EAECEB" };
export function setTheme(colors) { look = colors; }
export function listLook(list)
{
    const card = list.fill ? derived(list.fill, 10) : look.Note, tile = list.fill ? derived(list.fill, 11) : look["Note row"];
    const head = list.fill ? derived(list.fill, 7) : look.Heading;
    return { card, tile, head, stripe: list.ink || "#DAFF00", ink: dark(tile) ? look.Ink : "#151616", onCard: dark(card) ? look.Ink : "#151616", box: mix(tile, head, 0.35) };
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

// Pictures, read from the file as they come into view. Each is decoded only as big as it is shown (a little bigger, in
// steps, so it isn't decoded again for every zoom), and again bigger only when zoomed in further; at most a few at once;
// and the ones not shown lately let go once they add up to too much. So a board of big photos fits in a phone's memory.
// "cache": one per project, kept as the file is saved and read again (its pictures don't change).
// Two sizes of each picture: a small one (at most SMALL across), for whenever it is shown no bigger than that, from
// the preview Canopy Board saves in the file, else the copy kept on this phone, else made once from the original;
// and the original itself (at most BIG across), only when it is looked at closely. So the big originals, slow to
// decode, are decoded once, not again at each step of a zoom, and not at all on a phone that has seen them before.
const BUDGET = 48e6, SMALL = 1024, BIG = 2048;
// What the pictures and drawing are costing, for the measuring readout (?measure on the address).
export const stats = { draws: [], decoded: 0, decodeMs: [], dropped: 0, failed: 0, widest: 0, previews: 0, kept: 0, made: 0, missing: 0, gaps: 0, retried: 0 };
export function cache() { return { seen: new Map(), busy: 0, queue: [], pixels: 0, frame: 0 }; }
export function forget(c) { if (!c) return; for (const e of c.seen.values()) { if (e.img) e.img.close(); e.img = null; e.closed = true; } c.seen.clear(); c.pixels = 0; c.queue.length = 0; }
export function pictures(doc, added, redraw, c)
{
    c = c || cache();
    const bytesOf = file => added && added.has(file) ? Promise.resolve(added.get(file)) : doc.zip.file(file) ? doc.zip.file(file).async("uint8array") : null;
    const next = () =>
    {
        while (c.busy < 2 && c.queue.length)
        {
            const job = c.queue.shift(), e = c.seen.get(job.file);
            if (!e || e.closed) continue;
            const bytes = bytesOf(job.file);
            if (!bytes) { e.none = true; stats.missing++; continue; }   // (not in the file at all)
            c.busy++;
            const t0 = performance.now();
            (job.side <= SMALL ? small(job.file, bytes) : bytes.then(b => decode(b, job.side))).then(got =>
            {
                if (e.closed) { got.img.close(); return; }   // (let go meanwhile)
                if (e.img) { c.pixels -= e.img.width * e.img.height; e.img.close(); }
                e.img = got.img; e.k = got.k; e.side = job.side; e.full = got.full; e.src = got.src;
                c.pixels += got.img.width * got.img.height;
                stats.decoded++; stats.decodeMs.push(performance.now() - t0); if (stats.decodeMs.length > 30) stats.decodeMs.shift(); stats.widest = Math.max(stats.widest, got.img.width, got.img.height);
                trim(c);
                redraw();
            }).catch(() =>
            {
                // Couldn't be decoded (short of memory, say): tried again as it is drawn again, smaller if it was the
                // original that failed; given up on only after a few tries.
                e.fails = (e.fails || 0) + 1;
                if (job.side > SMALL) e.noBig = true;
                if (e.fails >= 4) { e.none = true; stats.failed++; } else stats.retried++;
            }).finally(() => { e.wanted = 0; c.busy--; next(); });
        }
    };
    // "want": how many pixels across it is drawn (its longer side), or none for its own size.
    function get(file, want)
    {
        let e = c.seen.get(file);
        if (!e) { e = { img: null, k: 1, side: 0, wanted: 0, frame: 0 }; c.seen.set(file, e); }
        if (e.none) return null;
        e.frame = c.frame; e.at = performance.now();
        // (the original only once it is shown well over the small one's size: a picture a little bigger than that
        // looks the same from the small one, and the originals are what fill a phone's memory)
        const side = want ? (want <= SMALL * 1.5 || e.noBig ? SMALL : BIG) : 1e9;
        if (side > e.side && !e.full && side > e.wanted) { e.wanted = side; c.queue.push({ file, side }); next(); }
        return e.img ? e : null;
    }
    get.begin = () => { c.frame++; };   // (a drawing starting: what it asks for is what is on show)
    // The small one: Board's preview in the file, else this phone's copy, else made from the original (and kept).
    async function small(file, bytes)
    {
        const pre = doc.zip.file("previews/" + file + ".webp"), size = pre ? (await previewSizes(doc)).get(file) : null;
        if (pre && size) { const img = await createImageBitmap(new Blob([await pre.async("uint8array")], { type: "image/webp" })); stats.previews++; return { img, k: img.width / size.w, full: false, src: size }; }
        const keptCopy = await kept(file);
        if (keptCopy) { const img = await createImageBitmap(keptCopy.blob); stats.kept++; return { img, k: img.width / keptCopy.w, full: false, src: { w: keptCopy.w, h: keptCopy.h } }; }
        const got = await decode(await bytes, SMALL);
        if (!got.full) { stats.made++; keep(file, got.img, got.src); }
        return got;
    }
    return get;
}
// The sizes of the originals Board's previews are of ("previews/sizes.txt": a line each, "file width height").
function previewSizes(doc)
{
    if (doc._previewSizes) return doc._previewSizes;
    const f = doc.zip.file("previews/sizes.txt");
    doc._previewSizes = (f ? f.async("string") : Promise.resolve("")).then(t =>
    {
        const m = new Map();
        for (const line of t.split("\n")) { const p = line.trim().split(" "); if (p.length === 3) m.set(p[0], { w: +p[1], h: +p[2] }); }
        return m;
    });
    return doc._previewSizes;
}

// ---- the small copies kept on this phone (its own storage: a picture in a project never changes under its name,
// so a copy made once stays right) ----
let store = null;
function copies() { return store || (store = new Promise((ok, no) => { const r = indexedDB.open("canopy-small", 1); r.onupgradeneeded = () => r.result.createObjectStore("small"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); })); }
async function kept(file)
{
    try { const db = await copies(); return await new Promise(ok => { const r = db.transaction("small").objectStore("small").get(file); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); }
    catch (e) { return null; }
}
async function keep(file, img, src)
{
    try
    {
        const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height;
        cv.getContext("2d").drawImage(img, 0, 0);
        let blob = await new Promise(ok => cv.toBlob(ok, "image/webp", 0.86));   // (WebP keeps see-through parts; a phone that can't make one makes a PNG)
        if (!blob) blob = await new Promise(ok => cv.toBlob(ok, "image/png"));
        cv.width = cv.height = 0;
        if (!blob) return;
        const db = await copies();
        db.transaction("small", "readwrite").objectStore("small").put({ blob, w: src.w, h: src.h }, file);
    }
    catch (e) { }
}
// Let go of pictures not on show (not drawn the last time the view was drawn), the longest unseen first, until they
// fit the budget again. (Never one on show, however long the view has stood still.)
function trim(c)
{
    if (c.pixels <= BUDGET) return;
    // (not drawn in the latest drawing, nor in the last few seconds: the canvas, a board open over it and the boards'
    // pictures each draw, and what one of them shows is not to be let go because another just drew without it)
    const now = performance.now();
    const old = [...c.seen.entries()].filter(([, e]) => e.img && e.frame < c.frame && now - (e.at || 0) > 3000).sort((a, b) => a[1].at - b[1].at);
    for (const [file, e] of old)
    {
        if (c.pixels <= BUDGET * 0.8) break;
        c.pixels -= e.img.width * e.img.height; e.img.close(); e.img = null; e.closed = true; c.seen.delete(file); stats.dropped++;
    }
}
// A picture decoded no bigger than "side" across; with how much smaller than itself it is ("k") and whether it is whole.
async function decode(bytes, side)
{
    const blob = new Blob([bytes]), size = sizeOf(bytes);
    if (size && Math.max(size.w, size.h) > side)
    {
        const k = side / Math.max(size.w, size.h), w = Math.max(1, Math.round(size.w * k)), h = Math.max(1, Math.round(size.h * k));
        let img;
        try { img = await createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" }); }
        catch (e) { img = await createImageBitmap(blob); }   // (a browser that won't decode it smaller: whole, then made smaller here)
        if (img.width > w * 1.5)
        {
            const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(img, 0, 0, w, h); img.close();
            img = await createImageBitmap(cv); cv.width = cv.height = 0;
        }
        return { img, k: img.width / size.w, full: false, src: size };
    }
    const img = await createImageBitmap(blob);
    return { img, k: 1, full: true, src: { w: img.width, h: img.height } };
}
// A PNG's, JPEG's, GIF's or WebP's size from its first bytes, or null.
function sizeOf(b)
{
    const u32 = i => (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0, u16 = i => b[i] << 8 | b[i + 1];
    if (b[0] === 0x89 && b[1] === 0x50) return { w: u32(16), h: u32(20) };
    if (b[0] === 0x47 && b[1] === 0x49) return { w: b[6] | b[7] << 8, h: b[8] | b[9] << 8 };
    if (b[0] === 0x52 && b[8] === 0x57 && b[12] === 0x56 && b[13] === 0x50)
    {
        if (b[15] === 0x20) return { w: (b[26] | b[27] << 8) & 0x3fff, h: (b[28] | b[29] << 8) & 0x3fff };
        if (b[15] === 0x4C) return { w: 1 + ((b[22] << 8 | b[21]) & 0x3fff), h: 1 + ((b[24] & 0xf) << 10 | b[23] << 2 | (b[22] & 0xc0) >> 6) };
        if (b[15] === 0x58) return { w: 1 + (b[24] | b[25] << 8 | b[26] << 16), h: 1 + (b[27] | b[28] << 8 | b[29] << 16) };
    }
    if (b[0] === 0xFF && b[1] === 0xD8)
    {
        let i = 2;
        while (i + 9 < b.length)
        {
            if (b[i] !== 0xFF) { i++; continue; }
            const m = b[i + 1];
            if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { w: u16(i + 7), h: u16(i + 5) };
            if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }
            i += 2 + u16(i + 2);
        }
    }
    return null;
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
    for (const r of view.restored) items.push(r.by ? placed(r.item, r.by) : r.item);
    for (const p of view.photos) items.push({ kind: "image", locked: !!p.locked, id: p.id, file: p.file, x: p.x, y: p.y, w: p.w, h: p.h, cx: 0, cy: 0, cw: p.pw, ch: p.ph, opacity: 1, blend: "normal", angle: 0, shear: 0, group: p.layer ? p.layer.id : null, name: p.name });
    const masks = new Map();   // a clipped group's path → its mask (the topmost of it, marked as one)
    const top = new Map();
    for (const o of items) if (o.group) { const ids = o.group.split("/"); for (let k = 1; k <= ids.length; k++) top.set(ids.slice(0, k).join("/"), o); }
    for (const [g, o] of top) if (o.clip && o.group === g) masks.set(g, o);
    return { doc, items, masks, boards: doc.boards.filter(b => !view.goneBoards.has(b.id)).concat(view.boards) };
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
let smooth = "high";
export function draw(ctx, sc, cam, w, h, dpr, get, redraw, opts)
{
    opts = opts || {};
    if (get.begin) get.begin();
    stats.gaps = 0;
    smooth = opts.fast ? "low" : "high";   // (moving: drawn quickly; still: drawn well)
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
        const sx = o.bw > 0 ? o.w / o.bw : 1, sy = o.bh > 0 ? o.h / o.bh : 1;
        if (o.dynamic) o._path = rounded(o.d, o.dynamic, p => ({ x: o.x + (p.x - o.bx) * sx, y: o.y + (p.y - o.by) * sy }), (sx + sy) / 2);
        else
        {
            const own = new Path2D(o.d || "");
            o._path = new Path2D();
            o._path.addPath(own, new DOMMatrix([sx, 0, 0, sy, o.x - o.bx * sx, o.y - o.by * sy]));
        }
    }
    return o._path;
}

// ---- dynamic corners: a path's corners rounded where it says ("piece.point=radius;..."), on the canvas, as the
// desktop app rounds them (so they stay circular however the path is stretched) ----

const far = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mixP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const same = (a, b) => a.x === b.x && a.y === b.y;

// The path's outline read into pieces of points, each with its handles ("in" and "out"; at the point for none).
function pieces(d)
{
    const all = [], nums = s => (s.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
    let piece = null, at = { x: 0, y: 0 }, start = at;
    const add = p => { const n = { p, in: p, out: p, corner: 0 }; piece.nodes.push(n); return n; };
    for (const [, cmd, args] of (d || "").matchAll(/([MLHVCSQTZmlhvcsqtz])([^MLHVCSQTZmlhvcsqtz]*)/g))
    {
        const v = nums(args), rel = cmd === cmd.toLowerCase() && cmd !== "z" && cmd !== "Z", C = cmd.toUpperCase();
        const P = (x, y) => rel ? { x: at.x + x, y: at.y + y } : { x, y };
        if (C === "M") { piece = { nodes: [], closed: false }; all.push(piece); at = P(v[0], v[1]); start = at; add(at); for (let i = 2; i + 1 < v.length; i += 2) { at = P(v[i], v[i + 1]); add(at); } }
        else if (!piece) continue;
        else if (C === "L") for (let i = 0; i + 1 < v.length; i += 2) { at = P(v[i], v[i + 1]); add(at); }
        else if (C === "H") for (const x of v) { at = { x: rel ? at.x + x : x, y: at.y }; add(at); }
        else if (C === "V") for (const y of v) { at = { x: at.x, y: rel ? at.y + y : y }; add(at); }
        else if (C === "C") for (let i = 0; i + 5 < v.length; i += 6) { const last = piece.nodes[piece.nodes.length - 1]; last.out = P(v[i], v[i + 1]); const c2 = P(v[i + 2], v[i + 3]); at = P(v[i + 4], v[i + 5]); add(at).in = c2; }
        else if (C === "Q") for (let i = 0; i + 3 < v.length; i += 4) { const last = piece.nodes[piece.nodes.length - 1], m = P(v[i], v[i + 1]), b = P(v[i + 2], v[i + 3]); last.out = mixP(last.p, m, 2 / 3); add(b).in = mixP(b, m, 2 / 3); at = b; }
        else if (C === "Z")
        {
            piece.closed = true;
            const first = piece.nodes[0], end = piece.nodes[piece.nodes.length - 1];
            if (piece.nodes.length > 1 && far(end.p, first.p) < 0.001) { first.in = end.in; piece.nodes.pop(); }
            at = start;
        }
    }
    return all.filter(x => x.nodes.length);
}
function leave(p, ...toward) { for (const t of toward) { const l = far(t, p); if (l > 1e-6) return { x: (t.x - p.x) / l, y: (t.y - p.y) / l }; } return null; }
function corner(pc, i)   // a point's sides' directions and lengths, if it can be rounded
{
    const ns = pc.nodes, n = ns.length;
    if (n < 2 || (!pc.closed && (i === 0 || i === n - 1)) || (!pc.closed && n < 3)) return null;
    const a = ns[(i + n - 1) % n], p = ns[i], b = ns[(i + 1) % n];
    const u = leave(p.p, p.in, a.out, a.p), v = leave(p.p, p.out, b.in, b.p), lu = far(a.p, p.p), lv = far(b.p, p.p);
    if (!u || !v || lu < 0.001 || lv < 0.001) return null;
    const cos = u.x * v.x + u.y * v.y;
    return cos > -0.9998 && cos < 0.9998 ? { cos, lu, lv } : null;
}
function want(pc, i, r) { const k = r > 0 && corner(pc, i); return k ? r / Math.tan(Math.acos(Math.max(-1, Math.min(1, k.cos))) / 2) : 0; }
function fitCorner(pc, i, r)   // how far from the point its curve starts, its sides shared with the corners at their other ends
{
    const k = corner(pc, i);
    if (!k) return 0;
    const n = pc.nodes.length, d = r / Math.tan(Math.acos(Math.max(-1, Math.min(1, k.cos))) / 2);
    const wb = want(pc, (i + n - 1) % n, pc.nodes[(i + n - 1) % n].corner), wa = want(pc, (i + 1) % n, pc.nodes[(i + 1) % n].corner);
    return Math.min(d, d + wb <= k.lu ? d : k.lu * d / (d + wb), d + wa <= k.lv ? d : k.lv * d / (d + wa));
}
const curveOf = (pc, i) => { const a = pc.nodes[i], b = pc.nodes[(i + 1) % pc.nodes.length]; return [a.p, a.out, b.in, b.p]; };
function onCurve(c, t) { const u = 1 - t; return { x: c[0].x * u * u * u + c[1].x * 3 * u * u * t + c[2].x * 3 * u * t * t + c[3].x * t * t * t, y: c[0].y * u * u * u + c[1].y * 3 * u * u * t + c[2].y * 3 * u * t * t + c[3].y * t * t * t }; }
function heading(c, t)
{
    const u = 1 - t, dx = (c[1].x - c[0].x) * 3 * u * u + (c[2].x - c[1].x) * 6 * u * t + (c[3].x - c[2].x) * 3 * t * t, dy = (c[1].y - c[0].y) * 3 * u * u + (c[2].y - c[1].y) * 6 * u * t + (c[3].y - c[2].y) * 3 * t * t;
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) { const L = Math.max(1e-9, far(c[3], c[0])); return { x: (c[3].x - c[0].x) / L, y: (c[3].y - c[0].y) / L }; }
    return { x: dx / l, y: dy / l };
}
function cut(c, t, keepLeft)
{
    const p01 = mixP(c[0], c[1], t), p12 = mixP(c[1], c[2], t), p23 = mixP(c[2], c[3], t), p012 = mixP(p01, p12, t), p123 = mixP(p12, p23, t), m = mixP(p012, p123, t);
    return keepLeft ? [c[0], p01, p012, m] : [m, p123, p23, c[3]];
}
function part(c, t0, t1) { const left = cut(c, t1, true); return t1 <= 1e-9 ? left : cut(left, t0 / t1, false); }
function reach(c, d, fromEnd)
{
    const end = fromEnd ? c[3] : c[0];
    let lo = 0, hi = 1;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2, t = fromEnd ? 1 - mid : mid; if (far(onCurve(c, t), end) < d) lo = mid; else hi = mid; }
    return fromEnd ? 1 - (lo + hi) / 2 : (lo + hi) / 2;
}
function rounded(d, corners, place, scale)
{
    const all = pieces(d);
    for (const pc of all) for (const n of pc.nodes) { n.p = place(n.p); n.in = place(n.in); n.out = place(n.out); }
    for (const one of corners.split(";"))
    {
        const m = one.match(/^(\d+)\.(\d+)=(.+)$/);
        if (m && all[+m[1]] && all[+m[1]].nodes[+m[2]]) all[+m[1]].nodes[+m[2]].corner = parseFloat(m[3]) * scale;
    }
    const path = new Path2D();
    for (const pc of all)
    {
        const ns = pc.nodes, n = ns.length, segs = pc.closed ? n : n - 1;
        if (segs < 1) continue;
        const start = new Array(segs).fill(0), end = new Array(segs).fill(1), round = new Array(n).fill(false);
        for (let i = 0; i < n; i++)
        {
            if (ns[i].corner <= 0) continue;
            const along = fitCorner(pc, i, ns[i].corner);
            if (along <= 0.001) continue;
            round[i] = true;
            if (pc.closed || i > 0) end[(i + n - 1) % n] = reach(curveOf(pc, (i + n - 1) % n), along, true);
            if (i < segs) start[i] = reach(curveOf(pc, i), along, false);
        }
        const parts = [];
        for (let j = 0; j < segs; j++) parts.push(part(curveOf(pc, j), start[j], end[j]));
        path.moveTo(parts[0][0].x, parts[0][0].y);
        for (let j = 0; j < segs; j++)
        {
            const c = parts[j], whole = curveOf(pc, j), a = ns[j], b = ns[(j + 1) % n], len = far(whole[0], whole[3]);
            if (far(c[0], c[3]) < 1e-3 * len && far(c[0], c[1]) + far(c[2], c[3]) < 1e-3 * len) { }   // (a side the corners use up: left out)
            else if (same(a.out, a.p) && same(b.in, b.p)) path.lineTo(c[3].x, c[3].y);
            else path.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y);
            const k = (j + 1) % n;
            if (!round[k] || (!pc.closed && k === 0)) continue;
            // The corner: from this side's end to the next side's start, leaving and arriving along them.
            const q1 = c[3], q2 = parts[(j + 1) % segs][0], t1 = heading(curveOf(pc, j), end[j]), t2 = heading(curveOf(pc, k % segs), start[k % segs]);
            const turn = Math.acos(Math.max(-1, Math.min(1, t1.x * t2.x + t1.y * t2.y))), radius = far(q1, q2) / Math.max(1e-9, 2 * Math.sin(turn / 2)), h = 4 / 3 * Math.tan(turn / 4) * radius;
            path.bezierCurveTo(q1.x + t1.x * h, q1.y + t1.y * h, q2.x - t2.x * h, q2.y - t2.y * h, q2.x, q2.y);
        }
        if (pc.closed) path.closePath();
    }
    return path;
}

// A fill: a color, or the gradient its text describes, across its box at its angle.
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
function mixA(a, b, t)   // two "#AARRGGBB" colors mixed
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
            // (decoded as big as it is shown here: its crop's size on the screen, over what of the picture it shows)
            const m = ctx.getTransform(), across = Math.max(b.w * Math.hypot(m.a, m.b), b.h * Math.hypot(m.c, m.d));
            const first = get(o.file, across), part = first && o.cw > 0 && o.ch > 0 ? Math.max(first.src.w / o.cw, first.src.h / o.ch) : 1;
            const got = part > 1.05 ? get(o.file, across * part) || first : first;   // (cropped: as big again as the part it shows)
            if (!got) { stats.gaps++; ctx.fillStyle = "rgba(128,128,128,.18)"; ctx.fillRect(b.x, b.y, b.w, b.h); return; }
            const img = got.img, k = got.k;
            flip(ctx, o, b);
            ctx.imageSmoothingQuality = smooth;
            const cw = o.cw > 0 ? o.cw * k : img.width, ch = o.ch > 0 ? o.ch * k : img.height;
            ctx.drawImage(img, o.cx * k, o.cy * k, cw, ch, b.x, b.y, b.w, b.h);
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
            for (const t of tiles) { const got = get(t.file); if (got) ctx.drawImage(got.img, t.c * T, t.r * T, T, T); }
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
const BAND = 10;   // a list's color, as a band along its card's top edge
export function listLayout(o, ctx)
{
    const key = o.w + "|" + o.name + "|" + o.showDone + "|" + o.rows.map(r => r.kind + r.done + r.text + (r.link ? 1 : 0)).join("\u0001");
    if (o._layout && o._layout.key === key) return o._layout;
    const c = measureCtx(ctx);
    const w = o.w / o.scale;
    c.save();
    c.font = "700 20px " + NOTE;
    const title = wrap(c, o.name || "", w - 40);
    let y = BAND + 20 + title.length * 25 + 16;
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
    ctx.beginPath(); ctx.roundRect(0, 0, w, L.h, 12); ctx.fill();
    ctx.save(); ctx.clip();   // the band: the list's color along its top edge, its corners the card's
    ctx.fillStyle = rgba(look.stripe); ctx.fillRect(0, 0, w, BAND);
    ctx.restore();
    ctx.fillStyle = look.onCard;
    ctx.font = "700 20px " + NOTE;
    ctx.textBaseline = "top";
    L.title.forEach((t, i) => ctx.fillText(t, 20, BAND + 20 + i * 25));
    for (const e of L.entries)
    {
        const r = e.r;
        if (r.kind === "D") { ctx.fillStyle = shade(look.tile, 0.14); ctx.beginPath(); ctx.roundRect(20 + (w - 40) * 0.25, e.y + e.h / 2 - 2, (w - 40) * 0.5, 4, 2); ctx.fill(); continue; }
        ctx.save();
        if (r.done) ctx.globalAlpha *= 0.5;
        if (r.kind !== "H") { ctx.fillStyle = look.tile; ctx.beginPath(); ctx.roundRect(20, e.y, w - 40, e.h, 8); ctx.fill(); }
        const head = r.kind === "H", left = r.kind === "T" ? 46 : head ? 4 : 16, lh = head ? 22 : 20;
        const top = e.y + (e.h - e.lines.length * lh) / 2;
        if (r.kind === "T")
        {
            const ink = r.color ? rgba(r.color) : look.box, bx = 36, by = top + lh / 2 - 8;   // (in line with its first line)
            ctx.lineWidth = 1.6; ctx.strokeStyle = ink;
            ctx.beginPath(); ctx.roundRect(bx, by, 16, 16, 2);
            if (r.done) { ctx.fillStyle = ink; ctx.fill(); ctx.strokeStyle = ink; ctx.stroke(); ctx.strokeStyle = dark(r.color || look.box) ? "#fff" : "#000"; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.moveTo(bx + 3.8, by + 8.4); ctx.lineTo(bx + 6.8, by + 11.4); ctx.lineTo(bx + 12.2, by + 5); ctx.stroke(); }
            else ctx.stroke();
        }
        ctx.fillStyle = head ? look.onCard : look.ink;
        ctx.font = (head ? "700 17px " : "400 15px ") + NOTE;
        ctx.textBaseline = "middle";
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
