// The canvas drawn in the browser, as the desktop app draws it: boards, pictures, drawings, shapes, lines, paths,
// type and lists, each turned, slanted, faded, blended and clipped as it is there. Close, not exact: type lays out
// with the browser's own shaping, and blurs and a path's dynamic corners are left out.

import { placed, order, movedTo, regrouped, hiddenLayers } from "./cnpy.js";

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
function derived(fill, i)   // one color of the set made from a list's color (7 its headings, 10 its card, 11 its entries), as Board's ListLayer.Colored
{
    const [h, s] = toHsv(rgb(fill)), k = Math.min(1, s / 0.5);
    const at = { 7: [0.45, 1.0], 10: [0.42, 0.22], 11: [0.40, 0.29] }[i];
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
export const stats = { draws: [], decoded: 0, decodeMs: [], dropped: 0, failed: 0, widest: 0, previews: 0, kept: 0, made: 0, missing: 0, gaps: 0, retried: 0, huge: 0, blank: 0 };
export function cache() { return { seen: new Map(), busy: 0, queue: [], pixels: 0, frame: 0 }; }
export function forget(c) { if (!c) return; for (const e of c.seen.values()) { if (e.img) e.img.close(); e.img = null; e.closed = true; } c.seen.clear(); c.pixels = 0; c.queue.length = 0; }
export function pictures(doc, added, redraw, c)
{
    c = c || cache();
    const bytesOf = file => added && added.has(file) ? Promise.resolve(added.get(file)) : extraBytes.has(file) ? Promise.resolve(extraBytes.get(file)) : doc.zip.file(file) ? doc.zip.file(file).async("uint8array") : null;
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
                e.img = got.img; e.k = got.k; e.side = job.side; e.full = got.full; e.src = got.src; e.from = got.from || (job.side > SMALL ? "the original" : "the original, made small"); e.blank = blank(got.img);
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
        if (pre && size) { const img = await createImageBitmap(new Blob([await pre.async("uint8array")], { type: "image/webp" })); stats.previews++; return { img, k: img.width / size.w, full: false, src: size, from: "Board's preview in the file" }; }
        const keptCopy = await kept(file);
        if (keptCopy)
        {
            const img = await createImageBitmap(keptCopy.blob);
            if (!blank(img)) { stats.kept++; return { img, k: img.width / keptCopy.w, full: false, src: { w: keptCopy.w, h: keptCopy.h }, from: "the copy kept on this phone" }; }
            img.close();   // (a blank copy: made again below)
        }
        const got = await decode(await bytes, SMALL);
        if (!got.full && !blank(got.img)) { stats.made++; keep(file, got.img, got.src); }   // (kept only if it has something in it)
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
// ("canopy-small-2": the copies made before blank pictures were spotted, some of them blank, are let go)
try { indexedDB.deleteDatabase("canopy-small"); } catch (e) { }
function copies() { return store || (store = new Promise((ok, no) => { const r = indexedDB.open("canopy-small-2", 1); r.onupgradeneeded = () => r.result.createObjectStore("small"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); })); }
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
    if (size && size.w * size.h > HUGE)
    {
        // Past what a phone will decode in one piece (it gives back a blank picture, not an error): read by the page's
        // own picture loader, which can, and made smaller from it. Never whole.
        const k = Math.min(1, side / Math.max(size.w, size.h)), w = Math.max(1, Math.round(size.w * k)), h = Math.max(1, Math.round(size.h * k));
        const img = await viaPicture(blob, w, h);
        stats.huge++;
        return { img, k: img.width / size.w, full: false, src: size, from: "the original, too big for one piece: read another way" };
    }
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
        if (blank(img)) { img.close(); img = await viaPicture(blob, w, h); stats.blank++; }   // (came back blank: read the other way)
        return { img, k: img.width / size.w, full: false, src: size };
    }
    let img = await createImageBitmap(blob);
    if (size && blank(img)) { img.close(); img = await viaPicture(blob, size.w, size.h); stats.blank++; }
    return { img, k: 1, full: true, src: { w: img.width, h: img.height } };
}
// Past this many pixels a phone may not decode a picture at all (an iPhone's limit for one is about 4096 × 4096).
const HUGE = 16e6;
// A picture read by the page's own loader (as an <img> would show it: a phone shrinks a big one as it reads it), then
// drawn at the size wanted.
async function viaPicture(blob, w, h)
{
    const url = URL.createObjectURL(blob);
    try
    {
        const pic = new Image();
        pic.src = url;
        await pic.decode();
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        const g = cv.getContext("2d"); g.imageSmoothingQuality = "high";
        g.drawImage(pic, 0, 0, w, h);
        const img = await createImageBitmap(cv);
        cv.width = cv.height = 0;
        return img;
    }
    finally { URL.revokeObjectURL(url); }
}
// Whether a picture came back with nothing in it (looked at small: every pixel see-through).
function blank(img)
{
    try
    {
        const cv = document.createElement("canvas"); cv.width = cv.height = 8;
        const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(img, 0, 0, 8, 8);
        const d = g.getImageData(0, 0, 8, 8).data;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false;
        return true;
    }
    catch (e) { return false; }
}
// What kind of picture its first bytes say it is (for the measuring readout).
export function kindOf(b)
{
    if (!b || b.length < 16) return "?";
    if (b[0] === 0x89 && b[1] === 0x50) return "PNG";
    if (b[0] === 0xFF && b[1] === 0xD8) return "JPEG";
    if (b[0] === 0x47 && b[1] === 0x49) return "GIF";
    if (b[0] === 0x52 && b[8] === 0x57) return b[15] === 0x4C ? "WebP (lossless)" : b[15] === 0x58 ? "WebP (extended)" : "WebP";
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "HEIC/AVIF (" + String.fromCharCode(b[8], b[9], b[10], b[11]) + ")";
    if (b[0] === 0x42 && b[1] === 0x4D) return "BMP";
    return "unknown (" + [...b.slice(0, 4)].map(x => x.toString(16).padStart(2, "0")).join(" ") + ")";
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
// Drawings' pixels not in the file (a drawing as it was before a save, kept to undo past it): their tiles by folder,
// and the tiles' bytes by file, for tilesOf and the pictures to find.
const extraTiles = new Map(), extraBytes = new Map();
export function keepSnap(snap) { if (!extraTiles.has(snap.file)) { extraTiles.set(snap.file, snap.tiles); for (const [f, b] of snap.files) extraBytes.set(f, b); } }
export function tilesOf(doc, folder)   // a drawing's tiles: their places (column, row) and file names
{
    if (extraTiles.has(folder)) return extraTiles.get(folder);
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

// The canvas's color: as Board shows it, the theme's (one color for every project, not the file's own "canvas" line,
// which Board keeps but doesn't show); the file's until the theme is known.
let canvasBack = null;
export function setCanvasBack(c) { canvasBack = c; }
export function back(doc) { return canvasBack || doc.canvas; }

export function scene(doc, view)
{
    const lists = new Map(view.lists.map(l => [l.id, l]));
    const byId = new Map(doc.items.map(o => [o.id, o]));
    // (in the order the hierarchy has left them; shown or hidden, renamed and put into a layer there)
    const own = o =>
    {
        let q = o.kind === "list" && lists.has(o.id) ? lists.get(o.id) : view.moved.has(o.id) ? placed(o, view.moved.get(o.id)) : o;
        if (view.locks.has(o.id)) q = { ...q, locked: view.locks.get(o.id) };
        if (view.hides && view.hides.has(o.id)) q = { ...q, hidden: view.hides.get(o.id) };
        if (view.names && view.names.has(o.id)) q = { ...q, name: view.names.get(o.id) };
        if (view.fills && view.fills.has(o.id)) q = { ...q, fill: view.fills.get(o.id) };
        const lay = movedTo(view, o.id);
        if (lay) q = { ...q, ...regrouped(doc, o, lay) };
        return q;
    };
    // (a drawing as it was before a save: its pixels then, where they were)
    for (const [id, snap] of view.unsaved || [])
    {
        keepSnap(snap);
        const o = byId.get(id);
        if (o) byId.set(id, { ...o, file: snap.file, frame: snap.frame, x: snap.box.x, y: snap.box.y, w: snap.box.w, h: snap.box.h });
    }
    const items = order(doc, view).map(id => byId.get(id)).filter(o => o && !view.deleted.has(o.id) && !view.removed.has(o.id)).map(own);
    for (const l of view.lists) if (l.fresh) items.push(l);
    for (const r of view.restored) items.push(r.by ? placed(r.item, r.by) : r.item);
    for (const k of view.sketches || [])
    {
        // Drawings made here, on top until saved; strokes on a saved one, drawn with it (its pixels and them together).
        if (!k.base) { items.push(sketchItem(k)); continue; }
        const at = items.findIndex(o => o.id === k.base);
        if (at >= 0) items[at] = { ...items[at], strokes: k.strokes, reach: reachOf(items[at], [sketchItem(k)]) };
    }
    for (const m of view.merges || [])
    {
        // A drawing merged down, not yet saved: drawn with the one it went into, over it (it is one in the hierarchy).
        const at = items.findIndex(o => o.id === m.into), up = byId.get(m.id);
        if (at < 0 || !up) continue;
        const k = (view.sketches || []).find(x => x.base === m.id);
        const q = own(up);
        const with2 = k ? { ...q, strokes: k.strokes } : q;
        items[at] = { ...items[at], merged: (items[at].merged || []).concat([with2]), reach: reachOf(items[at], [q].concat(k ? [sketchItem(k)] : [])) };
    }
    for (const p of view.photos) items.push({ kind: "image", locked: !!p.locked, id: p.id, file: p.file, x: p.x, y: p.y, w: p.w, h: p.h, cx: 0, cy: 0, cw: p.pw, ch: p.ph, opacity: 1, blend: "normal", angle: 0, shear: 0, group: p.layer ? p.layer.id : null, name: p.name });
    const masks = new Map();   // a clipped group's path → its mask (the topmost of it, marked as one)
    const top = new Map();
    for (const o of items) if (o.group) for (const path of groupsOf(o.group).paths) top.set(path, o);
    for (const [g, o] of top) if (o.clip && o.group === g) masks.set(g, o);
    return { doc, items, masks, hides: hiddenLayers(doc, view), boards: doc.boards.filter(b => !view.goneBoards.has(b.id)).concat(view.boards) };
}

// The groups an object is in, by their ids (outermost first), and the paths to each ("a", "a/b", ...): each group's
// worked out once, not again for every object at every frame.
const groupings = new Map();
export function groupsOf(group)
{
    let g = groupings.get(group);
    if (!g) { const ids = group.split("/"); g = { ids, paths: ids.map((x, k) => ids.slice(0, k + 1).join("/")) }; groupings.set(group, g); }
    return g;
}
// Hidden: itself, or a group or layer it is in ("sc": the scene, with the layers as hidden here; else the file's).
export function hidden(sc, o)
{
    if (o.hidden) return true;
    const hides = sc.hides || sc.doc.hides;
    if (!o.group || hides.size === 0) return false;
    return groupsOf(o.group).ids.some(id => hides.has(id));
}
export function fade(doc, o) { let a = o.opacity === undefined ? 1 : o.opacity; if (o.group && doc.fades.size) for (const id of groupsOf(o.group).ids) if (doc.fades.has(id)) a *= doc.fades.get(id); return a; }

// Where an object is (its own box, before any turn), and its box on the canvas with any turn.
export function box(o, ctx)
{
    if (o.kind === "list") return { x: o.x, y: o.y, w: o.w, h: listLayout(o, ctx).h * o.scale };
    return { x: o.x, y: o.y, w: o.w, h: o.h };
}
// How far a drawing reaches with what is drawn on it here (strokes, or one merged into it, past its own box): what
// says whether it is in view, so it isn't left out once only the new part is.
function reachOf(o, more)
{
    const all = [o.reach || outer(o)].concat(more.map(m => outer(m)));
    const x0 = Math.min(...all.map(b => b.x)), y0 = Math.min(...all.map(b => b.y)), x1 = Math.max(...all.map(b => b.x + b.w)), y1 = Math.max(...all.map(b => b.y + b.h));
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export function outer(o, ctx)
{
    const b = box(o, ctx);
    if (!o.angle && !o.shear) return b;
    const m = placing(o, b), pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => m.transformPoint(new DOMPoint(x, y)));
    const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
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
    sc.items.forEach(o => { if (!hidden(sc, o)) add(outer(o, ctx)); });
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
    // ("part": only the items from one place in their order to another, laid over what is there, and no boards or names
    // unless "under": the parts of the scene kept still while a stroke is drawn, see Viewer.redraw)
    const part = opts.part, under = !part || part.under;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over";
    if (under) { ctx.fillStyle = opts.background || back(doc); ctx.fillRect(0, 0, w, h); }
    const s = cam.s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * cam.tx, dpr * cam.ty);
    const view = { x: -cam.tx / s, y: -cam.ty / s, w: w / s, h: h / s };
    const meets = b => b.x <= view.x + view.w && b.x + b.w >= view.x && b.y <= view.y + view.h && b.y + b.h >= view.y;
    // Boards, under everything.
    const fill = doc.boardLook === 2 ? "#ffffff" : doc.boardColor ? rgba(doc.boardColor) : shade(back(doc), 0.07);
    for (const b of under ? sc.boards : [])
    {
        if (!meets(b)) continue;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, doc.boardLook !== 0 ? 0 : Math.min(8 / s, b.w / 2, b.h / 2));
        if (doc.boardLook === 1) { ctx.strokeStyle = shade(back(doc), 0.3); ctx.lineWidth = 1 / s; ctx.stroke(); }
        else { ctx.fillStyle = fill; ctx.fill(); }
    }
    for (const o of part ? sc.items.slice(part.from, part.to) : sc.items)
    {
        if (hidden(sc, o) || (o.clip && sc.masks.get(o.group) === o)) continue;
        if (!meets(o.reach || outer(o, ctx))) continue;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, fade(doc, o)));
        ctx.globalCompositeOperation = o.blend && o.blend !== "normal" ? o.blend : "source-over";
        // Clipped by the mask of any group it is in.
        if (o.group && sc.masks.size)
        {
            for (const path of groupsOf(o.group).paths) { const m = sc.masks.get(path); if (m && m !== o) { const p = outline(m); if (p) ctx.clip(p); } }
        }
        try { drawOne(ctx, o, doc, s, get, redraw, opts.wet); } catch (e) { }
        ctx.restore();
    }
    // The boards' names, over the art (a picture reaching over a board's top edge never hides one).
    if (opts.names !== false && (!part || part.names))
    {
        ctx.font = "500 " + 12 / s + "px 'IBM Plex Sans', system-ui, sans-serif";
        ctx.fillStyle = dark(back(doc)) ? "rgba(234,236,235,.55)" : "rgba(21,22,22,.55)";
        ctx.textBaseline = "bottom";
        for (const b of sc.boards) if (meets({ x: b.x, y: b.y - 24 / s, w: b.w, h: 24 / s })) ctx.fillText(b.name, b.x, b.y - 6 / s);
    }
}

