// Saving: the steps written back into the file (a newer copy of it read first, if someone saved meanwhile), and kept
// on this phone until then; the drawings painted into tiles for it; undoing past a save; photos kept until saved.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import * as off from "./offline.js";
import * as render from "./render.js";
import { act, app, current, editing, failed, icon, onPicture, open, project, redos, redrawViewers, refreshView, setOpen, setProblem, sheetOpen, show, text, toast, undoable, undos } from "./app.js";
import { redrawEntries } from "./lists.js";
import { pen } from "./drawing.js";

// The drawings made here, painted into tiles as Board keeps a drawing layer's pixels (cnpy.TILE square, at cnpy.DENSITY
// to a unit, from the canvas's corner), for the file: tiles with nothing on them left out. Strokes on a saved drawing
// are painted onto its own pixels, in its own pixels' size and place, into a folder of its own (so the old tiles,
// held by the pictures already drawn, never stand in for the new).
async function paintSketches(view, doc)
{
    const out = [], D = cnpy.DENSITY;
    for (const k of view.sketches || [])
    {
        if (k.base) continue;   // (painted with the drawing it is on, below)
        const it = render.sketchItem(k);
        if (it.w <= 0 || it.h <= 0) continue;
        const fx0 = Math.floor(it.x * D), fy0 = Math.floor(it.y * D), fx1 = Math.ceil((it.x + it.w) * D), fy1 = Math.ceil((it.y + it.h) * D);
        await render.fillsDecoded(k.strokes);
        const tiles = await paintTiles({ x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 }, (g, ox, oy) => { g.setTransform(D, 0, 0, D, -ox, -oy); render.drawStrokes(g, k.strokes); });
        if (tiles.size) out.push({ id: k.id, name: k.name, layer: k.layer, author: k.author, frame: { x: fx0, y: fy0, w: fx1 - fx0, h: fy1 - fy0 }, tiles });
    }
    // Saved drawings drawn on here, or with others merged into them: painted again.
    const again = new Set((view.sketches || []).filter(k => k.base).map(k => k.base).concat((view.merges || []).map(m => m.into), [...(view.unsaved || new Map()).keys()]));
    for (const m of view.merges || []) again.delete(m.id);   // (one merged down goes with the one it went into)
    if (doc) for (const id of again) { const done = await repaint(doc, view, id); if (done) out.push(done); }
    return out;
}
// A drawing's pixels over "frame" (in its pixels) made into tiles as Board keeps them, "draw" painting them with its
// pixel (ox, oy) at the top-left: all at once on one canvas (so paint moved from one tile to another goes with it), or,
// for one too big for that, a tile at a time. Tiles left empty are left out.
async function paintTiles(frame, draw)
{
    const T = cnpy.TILE, tiles = new Map();
    const c0 = Math.floor(frame.x / T), r0 = Math.floor(frame.y / T), c1 = Math.floor((frame.x + frame.w - 1) / T), r1 = Math.floor((frame.y + frame.h - 1) / T);
    const whole = (c1 - c0 + 1) * (r1 - r0 + 1) * T * T <= 16e6;   // (a phone's browser makes no bigger canvas: Safari's limit)
    let all = null, ag = null;
    if (whole)
    {
        all = document.createElement("canvas");
        all.width = (c1 - c0 + 1) * T; all.height = (r1 - r0 + 1) * T;
        ag = all.getContext("2d", { willReadFrequently: true });
        draw(ag, c0 * T, r0 * T);
    }
    for (let r = r0; r <= r1; r++)
        for (let c = c0; c <= c1; c++)
        {
            const cv = document.createElement("canvas");
            cv.width = cv.height = T;
            const g = cv.getContext("2d", { willReadFrequently: true });
            if (whole) g.drawImage(all, (c - c0) * T, (r - r0) * T, T, T, 0, 0, T, T);
            else draw(g, c * T, r * T);
            const px = g.getImageData(0, 0, T, T).data;
            let any = false;
            for (let i = 3; i < px.length && !any; i += 4) any = px[i] > 0;
            if (!any) { cv.width = cv.height = 0; continue; }
            const blob = await new Promise(ok => cv.toBlob(ok, "image/png"));
            cv.width = cv.height = 0;   // (let go at once: a phone's browser allows only so much canvas)
            tiles.set(c + "_" + r + ".png", new Uint8Array(await blob.arrayBuffer()));
        }
    if (all) all.width = all.height = 0;
    return tiles;
}
// A saved drawing painted again: its tiles read back, then its strokes since it was saved, then any drawings merged
// down into it (their tiles and strokes, at their opacity), all in its own pixels (its frame is its box), over the area
// of them all. Its box and frame grow together, so what was there stays where it was.
async function repaint(doc, view, id)
{
    const T = cnpy.TILE, own = x => view.moved.has(x.id) ? cnpy.placed(x, view.moved.get(x.id)) : x;
    const doc0 = doc.items.find(x => x.id === id);
    if (!doc0 || doc0.kind !== "paint" || view.removed.has(doc0.id)) return null;
    // (undone past its save: painted again from its pixels before it, kept with the steps, not the file's)
    const snap = view.unsaved && view.unsaved.get(id), kept = new Map(snap ? snap.files : []);
    if (snap) render.keepSnap(snap);
    const o = snap ? { ...doc0, file: snap.file, frame: snap.frame, ...snap.box } : doc0;
    if (snap && snap.isNew)
    {
        // A drawing made in that save: nothing of it before, only its strokes put back: its pixels as a new one's.
        const k = (view.sketches || []).find(q => q.base === id);
        if (!k || !k.strokes.length) return null;
        const it = render.sketchItem(k), D = cnpy.DENSITY;
        o.frame = { x: Math.floor(it.x * D), y: Math.floor(it.y * D), w: Math.max(1, Math.ceil(it.w * D)), h: Math.max(1, Math.ceil(it.h * D)) };
        Object.assign(o, { x: o.frame.x / D, y: o.frame.y / D, w: o.frame.w / D, h: o.frame.h / D });
    }
    const area = x =>
    {
        // Its pixels' rectangle (its frame; or, in an older file, what its tiles cover), and its box on the canvas.
        const tiles = render.tilesOf(doc, x.file);
        let a = x.frame && x.frame.w > 0 ? x.frame : null;
        if (!a && tiles.length) { const cs = tiles.map(t => t.c), rs = tiles.map(t => t.r); a = { x: Math.min(...cs) * T, y: Math.min(...rs) * T, w: (Math.max(...cs) - Math.min(...cs) + 1) * T, h: (Math.max(...rs) - Math.min(...rs) + 1) * T }; }
        const b = x === o && snap ? (view.moved.has(x.id) ? cnpy.placed(x, view.moved.get(x.id)) : x) : own(x);
        return a && b.w > 0 && b.h > 0 ? { x, a, b, sx: b.w / a.w, sy: b.h / a.h, tiles } : null;
    };
    const me = area(o);
    if (!me) return null;
    const strokesOf = x => { const k = (view.sketches || []).find(q => q.base === x); return k ? k.strokes : []; };
    // What goes in, in order: it, then those merged into it.
    const layers = [{ ...me, strokes: strokesOf(o.id), alpha: 1 }];
    for (const m of view.merges || []) if (m.into === o.id) { const up = doc.items.find(x => x.id === m.id), u = up && area(up); if (u) layers.push({ ...u, strokes: strokesOf(up.id), alpha: up.opacity === undefined ? 1 : up.opacity }); }
    // The area of them all, in its pixels.
    const toPx = (cx, cy) => ({ x: me.a.x + (cx - me.b.x) / me.sx, y: me.a.y + (cy - me.b.y) / me.sy });
    let px0 = me.a.x, py0 = me.a.y, px1 = me.a.x + me.a.w, py1 = me.a.y + me.a.h;
    const grow = (cx, cy, cw, ch) => { const p = toPx(cx, cy), q = toPx(cx + cw, cy + ch); px0 = Math.min(px0, p.x); py0 = Math.min(py0, p.y); px1 = Math.max(px1, q.x); py1 = Math.max(py1, q.y); };
    for (const l of layers)
    {
        if (l !== layers[0]) grow(l.b.x, l.b.y, l.b.w, l.b.h);
        if (l.strokes.length) { const k = render.sketchItem({ strokes: l.strokes }); grow(k.x, k.y, k.w, k.h); }
    }
    px0 = Math.floor(px0); py0 = Math.floor(py0); px1 = Math.ceil(px1); py1 = Math.ceil(py1);
    // Every tile of them read first (the painting itself is done in one go).
    const images = new Map();
    let tiles;
    try
    {
        for (const l of layers) { for (const t of l.tiles) if (!images.has(t.file)) images.set(t.file, await createImageBitmap(kept.has(t.file) ? new Blob([kept.get(t.file)]) : await doc.zip.file(t.file).async("blob"))); await render.fillsDecoded(l.strokes); }
        tiles = await paintTiles({ x: px0, y: py0, w: px1 - px0, h: py1 - py0 }, (g, ox, oy) =>
        {
            for (const l of layers)
            {
                // Its tiles, from its pixels to these (through the canvas), then its strokes, from the canvas.
                g.globalAlpha = l.alpha;
                g.setTransform(l.sx / me.sx, 0, 0, l.sy / me.sy, me.a.x + (l.b.x - l.a.x * l.sx - me.b.x) / me.sx - ox, me.a.y + (l.b.y - l.a.y * l.sy - me.b.y) / me.sy - oy);
                for (const t of l.tiles) g.drawImage(images.get(t.file), t.c * T, t.r * T);
                g.globalAlpha = 1;
                g.setTransform(1 / me.sx, 0, 0, 1 / me.sy, me.a.x - me.b.x / me.sx - ox, me.a.y - me.b.y / me.sy - oy);
                render.drawStrokes(g, l.strokes);
            }
        });
    }
    finally { for (const img of images.values()) img.close(); }
    const frame = { x: px0, y: py0, w: px1 - px0, h: py1 - py0 };
    const box = { x: me.b.x + (frame.x - me.a.x) * me.sx, y: me.b.y + (frame.y - me.a.y) * me.sy, w: frame.w * me.sx, h: frame.h * me.sy };
    return { id: o.id, base: true, name: o.name, folder: o.id + "." + cnpy.newId().slice(0, 6) + "/", old: doc0.file, drop: layers.slice(1).map(l => l.x.file), frame, box, tiles };
}

