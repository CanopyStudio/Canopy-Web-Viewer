// The hierarchy: the project's layers and what is in each, topmost first, as Board's Layers panel has them. A row
// picks its object (and goes to it); while drawing, a drawing's row is the one drawn on. Each shows and hides, locks
// and unlocks; held by its handle it goes above another, into that one's layer; its menu renames, duplicates,
// deletes, and merges a drawing down into the one below.

import * as cnpy from "./cnpy.js";
import * as render from "./render.js";
import { boardView, canvasView, element, feel, icon, kindName, onPicture, pick, picked, project, redrawViewers, sheetUp, step, text, toast, tools } from "./app.js";
import { drawMode, drawOnto, pen } from "./drawing.js";
import { savedNow } from "./saving.js";

const foldedLayers = new Set();
function layerLocked(id) { const doc = project.base.doc, v = project.view; return (doc.locks.has(id) && !v.unlocked.has(id)) || v.relocked.has(id); }
export function hierarchyModel()
{
    const doc = project.base.doc, sc = project.scene, inDoc = new Set(doc.items.map(o => o.id));
    const names = new Map(doc.empties.concat(project.view.newLayers || []).map(e => [e.id, e.name]));
    const layers = [], byLayer = new Map();
    const layerOfItem = o =>
    {
        const id = o.group ? o.group.split("/")[0] : null;
        if (id && (doc.folders.has(id) || names.has(id))) { if (!names.has(id)) names.set(id, (o.groupName || "").split("\u001f")[0] || "Layer"); return id; }
        return null;
    };
    for (const o of sc.items.slice().reverse())
    {
        const id = layerOfItem(o);
        if (!byLayer.has(id)) { byLayer.set(id, []); layers.push(id); }
        byLayer.get(id).push(o);
    }
    for (const e of (project.view.newLayers || []).slice().reverse()) if (!byLayer.has(e.id)) { byLayer.set(e.id, []); layers.unshift(e.id); }   // (made here: on top)
    for (const e of doc.empties) if (!byLayer.has(e.id)) { byLayer.set(e.id, []); layers.push(e.id); }
    const gone = project.view.droppedLayers || new Set();
    for (let i = layers.length - 1; i >= 0; i--) if (gone.has(layers[i]) && !byLayer.get(layers[i]).length) layers.splice(i, 1);
    return { layers: layers.map(id => ({ id, name: id ? names.get(id) || "Layer" : "No layer", items: byLayer.get(id) })), inDoc };
}
// An object's name in the hierarchy: a drawing with strokes not yet saved marked * (as Board marks what is unsaved).
function objectName(o) { return (o.name || kindName(o.id)) + (o.kind === "sketch" || o.strokes ? "*" : ""); }
function kindIcon(o)
{
    return { image: "photo", paint: "draw", sketch: "draw", list: "lists", rect: "kind-rect", oval: "kind-oval", line: "kind-line", arrow: "kind-arrow", path: "kind-path", type: "kind-type" }[o.kind] || "kind-rect";
}
export function hierarchy()
{
    const v = boardView || canvasView;
    if (!project) return;
    const doc = project.base.doc, shut = doc.readOnly;
    const build = () =>
    {
        const m = hierarchyModel(), drawing = !!pen;
        let h = '<div class="ptitle htitle"><span>Hierarchy</span>' + (shut ? "" : '<span class="hhead"><button class="hbtn" data-do="hnewlayer" aria-label="New layer" title="New layer">' + icon("folder", 20) + '</button><button class="hbtn" data-do="hnew" aria-label="New drawing" title="New drawing">' + icon("adddrawing", 20) + "</button></span>") + "</div><div class=\"hlist\">";
        for (const l of m.layers)
        {
            const lid = l.id || "", hid = l.id && project.scene.hides.has(l.id), lk = l.id && layerLocked(l.id), fold = foldedLayers.has(lid);
            h += '<div class="hrow hlayer' + (hid ? " off" : "") + '" data-layer="' + text(lid) + '">'
                + '<button class="hname" data-do="hfold" data-value="' + text(lid) + '">' + icon(fold ? "chevron" : "open", 16) + icon("folder", 18) + "<span>" + text(l.name) + "</span></button>"
                + (l.id && !shut ? '<button class="hbtn' + (hid ? " set" : "") + '" data-do="hlayerhide" data-value="' + text(lid) + '" aria-label="' + (hid ? "Show" : "Hide") + '">' + icon(hid ? "eyeoff" : "eye", 18) + "</button>"
                    + '<button class="hbtn' + (lk ? " set" : "") + '" data-do="hlayerlock" data-value="' + text(lid) + '" aria-label="' + (lk ? "Unlock" : "Lock") + '">' + icon("lock", 18) + "</button>"
                    + '<button class="hbtn" data-do="hlayermore" data-value="' + text(lid) + '" aria-label="More">' + icon("more", 18) + "</button>" : "")
                + "</div>";
            if (fold) continue;
            for (const o of l.items)
            {
                const own = !!o.hidden, lockd = !!o.locked, on = drawing && project.drawOn === o.id, movable = !shut && m.inDoc.has(o.id);
                h += '<div class="hrow hobj' + (own || hid ? " off" : "") + (on ? " drawn" : "") + '" data-id="' + text(o.id) + '">'
                    + (movable ? '<span class="hhandle" aria-label="Move">' + icon("handle", 18) + "</span>" : '<span class="hhandle none"></span>')
                    + '<button class="hname" data-do="hpick" data-value="' + text(o.id) + '">' + icon(kindIcon(o), 18) + "<span>" + text(objectName(o)) + "</span></button>"
                    + (o.kind !== "sketch" && !shut ? '<button class="hbtn' + (own ? " set" : "") + '" data-do="hhide" data-value="' + text(o.id) + '" aria-label="' + (own ? "Show" : "Hide") + '">' + icon(own ? "eyeoff" : "eye", 18) + "</button>"
                        + '<button class="hbtn' + (lockd ? " set" : "") + '" data-do="hlock" data-value="' + text(o.id) + '" aria-label="' + (lockd ? "Unlock" : "Lock") + '">' + icon("lock", 18) + "</button>"
                        + '<button class="hbtn" data-do="hmore" data-value="' + text(o.id) + '" aria-label="More">' + icon("more", 18) + "</button>"
                        : o.kind === "sketch" && !shut && !project.local ? '<button class="hbtn" data-do="hmore" data-value="' + text(o.id) + '" aria-label="More">' + icon("more", 18) + "</button>" : "")   // (a drawing not saved yet: merged down, its one choice)
                    + "</div>";
            }
        }
        return h + "</div>";
    };
    const sheet = sheetUp(build, (does, value, close, again) =>
    {
        const o = project.scene.items.find(x => x.id === value);
        if (does === "hfold") { if (foldedLayers.has(value)) foldedLayers.delete(value); else foldedLayers.add(value); again(); return; }
        if (does === "hnewlayer")
        {
            const doc2 = project.base.doc, taken = new Set(doc2.empties.concat(project.view.newLayers || []).map(e => e.name));
            for (const x of doc2.items) { const l = cnpy.layerOf(doc2, x); if (l) taken.add(l.name); }
            let n = 1; while (taken.has("Layer " + n)) n++;
            const top = hierarchyModel().layers.find(l => l.id);
            step({ t: "newlayer", list: null, id: cnpy.newId(), name: "Layer " + n, below: top ? top.id : null });
            again(); return;
        }
        if (does === "hnew") { drawOnto(null); if (!pen) drawMode(); else tools(v); toast("Your next stroke starts a new drawing"); close(() => { }); return; }
        if (does === "hlayerhide") { step({ t: "hidelayer", list: null, id: value, on: !project.scene.hides.has(value) }); redrawViewers(); again(); return; }
        if (does === "hlayerlock") { const lk = layerLocked(value); step(lk ? { t: "lock", list: null, ids: [], on: false, groups: [value] } : { t: "lock", list: null, ids: [], on: true, relock: [value] }); if (picked) tools(picked.viewer); redrawViewers(); again(); return; }
        if (does === "hlayermore") { const l = hierarchyModel().layers.find(x => x.id === value); if (l) close(() => layerMenu(l)); return; }
        if (!o) return;
        if (does === "hpick")
        {
            if (pen && (o.kind === "paint" || o.kind === "sketch")) { drawOnto(o.id); tools(v); toast("Drawing on " + (o.name || "this drawing")); again(); return; }
            close(() =>
            {
                if (!v) return;
                if (!pen && !shut) pick({ ids: [o.id], list: o.kind === "list" ? o.id : null }, v);
                v.fit(render.outer(o), 0.3, true);
            });
            return;
        }
        if (does === "hhide") { step({ t: "hide", list: null, ids: [o.id], on: !o.hidden }); if (picked && picked.ids.includes(o.id) && !o.hidden) pick(null, picked.viewer); redrawViewers(); again(); return; }
        if (does === "hlock") { step({ t: "lock", list: null, ids: [o.id], on: !o.locked }); if (picked) tools(picked.viewer); redrawViewers(); again(); return; }
        if (does === "hmore") close(() => objectMenu(o));
    });
    // Rows held by their handles and moved (the sheet's own pull-down kept off them).
    sheet.addEventListener("touchstart", e => { if (e.target.closest(".hhandle:not(.none)")) e.stopPropagation(); }, { capture: true, passive: true });
    sheet.addEventListener("pointerdown", e => { const hd = e.target.closest(".hhandle:not(.none)"); if (hd) { e.preventDefault(); moveRow(hd.closest(".hrow"), e, sheet); } });
}
// A row dragged by its handle: the others make room as it goes; let go, it is put just above the object below where it
// was dropped, in the layer it was dropped into (one step, undone as one).
function moveRow(row, e, sheet)
{
    const list = row.parentNode, handle = row.querySelector(".hhandle");
    const rows = () => Array.from(list.querySelectorAll(".hrow")).filter(r => r !== row);
    const startY = e.clientY, top = row.offsetTop;
    row.classList.add("lifted");
    const line = element('<div class="hdrop"></div>');
    list.appendChild(line);
    handle.setPointerCapture(e.pointerId);
    let before = null;   // the row the drop line sits above (null: at the end)
    const move = ev =>
    {
        const dy = ev.clientY - startY;
        row.style.transform = "translateY(" + dy + "px)";
        const y = top + dy + row.offsetHeight / 2;
        before = rows().find(r => r.offsetTop + r.offsetHeight / 2 > y && !(r.classList.contains("hlayer") && r === rows()[0])) || null;
        line.style.top = (before ? before.offsetTop : list.scrollHeight) - 1 + "px";
    };
    let done = false;
    const up = ev =>
    {
        if (done) return;
        done = true;
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        handle.removeEventListener("lostpointercapture", up);
        row.classList.remove("lifted"); row.style.transform = ""; line.remove();
        if (ev && ev.type !== "pointerup") return;   // (cancelled, or taken away: put back as it was)
        const all = rows(), at = before ? all.indexOf(before) : all.length;
        // Into the layer whose heading is above the line; above the first object of the file's below it.
        let layer = null;
        for (let i = at - 1; i >= 0; i--) if (all[i].classList.contains("hlayer")) { layer = all[i].dataset.layer || null; break; }
        const doc = project.base.doc, inDoc = new Set(doc.items.map(o => o.id));
        const below = all.slice(at).find(r => r.classList.contains("hobj") && inDoc.has(r.dataset.id));
        const id = row.dataset.id, o = doc.items.find(x => x.id === id);
        if (!o) return;
        const now = cnpy.layerOf(doc, o), was = cnpy.movedTo(project.view, id) || now;
        const names = new Map(doc.empties.concat(project.view.newLayers || []).map(x => [x.id, x.name]));
        for (const x of doc.items) { const l = cnpy.layerOf(doc, x); if (l) names.set(l.id, l.name); }
        const into = layer && (!was || was.id !== layer) ? { id: layer, name: names.get(layer) || "Layer" } : null;
        // (just above the one below where it was let go, which in drawing order is just after it; none: the bottom)
        step({ t: "zorder", list: null, id, after: below ? below.dataset.id : null, layer: into });
        feel.drop();
        redrawViewers();
        if (sheet.again) sheet.again();   // (drawn anew where it is)
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    handle.addEventListener("lostpointercapture", up);
}
// A layer's menu, from its row: delete it, and what is in it (one step, undone as one).
function layerMenu(l)
{
    const n = l.items.length;
    const build = () => '<div class="ptitle mtitle"><button class="hbtn" data-do="back" aria-label="Back to Hierarchy">' + icon("back", 18) + "</button><span>" + text("Layer \u00b7 " + l.name) + "</span></div>"
        + '<button class="pick danger" data-do="delete"><span>Delete</span><span class="kind-name">' + (n ? "and the " + (n === 1 ? "object" : n + " objects") + " in it" : "empty") + "</span></button>";
    sheetUp(build, (does, value, close) =>
    {
        if (does === "back") { close(() => hierarchy()); return; }
        if (does !== "delete") return;
        const ids = l.items.map(o => o.id);
        if (picked && picked.ids.some(id => ids.includes(id))) pick(null, picked.viewer);
        if (ids.includes(project.drawOn)) drawOnto(null);
        step({ t: "droplayer", list: null, id: l.id, ids });
        feel.gone();
        close(() => { redrawViewers(); hierarchy(); });
    });
}
// An object's menu, from its row: rename, duplicate, delete; a drawing's: draw on it, merge it down.
function objectMenu(o)
{
    const v = boardView || canvasView, doc = project.base.doc;
    const isPaint = (o.kind === "paint" && doc.items.some(x => x.id === o.id)) || (o.kind === "sketch" && !project.local);   // (one not saved yet: saved first, as it is merged)
    const below = isPaint ? drawingBelow(o) : null;
    const fresh = o.kind === "sketch";
    const build = () => '<div class="ptitle mtitle"><button class="hbtn" data-do="back" aria-label="Back to Hierarchy">' + icon("back", 18) + "</button><span>" + text(kindName(o.id) + " \u00b7 " + objectName(o)) + "</span></div>"
        + (fresh ? "" : '<button class="pick" data-do="rename"><span>Rename</span></button>'
        + '<button class="pick" data-do="duplicate"><span>Duplicate</span></button>')
        + (o.kind === "paint" ? '<button class="pick" data-do="drawon"><span>Draw on this drawing</span></button>' : "")
        + (isPaint ? '<button class="pick" data-do="merge"' + (below ? "" : " disabled") + "><span>Merge down</span>" + (below ? '<span class="kind-name">into ' + text(below.name || "the drawing below") + "</span>" : '<span class="kind-name">no drawing below</span>') + "</button>" : "")
        + (fresh ? "" : '<button class="pick danger" data-do="delete"><span>Delete</span></button>');
    sheetUp(build, (does, value, close) =>
    {
        if (does === "back") { close(() => hierarchy()); return; }
        if (does === "rename")
        {
            const name = prompt("Name", o.name || "");
            if (name === null || name.trim() === "" || name === o.name) return close(() => { });
            step(o.kind === "list" ? { t: "name", list: o.id, name: name.trim() } : { t: "rename", list: null, id: o.id, name: name.trim() });
            close(() => redrawViewers());
            return;
        }
        if (does === "duplicate")
        {
            const things = cnpy.copyOut(doc, project.view, [o.id]), off = 24 / ((v && v.cam.s) || 1);
            const made = cnpy.copyIn(things, doc, doc, { k: 1, ox: off, oy: off }, cnpy.layerOf(doc, o) || cnpy.topLayer(doc));
            if (!made.length) return close(() => { });
            step({ t: "restore", list: null, things: made });
            project.get = render.pictures(project.base.doc, project.pictures, onPicture, project.cache);
            close(() => { if (v && !pen) pick({ ids: made.map(th => th.id), list: made[0].list ? made[0].id : null }, v); redrawViewers(); });
            return;
        }
        if (does === "drawon") { drawOnto(o.id); close(() => { if (!pen) drawMode(); else tools(v); toast("Drawing on " + (o.name || "this drawing")); }); return; }
        if (does === "merge")
        {
            if (!below) return;
            const straight = x => !x.angle && !x.shear && !x.flipX && !x.flipY;
            if (!straight(o) || !straight(below)) { toast("A turned or flipped drawing can't be merged here"); return; }
            close(() => mergeDown(o, below));
            return;
        }
        if (does === "delete") { if (picked && picked.ids.includes(o.id)) pick(null, picked.viewer); step({ t: "delobj", list: null, ids: [o.id] }); feel.gone(); close(() => redrawViewers()); }
    });
}
// The drawing just below one, in the order they are drawn (the one a merge down goes into), or null.
function drawingBelow(o)
{
    const items = project.scene.items, at = items.findIndex(x => x.id === o.id);
    for (let i = at - 1; i >= 0; i--) if ((items[i].kind === "paint" && project.base.doc.items.some(x => x.id === items[i].id)) || (items[i].kind === "sketch" && !project.local)) return items[i];
    return null;
}
// Merged down, and saved at once: the two then one drawing in the file, so whatever is done to it next (a selection
// moved, say) is done to all of it. Anything not saved yet (either of them new, or drawn on) saved first.
async function mergeDown(o, below)
{
    const p = project, name = below.name || "the drawing below";
    if (!p.local && !(await savedNow(p))) { toast("Couldn't save, so it wasn't merged: try again once it saves"); return; }
    const doc = p.base.doc, saved = id => doc.items.some(x => x.id === id && x.kind === "paint");
    if (!saved(o.id) || !saved(below.id)) return;
    step({ t: "merge", list: null, id: o.id, into: below.id });
    if (p.drawOn === o.id) drawOnto(below.id);
    redrawViewers();
    toast("Merged into " + name);
    if (!p.local) await savedNow(p);
}