// ---- drawings made here: strokes kept as points until saved (then painted into a drawing layer's tiles) ----

// A drawing made here, as the scene has it: its strokes, and the box they reach.
export function sketchItem(k)
{
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const st of k.strokes)
    {
        const r = reachOfStroke(st);
        if (r.x0 < x0) x0 = r.x0; if (r.y0 < y0) y0 = r.y0; if (r.x1 > x1) x1 = r.x1; if (r.y1 > y1) y1 = r.y1;
    }
    if (x0 === Infinity) { x0 = y0 = x1 = y1 = 0; }
    return { kind: "sketch", id: k.id, name: k.name, strokes: k.strokes, x: x0, y: y0, w: x1 - x0, h: y1 - y0, group: k.layer ? k.layer.id : null, opacity: 1, blend: "normal", angle: 0, shear: 0 };
}
// What one stroke reaches (its corners, x0 to x1 and y0 to y1), kept with it: worked out again only once it has changed
// (its points still coming, a selection moved further), so a drawing's reach isn't every point of it gone over again.
const reaches = new WeakMap();
function reachOfStroke(st)
{
    const n = st.pts ? st.pts.length : 0, got = reaches.get(st);
    if (got && got.n === n && got.dx === st.dx && got.dy === st.dy && got.size === st.size) return got;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const take = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
    if (st.kind === "fill") { take(st.x, st.y, 0); take(st.x + st.w, st.y + st.h, 0); }
    else if (st.kind === "move") { for (let i = 0; i < n; i += 2) { take(st.pts[i], st.pts[i + 1], 1); take(st.pts[i] + st.dx, st.pts[i + 1] + st.dy, 1); } }
    else if (st.kind !== "clear") for (let i = 0; i < n; i += 3) take(st.pts[i], st.pts[i + 1], st.size / 2 + 1);   // (a clear rubs out only)
    const r = { n, dx: st.dx, dy: st.dy, size: st.size, x0, y0, x1, y1 };
    reaches.set(st, r);
    return r;
}
// Strokes drawn onto a canvas set to canvas units: Ink's line as wide as it is pressed, the Flat's its roughened tip
// stamped along, an eraser rubbing out (on the drawing's own canvas: only what is drawn there). A
// stroke less than fully opaque is drawn on a canvas of its own first and laid on as a whole, so where it crosses
// itself it is no stronger.
export function drawStrokes(g, strokes)
{
    for (const st of strokes)
    {
        if (st.kind === "fill" || st.kind === "move" || st.kind === "clear") { drawEdit(g, st); continue; }
        const n = st.pts.length / 3;
        if (n === 0) continue;
        const alpha = st.opacity === undefined ? 1 : st.opacity;
        const op = st.kind === "erase" ? "destination-out" : "source-over";
        if (alpha >= 1)
        {
            g.save(); g.globalCompositeOperation = op; strokeInto(g, st); g.restore();
            continue;
        }
        // On its own: only the part of the canvas it reaches (in the canvas's pixels).
        const m = g.getTransform(), r = st.size / 2 + 2;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < st.pts.length; i += 3)
        {
            const x = st.pts[i], y = st.pts[i + 1];
            x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r);
        }
        const corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]);
        const W = g.canvas.width, H = g.canvas.height;
        const L = Math.max(0, Math.floor(Math.min(...corners.map(c => c[0])))), T = Math.max(0, Math.floor(Math.min(...corners.map(c => c[1]))));
        const R = Math.min(W, Math.ceil(Math.max(...corners.map(c => c[0])))), B = Math.min(H, Math.ceil(Math.max(...corners.map(c => c[1]))));
        if (R <= L || B <= T) continue;
        if (!alone) alone = document.createElement("canvas");
        if (alone.width < R - L || alone.height < B - T) { alone.width = Math.max(alone.width, R - L); alone.height = Math.max(alone.height, B - T); }
        const o = alone.getContext("2d");
        o.setTransform(1, 0, 0, 1, 0, 0); o.globalAlpha = 1; o.globalCompositeOperation = "source-over"; o.clearRect(0, 0, R - L, B - T);
        o.setTransform(m.a, m.b, m.c, m.d, m.e - L, m.f - T);
        strokeInto(o, st);
        g.save();
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha *= alpha; g.globalCompositeOperation = op;
        g.drawImage(alone, 0, 0, R - L, B - T, L, T, R - L, B - T);
        g.restore();
    }
}
let alone = null;   // (a stroke drawn on its own: one canvas, used again)