// Everything done here saved (a save under way waited for, then another made if there is more), or false if it couldn't be.
export async function savedNow(p)
{
    for (let tries = 0; tries < 40 && project === p; tries++)
    {
        if (!p.steps.length) return true;
        if (saving) { await new Promise(ok => setTimeout(ok, 150)); continue; }
        clearTimeout(saveTimer);
        await save();
        if (p.steps.length && state === "waiting") return false;
    }
    return project === p && !p.steps.length;
}

// ---- saving: what is done here kept as steps, written back on top of whatever the file now is ----

export let saving = false, saveTimer = null, state = "saved", stateWhy = "", stateWhere = "";   // (where: the code that failed, file and line, said when the warning is tapped)

export function statusHtml()
{
    if (!project) return "";
    if (project.local) return '<button class="icon status" data-do="copy" aria-label="Save a copy" title="Save a copy">' + icon("download") + "</button>";
    // A round mark: a tick once saved (lit as a save lands), a still ring while changes wait to be saved, turning only
    // while a save is under way, a warning while it can't be.
    // While drawing, changes aren't saved as they come (only at Done): said so plainly, a lit button that saves them now.
    const held = state === "pending" && !!pen;
    const words = held ? "Not saved while drawing: tap to save" : { saved: "Saved", pending: "Changes to save", saving: "Saving", waiting: "Not saved yet" + (stateWhy ? ": " + stateWhy : ""), updated: "Updated from Dropbox" }[state] || "";
    const mark = held ? "tosave" : state === "saving" || state === "pending" ? "saving" : state === "waiting" ? "waiting" : "saved";
    return '<button class="icon status ' + state + (held ? " held" : "") + (landed ? " landed" : "") + '" data-do="refresh" aria-label="' + text(words) + '" title="' + text(words) + '">' + icon(mark) + "</button>";   // (tapped: saved now, and checked for changes)
}
let landed = false;   // a save just landed: the tick lit for a moment
export function setState(s, why)
{
    landed = state === "saving" && (s === "saved" || s === "updated");
    state = s; stateWhy = why || ""; stateWhere = "";
    app.querySelectorAll(".status").forEach(at => { at.outerHTML = statusHtml(); });
    app.querySelectorAll(".status").forEach(at => at.addEventListener("click", () => act(at.dataset.do)));
}