// One stroke's paint, at full strength, onto "g" (set to canvas units).
function strokeInto(g, st)
{
    const p = st.pts;
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = g.fillStyle = st.kind === "erase" ? "#000" : st.color;
    if (st.kind === "flat") { flatInto(g, st); return; }
    inkPieces(g, st, p, 1, p.length / 3);
}
// Ink: piece by piece, each as wide as the pressure along it (so it swells and thins along the way), and each a curve
// from the middle of one gap to the middle of the next, bending at the point between (no corners); the last on to the
// last point. Pieces "from" to "to" (the first, 1; one point alone: a dot).
function inkPieces(g, st, p, from, to)
{
    const n = p.length / 3, x = i => p[i * 3], y = i => p[i * 3 + 1], w = i => st.size * Math.max(0.1, p[i * 3 + 2]);
    if (n === 1) { if (from <= 1) { g.beginPath(); g.arc(p[0], p[1], w(0) / 2, 0, Math.PI * 2); g.fill(); } return; }
    if (n === 2) { if (from <= 1) { g.lineWidth = (w(0) + w(1)) / 2; g.beginPath(); g.moveTo(x(0), y(0)); g.lineTo(x(1), y(1)); g.stroke(); } return; }
    for (let i = Math.max(1, from); i < Math.min(to, n); i++)
    {
        const ax = i === 1 ? x(0) : (x(i - 2) + x(i - 1)) / 2, ay = i === 1 ? y(0) : (y(i - 2) + y(i - 1)) / 2;
        const last = i === n - 1, bx = last ? x(i) : (x(i - 1) + x(i)) / 2, by = last ? y(i) : (y(i - 1) + y(i)) / 2;
        g.lineWidth = i === 1 ? (w(0) + w(1)) / 2 : (w(i - 2) + w(i - 1) * 2 + w(i)) / 4;
        g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(x(i - 1), y(i - 1), bx, by); g.stroke();
    }
}

// The stroke being drawn, a little more each time: what of it is settled is kept on a canvas of its own ("wetLayer",
// added to as the points come, never drawn again), and only its last piece (and any points guessed ahead) drawn fresh
// each time; laid onto "g" (the drawing's canvas, in its pixels; "m" its transform) as the whole stroke would be.
let wetLayer = null, wetMix = null;
function drawWet(g, st, m)
{
    const cv = g.canvas, key = [st.sid, cv.width, cv.height, m.a, m.b, m.c, m.d, m.e, m.f].join();
    if (!wetLayer) wetLayer = { canvas: document.createElement("canvas"), key: "", upto: 0, carry: 0 };
    const L = wetLayer, wc = L.canvas;
    if (L.key !== key)
    {
        if (wc.width !== cv.width || wc.height !== cv.height) { wc.width = cv.width; wc.height = cv.height; }
        const c = wc.getContext("2d"); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, wc.width, wc.height);
        L.key = key; L.upto = 0; L.carry = 0;
    }
    const p = st.pts, all = p.length / 3, solid = all - (p.ahead || 0);
    const paint = c => { c.setTransform(m); c.globalAlpha = 1; c.globalCompositeOperation = "source-over"; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = c.fillStyle = st.kind === "erase" ? "#000" : st.color; };
    const c = wc.getContext("2d");
    paint(c);
    if (st.kind === "flat")
    {
        if (solid > L.upto) { const path = new Path2D(); L.carry = flatStamps(tipInto(path), st, L.upto, solid, L.carry); c.fill(path, "nonzero"); L.upto = solid; }
    }
    else if (solid >= 3 && solid - 1 > L.upto) { inkPieces(c, st, p.slice(0, (solid - 1) * 3 + 3), Math.max(1, L.upto), solid - 1); L.upto = solid - 1; }   // (settled: all but the last piece)
    const alpha = st.opacity === undefined ? 1 : st.opacity, erase = st.kind === "erase";
    let into = g;
    if (alpha < 1 || erase)
    {
        if (!wetMix) wetMix = document.createElement("canvas");
        if (wetMix.width !== cv.width || wetMix.height !== cv.height) { wetMix.width = cv.width; wetMix.height = cv.height; }
        into = wetMix.getContext("2d");
        into.setTransform(1, 0, 0, 1, 0, 0); into.globalAlpha = 1; into.globalCompositeOperation = "source-over"; into.clearRect(0, 0, cv.width, cv.height);
    }
    into.save(); into.setTransform(1, 0, 0, 1, 0, 0); into.globalAlpha = 1; into.globalCompositeOperation = "source-over"; into.drawImage(wc, 0, 0); into.restore();
    into.save(); paint(into);
    if (st.kind === "flat") { if (all > solid) { const path = new Path2D(); flatStamps(tipInto(path), st, solid, all, L.carry); into.fill(path, "nonzero"); } }
    else inkPieces(into, st, p, Math.max(1, L.upto), all);
    into.restore();
    if (into !== g) { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = alpha; g.globalCompositeOperation = erase ? "destination-out" : "source-over"; g.drawImage(wetMix, 0, 0); g.restore(); }
}