export function changed()
{
    keepSteps();
    undoable();
    redrawViewers();
    if (project.local) return;
    if (state !== "saving") setState("pending");
    clearTimeout(saveTimer);
    // (drawing: saved at Done, not while drawing goes on: a save writes the whole project again, which on a phone
    // can hold everything up; the strokes are kept on the phone meanwhile)
    if (!pen) saveTimer = setTimeout(save, 900);
}
// The steps not yet saved, kept on this phone (in case the page is closed first): written once things pause, not after
// every stroke (a long run of strokes is a lot to write), and at once when the page is put away.
let keepTimer = null;
export function keepSteps() { clearTimeout(keepTimer); keepTimer = setTimeout(keepNow, 1500); }
let keepWarned = false;
export function keepNow()
{
    clearTimeout(keepTimer); keepTimer = null;
    if (!project || project.local) return;
    off.keepSteps(project.path, project.steps.slice()).then(ok => { if (!ok && !keepWarned) { keepWarned = true; toast("This phone's storage is full: changes not yet saved aren't kept on it"); } });
}
addEventListener("pagehide", keepNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) keepNow(); });

let saveAgain = false, retryIn = 8000;
export async function save()
{
    if (!project || project.local || project.steps.length === 0) return;
    if (saving) { saveAgain = true; return; }   // (again once the one under way is done: it may be another project's)
    if (navigator.onLine === false) { setState("waiting", "no connection; kept on this phone"); return; }   // (saved once there is one: the "online" event)
    saving = true;
    const p = project;
    setState("saving");
    try
    {
        await photosReady(p);
        for (let tries = 0; tries < 5; tries++)
        {
            const n = p.steps.length;
            const upto = cnpy.apply(p.base.doc, p.steps.slice(0, n));
            const before = await drawingsBefore(p.base.doc, upto);
            const bytes = await cnpy.save(p.base.doc, upto, p.pictures, await paintSketches(upto, p.base.doc));
            let rev = null;
            try { rev = await dbx.write(p.path, bytes, p.base.rev); }
            catch (e)
            {
                if (!(e instanceof dbx.Conflict)) throw e;
                // Someone saved it meanwhile: theirs read, and these steps done again on top of it. Unless it is this
                // very save, landed before (its answer lost on the way back): then it is saved.
                const got = await dbx.read(p.path);
                if (sameBytes(got.bytes, bytes)) rev = got.rev;
                else { await rebase(p, got.bytes, got.rev); continue; }
            }
            await rebase(p, bytes, rev);
            if (off.has(p.path)) off.keep(p.path, bytes, rev).catch(() => { });
            p.steps = p.steps.slice(n);
            off.keepSteps(p.path, p.steps.slice());   // (at once, whichever project is open now: none of these done again)
            if (p === project) undoPastSave(before);
            break;
        }
        retryIn = 8000;
        if (p !== project) return;
        refreshView();
        forgetPhotos(p);
        setProblem("");
        setState(project.steps.length ? "pending" : "saved");
        if (project.steps.length && !pen) saveTimer = setTimeout(save, 400);
        if (!editing && !sheetOpen()) show(); else { redrawViewers(); if (sheetOpen()) redrawEntries(); }
    }
    catch (e)
    {
        if (e instanceof dbx.SignedOut) return failed(e);
        if (p !== project) return;
        setState("waiting", e instanceof dbx.Offline ? "no connection; kept on this phone" : e.message);   // (kept here, and tried again)
        stateWhere = e instanceof dbx.Offline ? "" : String(e.stack || "").split("\n").map(l => (l.match(/(\w+\.js):(\d+)/) || [])[0]).filter(Boolean).slice(0, 3).join(", ");
        clearTimeout(saveTimer);
        // (tried again a while later, and less often each time; not while drawing, nor with no connection at all)
        if (!pen && !(e instanceof dbx.Offline && navigator.onLine === false)) saveTimer = setTimeout(save, retryIn);
        retryIn = Math.min(retryIn * 2, 120000);
    }
    finally
    {
        saving = false;
        if (saveAgain) { saveAgain = false; if (project && project.steps.length && !pen) setTimeout(save, 0); }
    }
}
// ---- undoing past a save: each drawing saved kept as it was before (its pixels then, and the strokes the save painted
// in), so the strokes can be undone one by one still: the drawing shown as it was, the strokes before the one undone put
// back on it. For as long as the project is open; at most a few saves back, so the phone isn't filled ----