// The Flat, as Board's Flat brush with no bristles: its tip (Board's TipShape.Flat: a rounded rectangle, its edge
// broken into lobes with notches between and a fine wobble over that), held level, stamped close together all along
// the stroke, so its ends and sides come out roughened as Board's do; as wide as it is pressed. The stamps made so far
// are kept with the stroke, so a long one isn't stamped over again each time it is drawn.
export const FLAT = { aspect: 0.42, corner: 0.62, lobes: 13, depth: 0.214, wobble: 0.029, seed: 3 };
let flatTip = null;   // its outline, across -0.5 to 0.5 of the tip's width and of its thickness
export function tipOutline()
{
    if (flatTip) return flatTip;
    const n = 96, { aspect, corner, lobes, depth, wobble } = FLAT;
    const a = 0.5, b = 0.5 * aspect, rc = Math.max(1e-4, corner * b), ex = a - rc, ey = b - rc, thick = 2 * b;
    const quarter = Math.PI / 2 * rc, len = 4 * ex + 4 * ey + 4 * quarter;
    let seed = FLAT.seed;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const waves = [], fine = [];
    for (let f = Math.max(1, Math.round(lobes * 0.3)); f < Math.round(lobes * 0.75); f++) waves.push([f, Math.pow(f, -0.3), rnd() * 6.28]);
    for (let f = Math.round(lobes * 2.3); f < lobes * 4.6; f += 2) fine.push([f, 1, rnd() * 6.28]);
    const wave = (ws, th) => { let v = 0, sq = 0; for (const w of ws) { v += w[1] * Math.sin(w[0] * th + w[2]); sq += w[1] * w[1]; } return sq === 0 ? 9 : v / Math.sqrt(sq / 2); };
    const dir = [0, 1, -1, 0, 0, -1, 1, 0];
    const pts = [];
    for (let i = 0; i < n; i++)
    {
        // (along the rounded rectangle by distance, so the lobes keep their size round the corners)
        let q = i * len / n, x = 0, y = 0, nx = 0, ny = 0;
        for (let k = 0; k < 8; k++)
        {
            const l = k % 2 === 1 ? quarter : k % 4 === 0 ? 2 * ey : 2 * ex;
            if (q > l && k < 7) { q -= l; continue; }
            const side = k >> 1;
            if (k % 2 === 1)
            {
                const t = side * Math.PI / 2 + q / rc;
                nx = Math.cos(t); ny = Math.sin(t);
                x = (side === 0 || side === 3 ? ex : -ex) + rc * nx; y = (side < 2 ? ey : -ey) + rc * ny;
            }
            else
            {
                nx = dir[side * 2 + 1]; ny = -dir[side * 2];
                x = (side === 0 ? a : side === 2 ? -a : side === 1 ? ex : -ex) + dir[side * 2] * q;
                y = (side === 1 ? b : side === 3 ? -b : side === 0 ? -ey : ey) + dir[side * 2 + 1] * q;
            }
            break;
        }
        const th = i * Math.PI * 2 / n, lobe = wave(waves, th), wob = wave(fine, th);
        const dent = thick * (depth * Math.exp(-3 * lobe * lobe) + wobble * Math.max(0, 1 - Math.abs(wob) / 0.8));
        pts.push((x - dent * nx) * 0.92, (y - dent * ny) / thick * 0.92);
    }
    return flatTip = pts;
}
const stamped = new WeakMap();   // a Flat stroke: { path, upto (its points stamped), carry (along since the last stamp) }
// The Flat's tip stamped a small share of its width apart, along points "from" to "to" (carrying on "c" along from
// the last stamp): each stamp "put" (its middle and width), and what is left over returned.
export function flatStamps(put, st, from, to, c)
{
    const p = st.pts, width = i => st.size * Math.max(0.35, p[i * 3 + 2]);
    for (let i = from; i < to; i++)
    {
        if (i === 0) { put(p[0], p[1], width(0)); continue; }
        const x0 = p[(i - 1) * 3], y0 = p[(i - 1) * 3 + 1], x1 = p[i * 3], y1 = p[i * 3 + 1], d = Math.hypot(x1 - x0, y1 - y0);
        const w0 = width(i - 1), w1 = width(i), step = Math.max(0.5, Math.min(w0, w1) * 0.06);
        let t = step - c;
        while (t <= d) { const u = d ? t / d : 1; put(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u, w0 + (w1 - w0) * u); t += step; }
        c = d - (t - step);
    }
    return c;
}
// The tip's outline at (x, y), "w" wide, into "path".
function tipInto(path)
{
    const tip = tipOutline();
    return (x, y, w) =>
    {
        const h = w * FLAT.aspect;
        path.moveTo(x + tip[0] * w, y + tip[1] * h);
        for (let k = 2; k < tip.length; k += 2) path.lineTo(x + tip[k] * w, y + tip[k + 1] * h);
        path.closePath();
    };
}
function flatInto(g, st)
{
    const n = st.pts.length / 3;
    let kept = stamped.get(st);
    if (!kept || kept.upto > n || kept.size !== st.size) { kept = { path: new Path2D(), upto: 0, carry: 0, size: st.size }; stamped.set(st, kept); }
    if (n > kept.upto) { kept.carry = flatStamps(tipInto(kept.path), st, kept.upto, n, kept.carry); kept.upto = n; }
    g.fill(kept.path, "nonzero");
}
// A fill (a picture of what it filled, made when it was tapped), a selection rubbed out ("clear"), or one moved ("move":
// the paint inside its outline taken out and put back "dx", "dy" along): drawn onto what the drawing has so far.
const fills = new Map();   // a fill's picture, by its stroke, decoded once
export const filled = { onReady: null };   // told when a fill's picture has decoded (to draw again)
export function fillImage(st)
{
    let img = fills.get(st.sid);
    if (!img) { img = new Image(); img.onload = () => { if (filled.onReady) filled.onReady(); }; img.src = st.img; fills.set(st.sid, img); }
    return img;
}
// Every fill's picture among some strokes, decoded (before they are painted into a drawing's tiles).
export async function fillsDecoded(strokes) { for (const st of strokes) if (st.kind === "fill") { const img = fillImage(st); try { await img.decode(); } catch (e) { } } }
function outlinePath(g, pts)
{
    g.beginPath();
    for (let i = 0; i < pts.length; i += 2) if (i === 0) g.moveTo(pts[0], pts[1]); else g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
}
function drawEdit(g, st)
{
    g.save();
    if (st.kind === "fill")
    {
        const img = fillImage(st);
        if (img.complete && img.naturalWidth) { g.imageSmoothingEnabled = true; g.drawImage(img, st.x, st.y, st.w, st.h); }
    }
    else if (st.kind === "clear") { g.globalCompositeOperation = "destination-out"; outlinePath(g, st.pts); g.fillStyle = "#000"; g.fill(); }
    else
    {
        // (in the canvas's own pixels: the piece copied out, the place rubbed out, the piece laid on along the way)
        const cv = g.canvas, m = g.getTransform();
        const piece = document.createElement("canvas");
        piece.width = cv.width; piece.height = cv.height;
        const pc = piece.getContext("2d");
        pc.setTransform(m); outlinePath(pc, st.pts); pc.clip();
        pc.setTransform(1, 0, 0, 1, 0, 0); pc.drawImage(cv, 0, 0);
        g.globalCompositeOperation = "destination-out"; outlinePath(g, st.pts); g.fillStyle = "#000"; g.fill();
        g.globalCompositeOperation = "source-over";
        g.setTransform(1, 0, 0, 1, m.a * st.dx + m.c * st.dy, m.b * st.dx + m.d * st.dy);
        g.drawImage(piece, 0, 0);
    }
    g.restore();
}
let sketchCanvas = null;   // (one, used again: each drawing drawn on it, then laid on the view)
// A drawing with strokes not yet saved, kept drawn on a canvas of its own (in canvas units, over a little more than it
// reaches, so strokes made next fit on it too), laid on as the canvas is moved round or zoomed. A new stroke is drawn
// onto it, not the whole drawing again; it is made again only when a stroke goes (an undo), one falls outside it, or
// the view, still, needs it sharper than it is. Its first "upto" strokes (a stroke under way left off). False when
// the view needs it sharper than it can be kept (then drawn as it is).
const keptDrawings = new Map();   // by drawing: { canvas, k (its pixels to a canvas unit), x, y, w, h, n (strokes on it), last, merged, loaded }
function keptDrawing(ctx, o, b, doc, get, m, upto)
{
    const strokes = (o.strokes || []).slice(0, upto), last = strokes[strokes.length - 1];
    if (last && last.kind === "move" && !(o.merged || []).length)
    {
        // A selection being moved (or just moved): the drawing as it was before kept, and from it the piece lifted
        // and the place it left, each made once; the piece then only laid on where it is now, as the finger goes.
        const c = keepDrawn(o, b, doc, get, m, strokes.length - 1);
        if (!c) return false;
        let mv = c.lifted;
        if (!mv || mv.sid !== last.sid || mv.ver !== c.ver)
        {
            const W = c.canvas.width, H = c.canvas.height, at = (g) => g.setTransform(c.k, 0, 0, c.k, -c.x * c.k, -c.y * c.k);
            const piece = (mv && mv.piece) || document.createElement("canvas"), hole = (mv && mv.hole) || document.createElement("canvas");
            piece.width = hole.width = W; piece.height = hole.height = H;
            const pc = piece.getContext("2d"), hc = hole.getContext("2d");
            at(pc); outlinePath(pc, last.pts); pc.clip(); pc.setTransform(1, 0, 0, 1, 0, 0); pc.drawImage(c.canvas, 0, 0);
            hc.drawImage(c.canvas, 0, 0); at(hc); hc.globalCompositeOperation = "destination-out"; outlinePath(hc, last.pts); hc.fillStyle = "#000"; hc.fill();
            mv = c.lifted = { sid: last.sid, ver: c.ver, piece, hole };
        }
        ctx.imageSmoothingQuality = "low";
        ctx.drawImage(mv.hole, c.x, c.y, c.w, c.h);
        ctx.drawImage(mv.piece, c.x + (last.dx || 0), c.y + (last.dy || 0), c.w, c.h);
        return true;
    }
    const c = keepDrawn(o, b, doc, get, m, strokes.length);
    if (!c) return false;
    ctx.imageSmoothingQuality = "low";   // (near its own size: the quick way is as good)
    ctx.drawImage(c.canvas, c.x, c.y, c.w, c.h);
    return true;
}
// The kept drawing with its first "upto" strokes on it, made or brought up to date ("ver" counted up as it changes),
// or false.
function keepDrawn(o, b, doc, get, m, upto)
{
    const r0 = o.reach || b, need = Math.hypot(m.a, m.b);
    if (!(r0.w > 0) || !(r0.h > 0) || !(need > 0)) return false;
    const strokes = (o.strokes || []).slice(0, upto), merged = (o.merged || []).length, loaded = tilesLoaded(o, doc, get);
    const moving = smooth === "low";
    let c = keptDrawings.get(o.id);
    const inside = st => { const e = sketchItem({ strokes: [st] }); return e.x >= c.x && e.y >= c.y && e.x + e.w <= c.x + c.w && e.y + e.h <= c.y + c.h; };
    const same = c && c.file === o.file && c.merged === merged && c.loaded === loaded && c.n <= strokes.length && (c.n === 0 || (strokes[c.n - 1] && strokeKey(strokes[c.n - 1]) === c.last)) && strokes.slice(c.n).every(inside);
    const sharp = c && (moving || c.k >= Math.min(need, c.most) * 0.99);
    if (!same || !sharp)
    {
        const pad = Math.max(r0.w, r0.h) * 0.35 + 200 / need, r = { x: r0.x - pad, y: r0.y - pad, w: r0.w + 2 * pad, h: r0.h + 2 * pad };
        const most = Math.min(4096 / Math.max(r.w, r.h), Math.sqrt(8e6 / (r.w * r.h)));
        if (most < need * 0.5 && !moving) return false;   // (too big to keep as sharp as it is shown: drawn as it is)
        const k = Math.min(most, need * 1.25);   // (a little sharper than shown, to be zoomed into a little)
        if (!c) { c = { canvas: document.createElement("canvas"), ver: 0 }; keptDrawings.set(o.id, c); if (keptDrawings.size > 2) keptDrawings.delete(keptDrawings.keys().next().value); }
        const W = Math.max(1, Math.ceil(r.w * k)), H = Math.max(1, Math.ceil(r.h * k));
        c.canvas.width = W; c.canvas.height = H;
        const d = c.canvas.getContext("2d");
        d.setTransform(k, 0, 0, k, -r.x * k, -r.y * k);
        drawingInto(d, o, b, doc, get, strokes.length);
        Object.assign(c, { k, most, file: o.file, x: r.x, y: r.y, w: W / k, h: H / k, n: strokes.length, merged, loaded });
        c.ver++;
    }
    else if (c.n < strokes.length)
    {
        const d = c.canvas.getContext("2d");
        d.setTransform(c.k, 0, 0, c.k, -c.x * c.k, -c.y * c.k); d.globalAlpha = 1; d.globalCompositeOperation = "source-over";
        drawStrokes(d, strokes.slice(c.n));   // (only the new ones)
        c.n = strokes.length;
        c.ver++;
    }
    c.last = strokes.length ? strokeKey(strokes[strokes.length - 1]) : "";
    return c;
}
// A stroke as it is now: its id, and what can still change while it is under way (a selection being moved: how far;
// its points, as they come), so one kept drawn is drawn again once it has changed.
export function strokeKey(st) { return st.sid + ":" + (st.dx || 0) + "," + (st.dy || 0) + ":" + (st.pts ? st.pts.length : 0); }
// How many of a drawing's tiles (and those of any merged into it) have been read so far: a drawing kept before they
// all were is made again as more come.
function tilesLoaded(o, doc, get)
{
    if (o.kind !== "paint") return 0;
    let n = 0;
    for (const one of [o].concat(o.merged || [])) for (const t of tilesOf(doc, one.file)) if (get(t.file)) n++;
    return n;
}
// A drawing made here, or a saved one with what is drawn on it here: its pixels, any drawing merged into it, and its
// first "upto" strokes (onto "g", set to canvas units).
function drawingInto(g, o, b, doc, get, upto)
{
    if (o.kind === "sketch") { drawStrokes(g, o.strokes.slice(0, upto)); return; }
    for (const one of [o].concat(o.merged || []))
    {
        g.save();
        g.globalAlpha = one === o ? 1 : Math.max(0, Math.min(1, one.opacity === undefined ? 1 : one.opacity));
        paintTiles(g, one, one === o ? b : box(one, g), doc, get);
        g.restore();
        if (one.strokes) drawStrokes(g, one === o ? one.strokes.slice(0, upto) : one.strokes);
    }
}