const SAVED_MOST = { saves: 10, bytes: 50e6 };
let savedBack = [];   // { D (the drawing), snap, sketch (its strokes' drawing: id, name, layer, author), strokes, bytes, gone }
export function forgetSaves() { savedBack = []; }   // (another project opened)
// What each drawing drawn on is before this save, from the file as it is (or as it was shown, if undone past one).
async function drawingsBefore(doc, view)
{
    const out = [];
    if (view.merges && view.merges.length) return out;   // (a drawing merged down saved: not undone past)
    for (const k of view.sketches || [])
    {
        const D = k.base || k.id, tag = cnpy.newId();
        let snap = view.unsaved && view.unsaved.get(D);
        if (!snap && k.base)
        {
            const o = doc.items.find(x => x.id === D);
            if (!o || o.kind !== "paint") continue;
            const at = view.moved.has(D) ? cnpy.placed(o, view.moved.get(D)) : o, tiles = render.tilesOf(doc, o.file), files = [];
            for (const t of tiles) { const f = doc.zip.file(t.file); if (f) files.push([t.file, await f.async("uint8array")]); }
            snap = { tag, file: o.file, frame: o.frame, box: { x: at.x, y: at.y, w: at.w, h: at.h }, tiles, files };
        }
        if (!snap) snap = { tag, isNew: true, file: "\u0000none/", frame: null, box: { x: 0, y: 0, w: 0, h: 0 }, tiles: [], files: [] };   // (made in this save: nothing of it before)
        out.push({ D, snap, sketch: { id: k.id, name: k.name, layer: k.layer, author: k.author }, strokes: k.strokes.slice(), bytes: snap.files.reduce((a, f) => a + f[1].byteLength, 0) });
    }
    return out;
}
// The save landed: its strokes' undoing turned into undoing past it (and doing them again, onto the saved drawing).
function undoPastSave(before)
{
    for (const h of before)
    {
        savedBack.push(h);
        const sids = new Set(h.strokes.map(st => st.sid));
        for (let i = 0; i < undos.length; i++) { const e = undos[i]; if (e.length === 1 && e[0].t === "unstroke" && e[0].id === h.sketch.id && sids.has(e[0].sid)) undos[i] = { saved: h, sid: e[0].sid }; }
        for (const e of redos) for (const x of e) if (x.t === "stroke" && x.id === h.sketch.id && !x.base) x.base = h.D;   // (a stroke undone before the save, done again: onto it, now saved)
    }
    // (the oldest let go past a few saves, or so much of the phone's memory)
    let total = savedBack.reduce((a, h) => a + h.bytes, 0);
    while (savedBack.length > SAVED_MOST.saves || total > SAVED_MOST.bytes) { const h = savedBack.shift(); h.gone = true; total -= h.bytes; }
}
// An undoing past a save, as the steps it takes now: just the stroke taken off, if the drawing shows as it was before
// that save already; else the drawing shown as it was, and the strokes before this one put back.
export function pastSave(e)
{
    const h = e.saved;
    if (h.gone) return [];
    const now = project.view.unsaved && project.view.unsaved.get(h.D);
    if (now && now.tag === h.snap.tag) return [{ t: "unstroke", list: null, id: h.sketch.id, sid: e.sid }];
    const at = h.strokes.findIndex(st => st.sid === e.sid);
    return [{ t: "unsave", list: null, id: h.D, snap: h.snap }].concat(h.strokes.slice(0, Math.max(0, at)).map(st => ({ t: "stroke", list: null, id: h.sketch.id, base: h.D, name: h.sketch.name, layer: h.sketch.layer, author: h.sketch.author, stroke: st })));
}
function sameBytes(a, b) { if (!a || !b || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
async function rebase(p, bytes, rev)
{
    p.base = { doc: await cnpy.open(bytes), rev };
    p.get = render.pictures(p.base.doc, p.pictures, onPicture, p.cache);
}

// A newer version saved elsewhere, read in (only with nothing of ours waiting: that goes through saving).
export async function catchUp(quiet)
{
    if (!project || project.local || saving || editing || sheetOpen() || project.steps.length) return;
    const p = project;
    try
    {
        const rev = await dbx.version(p.path);
        if (rev === p.base.rev) { if (!quiet) setState("saved"); return; }
        const got = await dbx.read(p.path);
        if (p !== project || editing || sheetOpen() || project.steps.length) return;
        await rebase(p, got.bytes, got.rev);
        if (off.has(p.path)) off.keep(p.path, got.bytes, got.rev).catch(() => { });
        refreshView();
        if (open && open.kind === "list" && !current()) setOpen(null);
        show();
        setState("updated");
        setTimeout(() => { if (state === "updated") setState("saved"); }, 2500);
    }
    catch (e) { if (e instanceof dbx.SignedOut) failed(e); }
}
setInterval(() => catchUp(true), 20000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { catchUp(true); save(); } });
window.addEventListener("online", () => { if (!pen) save(); });   // (drawing: saved at Done)

// ---- photos: kept on the phone (in its own storage) until they are saved into the file ----

const DB = "canopy-photos";
function store() { return new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
export async function keepPhoto(file, bytes) { try { const db = await store(); db.transaction("photos", "readwrite").objectStore("photos").put(bytes, file); } catch (e) { } }
async function photoBytes(file) { try { const db = await store(); return await new Promise(ok => { const r = db.transaction("photos").objectStore("photos").get(file); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch (e) { return null; } }
// The pictures the steps add (photos, and pictures pasted from another project) that the file doesn't have yet.
function stepPictures(p) { return p.steps.flatMap(s => s.t === "photo" ? [s.photo.file] : s.t === "restore" ? s.things.map(cnpy.fileOf).filter(f => f && f.kind === "image").map(f => f.file) : []).filter(f => !p.base.doc.zip.file(f)); }
export async function photosReady(p) { for (const f of stepPictures(p)) if (!p.pictures.has(f)) { const b = await photoBytes(f); if (b) p.pictures.set(f, b); } }
function forgetPhotos(p)
{
    // Saved into the file: no longer kept on the phone.
    const waiting = new Set(stepPictures(p));
    for (const f of [...p.pictures.keys()]) if (!waiting.has(f) && p.base.doc.zip.file(f)) { p.pictures.delete(f); store().then(db => db.transaction("photos", "readwrite").objectStore("photos").delete(f)).catch(() => { }); }
}

export async function saveCopy()
{
    const bytes = await cnpy.save(project.base.doc, project.view, project.pictures, await paintSketches(project.view, project.base.doc));
    const blob = new Blob([bytes], { type: "application/octet-stream" }), name = project.name + ".cnpy";
    if (navigator.canShare && navigator.canShare({ files: [new File([blob], name)] })) { try { await navigator.share({ files: [new File([blob], name)] }); return; } catch (e) { if (e.name === "AbortError") return; } }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