// A drawing layer's tiles, drawn into its box: its frame (the pixels it was saved with) fills it.
function paintTiles(ctx, o, b, doc, get)
{
    const tiles = tilesOf(doc, o.file);
    if (tiles.length === 0 || !(b.w > 0) || !(b.h > 0)) return;
    let a = o.frame && o.frame.w > 0 ? o.frame : null;
    if (!a)
    {
        // (an older file: what its tiles cover)
        const cs = tiles.map(t => t.c), rs = tiles.map(t => t.r);
        a = { x: Math.min(...cs) * T, y: Math.min(...rs) * T, w: (Math.max(...cs) - Math.min(...cs) + 1) * T, h: (Math.max(...rs) - Math.min(...rs) + 1) * T };
    }
    const sx = b.w / a.w, sy = b.h / a.h;
    ctx.transform(sx, 0, 0, sy, b.x - a.x * sx, b.y - a.y * sy);
    ctx.imageSmoothingQuality = smooth;
    for (const t of tiles) { const got = get(t.file); if (got) ctx.drawImage(got.img, t.c * T, t.r * T, T, T); }
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

function stroke(ctx, o, path)
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
}

function drawOne(ctx, o, doc, s, get, redraw, wet)
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
            const img = got.img, kx = got.src ? img.width / got.src.w : got.k, ky = got.src ? img.height / got.src.h : got.k;
            flip(ctx, o, b);
            ctx.imageSmoothingQuality = smooth;
            // The crop on the copy, kept inside it: Safari draws nothing at all for a part reaching past the picture's
            // edge, which a copy rounded to whole pixels can by a fraction of one.
            const sx = Math.max(0, o.cx * kx), sy = Math.max(0, o.cy * ky);
            const sw = Math.min((o.cw > 0 ? o.cw * kx : img.width), img.width - sx), sh = Math.min((o.ch > 0 ? o.ch * ky : img.height), img.height - sy);
            if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, b.x, b.y, b.w, b.h);
            return;
        }
        case "sketch":
        case "paint":
        {
            if (o.kind === "paint" && (!(b.w > 0) || !(b.h > 0)) && !o.strokes) return;   // (a drawing of no size: nothing, unless strokes are drawn on it here)
            if (o.kind === "paint" && !o.strokes && !o.merged) { paintTiles(ctx, o, b, doc, get); return; }
            // Strokes not yet saved (a drawing made here, or strokes on a saved one), or a drawing merged into it: drawn
            // together on a canvas of their own the view's size (so the eraser rubs out its pixels too, and nothing
            // else), then laid on.
            const m = ctx.getTransform(), cv = ctx.canvas;
            const strokes = o.strokes || [], wi = wet ? strokes.indexOf(wet) : -1;
            const straight = !o.angle && !o.shear && !o.flipX && !o.flipY;
            if (!(wi >= 0 && wi === strokes.length - 1) && straight && keptDrawing(ctx, o, b, doc, get, m, strokes.length)) return;   // (kept: laid on)
            if (!sketchCanvas) sketchCanvas = document.createElement("canvas");
            if (sketchCanvas.width !== cv.width || sketchCanvas.height !== cv.height) { sketchCanvas.width = cv.width; sketchCanvas.height = cv.height; }
            const g = sketchCanvas.getContext("2d");
            g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
            // A stroke being drawn, the last on it: all the rest kept drawn as they are (made again only when they or
            // the view change), and only that stroke drawn on them each time, so a stroke is as quick as the first
            // however many come before it.
            if (wi >= 0 && wi === strokes.length - 1)
            {
                g.setTransform(m);
                if (!(straight && keptDrawing(g, o, b, doc, get, m, wi))) drawingInto(g, o, b, doc, get, wi);
                if (wet.kind === "pen" || wet.kind === "flat" || wet.kind === "erase") drawWet(g, wet, m);
                else { g.setTransform(m); drawStrokes(g, [wet]); }
            }
            else { g.setTransform(m); drawingInto(g, o, b, doc, get, strokes.length); }
            ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(sketchCanvas, 0, 0); ctx.restore();
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
            stroke(ctx, o, p);
            return;
        }
        case "line": case "arrow":
        {
            const p = new Path2D();
            p.moveTo(o.ax, o.ay); p.lineTo(o.bx, o.by);
            const c = { ...o, stroke: o.stroke || o.fill, place: 0 };
            stroke(ctx, c, p);
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
            stroke(ctx, o, p);
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
    // (laid out once for each list as the steps leave it, which is never changed after: the same one again, at once;
    // a copy of it, as more steps are done, checked by what it shows)
    if (o._layout && o._layout.of === o && o._layout.rows === o.rows) return o._layout;
    const key = o.w + "|" + o.name + "|" + o.showDone + "|" + o.rows.map(r => r.kind + r.done + r.text + (r.link ? 1 : 0)).join("\u0001");
    if (o._layout && o._layout.key === key) return o._layout = { ...o._layout, of: o, rows: o.rows };
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
    o._layout = { key, title, entries, h: y + 10, of: o, rows: o.rows };
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
        if (hidden(sc, o) || (o.clip && sc.masks.get(o.group) === o) || o.kind === "sketch") continue;   // (a drawing made here: not picked until saved)
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
