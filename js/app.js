// Canopy Web Viewer: a Canopy Board project from Dropbox on a phone. Its lists (ticked, added to, edited, put in order,
// linked to boards and objects, and new ones made), its boards, and the whole canvas to look around, photos added to
// it from the phone. Changes are saved back as they happen.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import * as render from "./render.js";
import { Viewer, thumbnail } from "./viewer.js";
import { boardIcons } from "./icons.js";
import { themes, sizes } from "./look.js";
import { toned } from "./tone.js";
import { VERSION } from "./version.js";
import * as off from "./offline.js";
import { addPicture, changesMenu, closePicture, folded, keepOnPhone, newProject, nextPicture, picture, showFiles, showPicture } from "./files.js";
import { drag, drawLinkThumbs, finishTyping, growArea, keepInView, keyDown, listMenu, masonry, newList, oneColumn, refreshList, setOneColumn, showList, showLists, touchEntries } from "./lists.js";
import { closePop, drawBar, drawMode, drawPress, drawSelection, dropperAt, endDrawing, fillAt, paintSel, pen, penAway, popOf, selecting, selectionWith, sessionInk, shapeColors } from "./drawing.js";
import { catchUp, changed, forgetSaves, keepNow, keepPhoto, pastSave, photosReady, save, saveCopy, saveTimer, setState, state, stateWhere, stateWhy, statusHtml } from "./saving.js";
import { hierarchy } from "./hierarchy.js";

export const app = document.getElementById("app");
export const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- what is open ----

export let folder = remembered("canopy.folder", "");
export let project = null;       // { path, name, local, base: { doc, rev }, steps, view, scene, get, pictures }
let tab = remembered("canopy.tab", "lists");   // lists, boards or canvas
export let open = null;          // over the tab: { kind: "list" | "board", id }
export let arranging = false;    // a list being put in order: each entry's handle shown
export let editing = null;       // the entry being typed in: { id } or, for a new one, { fresh: true, after, kind }; or { title: true }
export let problem = "";         // what went wrong, shown until the next one
export let canvasView = null, boardView = null;   // the viewers on show
export let undos = [], redos = [];   // what undoes each change (steps), latest last; and what redoes each one undone
// Where things are, kept in the browser's history (so its back and forward, and a swipe from the edge, go through the
// folders, projects and lists opened here): { at (how far in), files (the folder on show) | project (its path), open }.
function here() { const at = history.state && history.state.at || 0; return project ? { at, project: project.path, local: project.local, open: open ? { ...open } : null } : { at, files: folder, picture: picture ? picture.path : null }; }
export function furthest() { try { return parseInt(sessionStorage.getItem("canopy.nav") || "0", 10); } catch (e) { return 0; } }
// Somewhere new: a step on in the history (anything ahead of it gone), then shown. "from": a card it grows from.
export function go(to, from)
{
    const at = (history.state && history.state.at || 0) + 1;
    history.pushState({ ...to, at }, "");
    try { sessionStorage.setItem("canopy.nav", String(at)); } catch (e) { }
    return arrive(to, from);
}
function noted() { history.replaceState(here(), ""); }   // (what is on show now, as the history has it)
// Shown as a step in the history says (gone back or forward to it, or just stepped to).
async function arrive(to, from)
{
    if (!to) to = { files: "" };
    if (to.files !== undefined)
    {
        opening++;   // (a project still opening let go)
        const same = !project && folder === to.files && app.querySelector("main.page");   // (the same folder on show: left as it is)
        if (project) leaveProject();
        folder = to.files; remember("canopy.folder", folder);
        if (!same) { window.scrollTo(0, 0); showFiles(); }
        if (to.picture) showPicture(to.picture); else if (picture) closePicture();
        return;
    }
    if (!project || project.path !== to.project)
    {
        if (to.local) return arrive({ files: folder });   // (a project from the phone can't be opened again from here)
        if (project) leaveProject();
        await openPath(to.project);
        if (!project || project.path !== to.project) return;
    }
    if (to.open && (!open || open.kind !== to.open.kind || open.id !== to.open.id))
    {
        if (open) { open = null; show(); }
        travelling = true;   // (the history has this step already)
        try { if (to.open.kind === "list") openList(to.open.id, from); else openBoard(to.open.id, from); }
        finally { travelling = false; }
    }
    else if (!to.open && open) closeOver();
}
window.addEventListener("popstate", e => { finishTyping(false, false); if (sheetOpen()) app.querySelectorAll(".picker").forEach(x => x.remove()); arrive(e.state); });
function goBack() { if ((history.state && history.state.at || 0) > 0) history.back(); else if (project) { if (open) closeOver(); else go({ files: folder }); } else if (folder !== "") go({ files: folder.split("/").slice(0, -1).join("/") }); }
function leaveProject()
{
    opening++;   // (one still opening let go)
    keepNow();   // (its steps kept on the phone, whatever becomes of the save)
    closeViewers();
    if (project && project.steps.length && !project.local) save();   // (still saving: it carries on)
    if (project && !project.steps.length) render.forget(project.cache);   // (its pictures let go)
    project = null; open = null; problem = "";
}

// The tab on show, kept for next time.
export function setTab(t) { tab = t; remember("canopy.tab", t); }
// (for the other modules, which can read these but not set them)
export function setOpen(o) { open = o; }
export function setEditing(e) { editing = e; }
export function setArranging(a) { arranging = a; }
export function setProblem(p) { problem = p; }
export function remembered(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
export function remember(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (e) { } }

// ---- the look: one of Canopy Board's themes (its colors as they are there), and its sizes, a little bigger for fingers ----

// The first theme by its order is the one a new install starts with (Midnight), as in Board; the tone (Dark, Default,
// Light) is a choice of its own, made over whichever theme it is.
const firstTheme = Object.keys(themes).sort((a, b) => themes[a].order - themes[b].order)[0];
let theme = remembered("canopy.theme", firstTheme), tone = remembered("canopy.tone", "default");
let shown;   // the theme's colors as shown, in the tone
function applyTheme(name)
{
    if (!themes[name]) name = firstTheme;
    theme = name;
    shown = toned(themes[name].colors, tone);
    render.setCanvasBack(shown.Canvas);
    const c = shown, root = document.documentElement.style, z = sizes;
    const v = { canvas: c.Canvas, chrome: c.Chrome, card: c.Card, button: c.Button, border: c.Border, ink: c.Ink, muted: c.Muted, heading: c.Heading,
        accent: c.Accent, "accent-deep": c["Accent deep"], note: c.Note, "note-row": c["Note row"], "note-edge": c["Note edge"], field: c.Field,
        "field-edge": c["Field edge"], chosen: c.Chosen, faded: c.Faded, notice: c.Notice, guide: c.Guide };
    for (const k in v) root.setProperty("--" + k, v[k]);
    // (Board's corners doubled, its type a quarter bigger: what fingers and a phone's distance need)
    root.setProperty("--r-tiny", z.RTiny * 2 + "px"); root.setProperty("--r-control", z.RControl * 2 + "px");
    root.setProperty("--r-panel", z.RPanel * 2 + "px"); root.setProperty("--r-pop", z.RPop * 2 + "px");
    for (const k of ["TextSmall", "TextMain", "TextHead", "TextTitle", "TextPage"]) root.setProperty("--" + k.replace("Text", "text-").toLowerCase(), Math.round(z[k] * 1.25) + "px");
    root.setProperty("--menu-shadow", "0 " + z.MenuShadowY + "px " + z.MenuShadowBlur + "px rgba(0,0,0," + (z.MenuShadowDark / 255).toFixed(2) + ")");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", c.Chrome);
    render.setTheme(c);
}
applyTheme(theme);

// ---- the page itself never zoomed by a pinch (the canvas, a board and a photo zoom themselves): Android takes the
// viewport's word for it; Safari ignores that, so its pinch gesture is turned down here ----
for (const g of ["gesturestart", "gesturechange"]) document.addEventListener(g, e => e.preventDefault(), { passive: false });

// ---- the page kept from scrolling while something is dragged; let go as the dragging ends, and in any case once no
// finger is on the screen (a drag whose end never came, as a phone can lose it, would otherwise leave it stuck) ----

let fingers = 0;
const stuck = new Set();   // the ends of drags going on
document.addEventListener("touchstart", e => { fingers = e.touches.length; }, { capture: true, passive: true });
const fingersUp = e => { fingers = e.touches.length; if (fingers === 0) for (const end of [...stuck]) end(); };
document.addEventListener("touchend", fingersUp, true);
document.addEventListener("touchcancel", fingersUp, true);
const noScroll = ev => ev.preventDefault();
export function holdScroll(end) { if (stuck.size === 0) document.addEventListener("touchmove", noScroll, { passive: false }); stuck.add(end); }
// Whether that drag was still going (ended now, the page free to scroll again once no other is).
export function letScroll(end) { if (!stuck.delete(end)) return false; if (stuck.size === 0) document.removeEventListener("touchmove", noScroll); return true; }
// Whether a hold (begun by "e") still has its finger down: on a touch screen, a finger must still be on it.
export function stillDown(e) { return e.pointerType !== "touch" || fingers > 0; }

// ---- feel: a soft click as things are done (it can be turned off) ----

let sound = remembered("canopy.sound", true);
let audio = null;
function click(pitch, soft)
{
    if (!sound) return;
    try
    {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === "suspended") audio.resume();
        const t = audio.currentTime, o = audio.createOscillator(), g = audio.createGain();
        o.type = "triangle";
        o.frequency.setValueAtTime(pitch, t);
        o.frequency.exponentialRampToValueAtTime(pitch * 0.55, t + 0.05);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(soft ? 0.06 : 0.14, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
        o.connect(g).connect(audio.destination);
        o.start(t); o.stop(t + 0.08);
    }
    catch (e) { }
}
export const feel = {
    tick() { click(1320); },
    untick() { click(760, true); },
    hold() { click(980, true); },
    edge() { click(620, true); },     // a swipe past where it deletes (or back)
    gone() { click(420); },
    pick() { click(1100, true); },
    drop() { click(880, true); }
};

// ---- small pieces ----

// Every icon is one of Canopy Board's own (js/icons.js, written by tools/from-board.py; icons.html shows them).
const icons = boardIcons;
export function icon(name, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + "</svg>"; }
export function text(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
export function bar(title, left, right, cls, titleDoes) { return '<header class="bar' + (cls ? " " + cls : "") + '">' + (left || "") + "<h1>" + (titleDoes ? '<button data-do="' + titleDoes + '">' + text(title) + "</button>" : text(title)) + "</h1>" + (right || "") + "</header>"; }
export function fileName(path) { return path.split("/").pop().replace(/\.cnpy$/i, ""); }
export function iconButton(does, name, label, value, off) { return '<button class="icon" data-do="' + does + '"' + (value ? ' data-value="' + text(value) + '"' : "") + (off ? " disabled" : "") + ' aria-label="' + label + '" title="' + label + '">' + icon(name) + "</button>"; }
// Undo and redo, for a bar.
export function undoButtons() { return !project || project.base.doc.readOnly ? "" : iconButton("undo", "undo", "Undo", "", !undos.length) + iconButton("redo", "redo", "Redo", "", !redos.length); }

// Behind the app, the color of whatever is along the bottom of the screen.
export function footColor()
{
    const c = shown, l = current();
    document.documentElement.style.backgroundColor = picture ? "#000" : l ? render.listLook(l).card : project ? (open ? c.Canvas : c.Chrome) : c.Canvas;
}

// ---- the files ----

let draws = 0;   // how many times a page has been drawn
export function show()
{
    draws++;
    noted();
    requestAnimationFrame(footColor);
    const inProject = !!project;
    if (inProject && !document.documentElement.classList.contains("in-project")) window.scrollTo(0, 0);
    document.documentElement.classList.toggle("in-project", inProject);   // (the page behind a project never scrolls)
    const typing = app.querySelector("textarea, input.title-edit");
    if (typing) typing.dataset.gone = "1";   // (drawn over: its blur, as it goes, is not the person leaving it)
    if (project) return showProject();
    return showFiles();
}

// The pictures of whichever project is open (it changes as the project is saved and read again).
function pictureGetter() { const g = (f, want) => project && project.get(f, want); g.begin = () => { if (project && project.get.begin) project.get.begin(); }; return g; }

// ---- a project: three tabs (its lists, its boards, the canvas), and a list or board opened over them ----

export function current() { return project && open && open.kind === "list" ? project.view.lists.find(l => l.id === open.id) : null; }
export function sortedLists()
{
    const order = project.view.order || project.base.doc.listOrder, at = new Map(order.map((id, i) => [id, i]));
    const k = l => at.has(l.id) ? at.get(l.id) : Infinity;
    return project.view.lists.slice().sort((a, b) => (k(a) - k(b)) || (a.y - b.y) || (a.x - b.x));
}

function showProject()
{
    const locked = project.base.doc.readOnly;
    // (the same bar on every tab: what + adds is the tab's; what only the canvas needs floats on it, top right: corner)
    const add = locked ? "" : tab === "lists" ? iconButton("newlist", "plus", "New list") : tab === "boards" ? iconButton("newboard", "plus", "New board") : iconButton("addmenu", "plus", "Add");
    let shell = app.querySelector(".project");
    if (!shell || shell.dataset.path !== project.path)
    {
        app.innerHTML = '<div class="project" data-path="' + text(project.path) + '"><div id="head"></div><main id="tab"></main>'
            + '<nav class="tabs">' + [["lists", "Lists"], ["boards", "Boards"], ["canvas", "Canvas"]].map(t => '<button data-do="tab" data-value="' + t[0] + '" class="tab-' + t[0] + '">' + icon(t[0]) + "<span>" + t[1] + "</span></button>").join("") + "</nav>"
            + '<div id="over"></div><input class="hidden-input" type="file" accept="image/*" id="photo-picker"></div>';
        shell = app.querySelector(".project");
        shell.querySelector("#photo-picker").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) addPhoto(f); });
        wire(shell.querySelector(".tabs"));
        shell.dataset.tab = "";
    }
    shell.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.value === tab));
    requestAnimationFrame(() => { const t = shell.querySelector(".tabs"); if (t) document.documentElement.style.setProperty("--tabs-h", t.offsetHeight + "px"); });   // (a board opened stops above them)
    const head = shell.querySelector("#head");
    head.innerHTML = bar(project.name, iconButton("files", "back", "Back"), statusHtml() + undoButtons() + add);
    wire(head);
    const holder = shell.querySelector("#tab");
    if (full && tab !== "canvas") setFull(false);
    shell.classList.toggle("full", full);
    const fresh = shell.dataset.tab !== tab;
    shell.dataset.tab = tab;
    if (tab === "lists") showLists(holder);
    else if (tab === "boards") showBoards(holder);
    else showCanvas(holder, fresh);
    if (fresh && !calm) holder.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    showOver();
    awake();
}

export function element(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function showBoards(holder)
{
    closeViewers();
    const boards = project.scene.boards;
    if (!boards.length) { holder.innerHTML = '<div class="empty big">No boards in this project yet' + (project.base.doc.readOnly ? "" : '<br><button class="quiet-button" data-do="newboard">New board</button>') + "</div>"; wire(holder); return; }
    masonry(holder, boards.map(b =>
    {
        const ratio = Math.max(0.35, Math.min(2.2, b.h / Math.max(1, b.w)));
        return { el: element('<button class="bcard" data-do="board" data-value="' + text(b.id) + '"><canvas style="aspect-ratio:' + (1 / ratio) + '"></canvas><div class="name">' + text(b.name) + "</div></button>"), weight: ratio * 2 + 0.6 };
    }));
    wire(holder);
    requestAnimationFrame(drawThumbs);
}
function drawThumbs()
{
    if (!project || tab !== "boards") return;
    const doc = project.base.doc;
    document.querySelectorAll(".bcard").forEach(el =>
    {
        const b = project.scene.boards.find(o => o.id === el.dataset.value);
        if (b) thumbnail(el.querySelector("canvas"), project.scene, b, project.get, render.back(doc));
    });
}

function showCanvas(holder, fresh)
{
    if (!canvasView || !holder.contains(canvasView.host))
    {
        closeViewers();
        holder.innerHTML = '<div class="stage"></div><div class="corner"></div>';
        canvasView = new Viewer(holder.querySelector(".stage"), () => project && project.scene, pictureGetter(), null);
        corner();
        editable(canvasView);
        canvasView.onFitAll = () => fitAll(true);
        measure(holder.querySelector(".stage"));
        if (location.hostname === "localhost") window.__view = () => canvasView;   // (for checking it on this computer)
        const cam = remembered("canopy.cam." + project.path, null);
        if (cam && fresh) { canvasView.cam = cam; canvasView.redraw(); } else fitAll(false);
    }
    else canvasView.redraw();
    corner();
}
// The measuring readout (the address ending ?measure): what drawing and the pictures cost on this phone, as it goes.
const measuring = new URLSearchParams(location.search).has("measure");
function measure(stage)
{
    if (!measuring || !stage) return;
    const box = element('<div class="measure"></div>');
    stage.appendChild(box);
    // A tap: what the picture there is, and how it was got and drawn (the readout shows it until the next tap).
    const v = canvasView && canvasView.host === stage ? canvasView : boardView;
    let about = "";
    if (v)
    {
        const tapped = v.onTap;
        v.onTap = async (x, y) =>
        {
            const o = project && render.objectAt(project.scene, x, y, 4 / v.cam.s);
            about = o ? await describe(o) : "Tapped at " + Math.round(x) + ", " + Math.round(y) + " on the canvas: nothing there";
            if (tapped) tapped(x, y);
        };
    }
    const tick = () =>
    {
        if (!box.isConnected) return;
        const st = render.stats, now = performance.now(), recent = st.draws.filter(d => now - d.at < 2000), ms = st.draws.slice(-20).map(d => d.ms);
        const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, worst = ms.length ? Math.max(...ms) : 0;
        const c = project && project.cache, seen = c ? [...c.seen.values()] : [];
        const dm = st.decodeMs.length ? st.decodeMs.reduce((a, b) => a + b, 0) / st.decodeMs.length : 0;
        const vw = canvasView || boardView, items = project ? project.scene.items : [];
        box.textContent = [
            "Drawing: " + avg.toFixed(0) + " ms average, " + worst.toFixed(0) + " ms worst (last 20), " + (recent.length / 2).toFixed(1) + " a second",
            "Pictures: " + seen.filter(e => e.img).length + " held of " + items.filter(o => o.kind === "image").length + " images and " + items.filter(o => o.kind === "paint").length + " drawings",
            "Memory: " + (c ? (c.pixels / 1e6).toFixed(1) : 0) + " of 48 megapixels; widest " + st.widest + " px",
            "Decoded " + st.decoded + " (" + dm.toFixed(0) + " ms each); waiting " + (c ? c.queue.length + c.busy : 0) + "; let go " + st.dropped + "; failed " + st.failed,
            "Small ones: " + st.previews + " from the file, " + st.kept + " kept on this phone, " + st.made + " made now",
            "On screen still to come: " + st.gaps + "; tried again " + st.retried + "; not in the file " + st.missing,
            "Too big for one piece: " + st.huge + "; came back blank: " + st.blank,
            "Zoom " + (vw ? (vw.cam.s * 100).toFixed(0) : "?") + "%, screen " + (vw ? vw.w + " \u00d7 " + vw.h + " at " + vw.dpr + "x" : "?") + (navigator.deviceMemory ? ", " + navigator.deviceMemory + " GB" : "")
        ].join("\n") + (about ? "\n\n" + about : "");
        setTimeout(tick, 500);
    };
    tick();
}
// One object, as the measuring readout tells it: where it is, and for a picture, everything about how it is shown.
async function describe(o)
{
    const n = v => Math.round(v * 10) / 10, out = [(o.kind === "image" ? "Picture" : o.kind) + " \u201c" + (o.name || "") + "\u201d at " + n(o.x) + ", " + n(o.y) + ", " + n(o.w) + " \u00d7 " + n(o.h)];
    out.push("Opacity " + (o.opacity === undefined ? 1 : o.opacity) + ", blend " + (o.blend || "normal") + (o.angle ? ", turned " + o.angle : "") + (o.flipX || o.flipY ? ", flipped" : "") + (o.hidden ? ", HIDDEN" : "") + (o.group ? ", in group " + o.group : "") + (o.clip ? ", is a clipping mask" : ""));
    if (o.kind !== "image") return out.join("\n");
    out.push("Crop " + n(o.cx) + ", " + n(o.cy) + ", " + n(o.cw) + " \u00d7 " + n(o.ch) + "; file " + o.file);
    const f = project.base.doc.zip.file(o.file), added = project.pictures.get(o.file), bytes = added || (f ? await f.async("uint8array") : null);
    out.push(bytes ? "File: " + render.kindOf(bytes) + ", " + (bytes.length / 1048576).toFixed(1) + " MB" + (project.base.doc.zip.file("previews/" + o.file + ".webp") ? "; Board's preview is in the file" : "; no preview in the file") : "File: NOT IN THE PROJECT");
    const e = project.cache.seen.get(o.file);
    if (!e) out.push("Not asked for yet");
    else if (e.none) out.push("Given up on" + (e.fails ? " after " + e.fails + " failed decodes" : " (no file)"));
    else if (!e.img) out.push("Still coming" + (e.fails ? " (" + e.fails + " failed so far)" : ""));
    else out.push("Shown from " + (e.from || "?") + ": " + e.img.width + " \u00d7 " + e.img.height + (e.src ? " of " + e.src.w + " \u00d7 " + e.src.h : "") + (e.blank ? " \u2014 BLANK" : ""));
    return out.join("\n");
}
// A board: shown on the canvas, fitted (no screen of its own).
export function focusBoard(id, glide)
{
    const b = project && project.scene.boards.find(o => o.id === id);
    if (!b) return;
    finishTyping(false, false);
    if (open || tab !== "canvas") { open = null; setTab("canvas"); show(); }
    if (canvasView) canvasView.fit(b, 0.04, glide);
}
function fitAll(glide) { if (canvasView) canvasView.fit(render.extent(project.scene), 0.06, glide); }
// ---- objects picked on the canvas (or in a board): moved by dragging, sized by a corner, deleted ----

export let picked = null;   // { ids, list (a list picked on its own: it can be opened), viewer }
let lifted = false;  // what is picked being moved or sized by a finger (drawn lifted)

function editable(v)
{
    v.onTap = (x, y) =>
    {
        // (drawing: a tap is a dot, not a pick; with Select, a pick; with Fill or the Eyedropper, theirs; a shape to
        // be drawn: not drawn after all)
        if (shaping) { shaping = null; tools(v); corner(); return; }
        if (!pen || pen.kind === "select") tapObject(v, x, y);
        else if (pen.kind === "fill") fillAt(v, v.toScreen(x, y));
        else if (pen.kind === "dropper") dropperAt(v, v.toScreen(x, y));
    };
    v.overlay = ctx => { drawPicked(v, ctx); drawSelection(v, ctx); };
    v.grab = (at, e) => shaping && v === canvasView ? shapeFrom(v, at) : pen ? drawPress(v, at, e) : grabPicked(v, at);
    v.paintOn = () => pen && !project.base.doc.readOnly ? project.drawOn || null : null;   // (the drawing drawn on: shown from the graphics chip)
    v.overlayNeeded = () => !!(picked || paintSel || selecting);
    tools(v);   // (something copied: ready to paste)
}
function pickedBox()
{
    if (!picked) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const o of project.scene.items) if (picked.ids.includes(o.id)) { const b = render.outer(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
// What a tap on an object picks: the whole of the group it is in (past its layer), as on the desktop.
function family(o)
{
    const doc = project.base.doc;
    if (!o.group) return [o.id];
    const ids = o.group.split("/"), k = doc.folders.has(ids[0]) ? 1 : 0;
    if (ids.length <= k) return [o.id];
    const g = ids.slice(0, k + 1).join("/");
    return project.scene.items.filter(x => x.group && (x.group === g || x.group.startsWith(g + "/"))).map(x => x.id);
}
function tapObject(v, x, y)
{
    const o = render.objectAt(project.scene, x, y, 12 / v.cam.s);
    const locked = project.base.doc.readOnly;
    if (o && o.kind === "list" && (locked || (picked && picked.list === o.id))) return openList(o.id, null);   // (a list picked already: opened)
    if (!o || locked) { pick(null, v); return; }
    const was = picked && picked.ids.join();
    pick({ ids: family(o), list: o.kind === "list" && family(o).length === 1 ? o.id : null }, v);   // (a locked one too: to be unlocked)
    if (picked.ids.join() !== was) feel.pick();
}
export function pick(p, v)
{
    picked = p ? { ...p, viewer: v } : null;
    v.redraw();
    tools(v);
}
// The handles: the picked box's corners, on the screen (none with a list in it: lists are one size, moved only).
function sizable() { return !!picked && !project.scene.items.some(o => picked.ids.includes(o.id) && o.kind === "list"); }
function corners(v)
{
    const b = pickedBox();
    if (!b || !sizable()) return [];
    const a = v.toScreen(b.x, b.y), c = v.toScreen(b.x + b.w, b.y + b.h);
    return [{ x: a.x, y: a.y, ax: b.x + b.w, ay: b.y + b.h }, { x: c.x, y: a.y, ax: b.x, ay: b.y + b.h }, { x: a.x, y: c.y, ax: b.x + b.w, ay: b.y }, { x: c.x, y: c.y, ax: b.x, ay: b.y }];
}
function drawPicked(v, ctx)
{
    if (!picked || picked.viewer !== v) return;
    const b = pickedBox();
    if (!b) return;
    const a = v.toScreen(b.x, b.y), c = v.toScreen(b.x + b.w, b.y + b.h);
    if (lifted)
    {
        ctx.save(); ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 22; ctx.shadowOffsetY = 8;
        ctx.strokeStyle = shown.Heading; ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
        ctx.restore();
    }
    const look = shown;
    ctx.strokeStyle = pickedLocked() ? look.Muted : look.Heading; ctx.lineWidth = 1.5;
    ctx.setLineDash(pickedLocked() ? [5, 4] : []);
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(c.x - a.x), Math.round(c.y - a.y));
    if (pickedLocked()) return;   // (locked: no handles)
    for (const h of corners(v))
    {
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(h.x, h.y, lifted ? 9 : 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = look.Accent; ctx.lineWidth = 2; ctx.stroke();
    }
}
// Whether what is picked is locked (any of it: itself, or a group or layer it is in).
function pickedLocked()
{
    const doc = project.base.doc;
    return !!picked && project.scene.items.some(o => picked.ids.includes(o.id) && cnpy.locked(doc, o, project.view));
}
export function grabPicked(v, at)
{
    if (!picked || picked.viewer !== v || pickedLocked()) return null;   // (locked: the canvas drags instead)
    const ids = picked.ids, b0 = pickedBox(), p0 = v.toCanvas(at.x, at.y);
    // (small on the screen, its handles would cover it: a finger on it moves it, the handles only outside it)
    const small = b0 && Math.min(b0.w, b0.h) * v.cam.s < 72, inside = b0 && p0.x >= b0.x && p0.x <= b0.x + b0.w && p0.y >= b0.y && p0.y <= b0.y + b0.h;
    const h = small && inside ? null : corners(v).find(c => Math.hypot(c.x - at.x, c.y - at.y) < 26);
    if (h)
    {
        // A corner: sized about the opposite one, keeping its shape.
        const c0 = v.toCanvas(h.x, h.y), ax = h.ax, ay = h.ay, d2 = (c0.x - ax) ** 2 + (c0.y - ay) ** 2 || 1;
        project.preview = { t: "place", ids, list: null, by: { k: 1, ox: 0, oy: 0 } };
        lifted = true;
        return {
            move(now)
            {
                const p = v.toCanvas(now.x, now.y), k = Math.max(0.05, ((p.x - ax) * (c0.x - ax) + (p.y - ay) * (c0.y - ay)) / d2);
                project.preview.by = { k, ox: ax - ax * k, oy: ay - ay * k }; refreshView(); v.redraw();
            },
            end() { settle(v); }
        };
    }
    const b = pickedBox(), p = v.toCanvas(at.x, at.y), m = 12 / v.cam.s;
    if (!b || p.x < b.x - m || p.x > b.x + b.w + m || p.y < b.y - m || p.y > b.y + b.h + m) return null;
    // On it: moved with the finger.
    project.preview = { t: "place", ids, list: null, by: { k: 1, ox: 0, oy: 0 } };
    lifted = true;
    return {
        move(now, was) { project.preview.by.ox += (now.x - was.x) / v.cam.s; project.preview.by.oy += (now.y - was.y) / v.cam.s; refreshView(); v.redraw(); },
        end() { settle(v); }
    };
}
function settle(v)
{
    const s = project.preview;
    project.preview = null; lifted = false;
    if (s && (s.by.k !== 1 || Math.abs(s.by.ox) > 0.01 || Math.abs(s.by.oy) > 0.01)) { step(s); feel.drop(); } else refreshView();
    v.redraw();
}
// ---- shapes: a rectangle or circle dragged out on the canvas, filled, as Board's are (its own shape items) ----

let shaping = null;   // "rect" or "oval": the next drag on the canvas draws one
function shapeFrom(v, at)
{
    const kind = shaping, c0 = v.toCanvas(at.x, at.y), layer = cnpy.topLayer(project.base.doc), who = dbx.who(), fill = sessionInk().color;
    let made = null;
    return {
        move(now)
        {
            const c = v.toCanvas(now.x, now.y), b = { x: Math.min(c0.x, c.x), y: Math.min(c0.y, c.y), w: Math.abs(c.x - c0.x), h: Math.abs(c.y - c0.y) };
            const th = cnpy.shapeThing(kind, b, fill, layer, who, made && made.id);
            made = { id: th.id, w: b.w, h: b.h };
            project.preview = { t: "restore", list: null, things: [th] };
            refreshView(); v.redraw();
        },
        end()
        {
            const s = project.preview;
            project.preview = null;
            // (too small to see, a slip: none made)
            if (!s || Math.min(made.w, made.h) * v.cam.s < 6) { refreshView(); v.redraw(); return; }
            shaping = null; corner();
            step(s); feel.drop();
            pick({ ids: [made.id], list: null }, v);
        },
        cancel() { project.preview = null; refreshView(); v.redraw(); }
    };
}

// The bar of what can be done to what is picked, along the bottom of the canvas.
export function tools(v)
{
    const host = v.host.parentNode;
    let bar = host.querySelector(".tools");
    if (pen) { drawBar(v, bar, host); return; }
    if (bar && bar.classList.contains("drawbar")) { bar.remove(); bar = null; }
    if (picked && !project.scene.items.some(o => picked.ids.includes(o.id))) picked = null;   // (gone: undone, say)
    const pasting = !picked && clip && !project.base.doc.readOnly;
    if (!picked && !pasting && !(shaping && v === canvasView)) { if (bar) bar.remove(); return; }
    if (!bar) { bar = element('<div class="tools"></div>'); host.appendChild(bar); if (!calm) bar.animate([{ transform: "translateY(16px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,1.2,.3,1)" }); }
    if (shaping && !picked)
    {
        // A shape to be drawn: said so, until it is (or let go of).
        bar.innerHTML = '<span class="what">Drag to draw ' + (shaping === "rect" ? "a rectangle" : "an ellipse") + '</span><button data-act="unshape">Cancel</button>';
        bar.querySelector('[data-act="unshape"]').addEventListener("click", () => { shaping = null; tools(v); corner(); });
        return;
    }
    if (pasting)
    {
        // Nothing picked, something copied: pasted here, or let go of.
        bar.innerHTML = '<span class="what">' + (clip.things.length > 1 ? clip.things.length + " copied" : "Copied") + '</span><button data-act="paste">Paste</button><button data-act="unclip">Clear</button>';
        bar.querySelector('[data-act="paste"]').addEventListener("click", () => paste(v));
        bar.querySelector('[data-act="unclip"]').addEventListener("click", () => { clip = null; tools(v); });
        return;
    }
    const n = picked.ids.length, shut = pickedLocked();
    const href = (project.scene.items.find(o => picked.ids.includes(o.id) && o.href) || {}).href;   // a link it has (Board's Links)
    const its = project.scene.items.filter(o => picked.ids.includes(o.id));
    const colorable = !shut && its.length === picked.ids.length && its.every(o => o.kind === "rect" || o.kind === "oval");
    bar.innerHTML = '<span class="what">' + (shut ? icon("lock", 15) : "") + (picked.list ? "List" : n > 1 ? "Group of " + n : kindName(picked.ids[0])) + "</span>"
        + (colorable ? '<button data-act="color" class="shapeink" aria-label="Color"><i style="background:' + (its[0].fill || "transparent") + '"></i></button>' : "")
        + (href ? '<button data-act="link" class="linkto">' + icon("link", 15) + "<span>" + text(linkWords(href)) + "</span></button>" : "")
        + (picked.list ? '<button data-act="open">Open</button>' : "")
        + '<button data-act="copy">Copy</button>'
        + '<button data-act="lock">' + (shut ? "Unlock" : "Lock") + "</button>"
        + (shut ? "" : '<button data-act="delete" class="danger">Delete</button>') + '<button data-act="done">Done</button>';
    bar.querySelectorAll("button").forEach(b => b.addEventListener("click", () =>
    {
        if (b.dataset.act === "color") { if (popOf === b) closePop(); else shapeColors(v, b); return; }
        if (b.dataset.act === "open") openList(picked.list, null);
        else if (b.dataset.act === "link") openLink(href, v);
        else if (b.dataset.act === "copy") copyPicked(v);
        else if (b.dataset.act === "delete") { const ids = picked.ids; pick(null, v); step({ t: "delobj", ids, list: null }); feel.gone(); v.redraw(); }
        else if (b.dataset.act === "lock")
        {
            // Locking: each its own lock. Unlocking: each its own, and the groups or layers locking it (as the desktop's Unlock).
            const doc = project.base.doc, its = project.scene.items.filter(o => picked.ids.includes(o.id));
            if (!shut) step({ t: "lock", ids: picked.ids, on: true, list: null });
            else
            {
                const groups = [...new Set(its.flatMap(o => cnpy.lockers(doc, o, project.view)))];
                step({ t: "lock", ids: picked.ids, on: false, groups, list: null });
                if (groups.some(g => doc.folders.has(g))) toast("Its layer was unlocked too");
            }
            feel.pick(); tools(v); v.redraw();
        }
        else pick(null, v);
    }));
}
// ---- copied and pasted on the canvas or a board: what is picked, into this project or another opened after ----

let clip = null;   // { things, path (the project they came from), from (its file), files (pictures' bytes, by name), box, n }
async function copyPicked(v)
{
    if (!picked) return;
    // (the phone's own clipboard marked as holding this, so a paste takes whichever was copied last: this, or an
    // image copied elsewhere since; written at once, while the tap still counts)
    const mark = "canopy-copy:" + cnpy.newId();
    try { navigator.clipboard.writeText(mark).catch(() => { }); } catch (e) { }
    const doc = project.base.doc, things = cnpy.copyOut(doc, project.view, picked.ids), files = new Map();
    for (const th of things)
    {
        const f = cnpy.fileOf(th);
        if (!f || f.kind !== "image" || files.has(f.file)) continue;
        const z = doc.zip.file(f.file), bytes = project.pictures.get(f.file) || (z ? await z.async("uint8array") : null);
        if (bytes) files.set(f.file, bytes);
    }
    clip = { things, path: project.path, from: doc, files, box: pickedBox(), n: 0, mark };
    feel.pick();
    pick(null, v);   // (the bar then says it is copied, and offers to paste)
}
function paste(v)
{
    if (!clip || !project || project.base.doc.readOnly) return;
    const doc = project.base.doc, here = clip.path === project.path;
    // A drawing's pixels are files of their own: pasted only into the project it came from.
    const things = here ? clip.things : clip.things.filter(th => { const f = cnpy.fileOf(th); return !f || f.kind !== "paint"; });
    if (things.length < clip.things.length) toast(things.length ? "Drawings only paste into their own project" : "A drawing only pastes into its own project");
    if (!things.length) return;
    // Where: just off the original, when it is in view (a little further each time); else in the middle of the view.
    const m = v.middle(), b = clip.box, cx = b.x + b.w / 2, cy = b.y + b.h / 2, step1 = 24 / v.cam.s;
    const seen = here && Math.abs(cx - m.x) < m.w / 2 && Math.abs(cy - m.y) < m.h / 2;
    clip.n = seen ? clip.n + 1 : 0;
    const by = seen ? { k: 1, ox: step1 * clip.n, oy: step1 * clip.n } : { k: 1, ox: m.x - cx, oy: m.y - cy };
    const made = cnpy.copyIn(things, clip.from, doc, by, cnpy.topLayer(doc));
    for (const th of made)
    {
        // (pictures from another project: kept on the phone until saved into this one, as photos are)
        const f = cnpy.fileOf(th);
        if (f && f.kind === "image" && !doc.zip.file(f.file) && clip.files.has(f.file) && !project.pictures.has(f.file)) { project.pictures.set(f.file, clip.files.get(f.file)); keepPhoto(f.file, clip.files.get(f.file)); }
    }
    step({ t: "restore", list: null, things: made });
    project.get = render.pictures(project.base.doc, project.pictures, onPicture, project.cache);
    feel.drop();
    pick({ ids: made.map(th => th.id), list: made.length === 1 && made[0].list ? made[0].id : null }, v);
    redrawViewers();
}

// ---- full screen: the canvas alone (the bars put away; the browser's too, where the phone lets a page), its two
// buttons in the corner they were pressed in, and the drawing bar while drawing ----

export let full = false;
export function setFull(on)
{
    full = on;
    const shell = app.querySelector(".project");
    if (shell) shell.classList.toggle("full", on);
    const el = document.documentElement, now = document.fullscreenElement || document.webkitFullscreenElement;
    try
    {
        if (on && !now) { const go = el.requestFullscreen ? el.requestFullscreen({ navigationUI: "hide" }) : el.webkitRequestFullscreen ? el.webkitRequestFullscreen() : null; if (go && go.catch) go.catch(() => { }); }
        if (!on && now) { const back = document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen ? document.webkitExitFullscreen() : null; if (back && back.catch) back.catch(() => { }); }
    }
    catch (e) { }   // (not allowed here: the bars alone put away)
    corner();
    requestAnimationFrame(() => { if (canvasView) canvasView.resize(); });
}
// The screen kept on while the canvas is open (drawing, or looking it over, it would go dark), as far as the browser
// lets a page; let go everywhere else, and asked for again when the page comes back. Five minutes untouched, it is let
// go too (the phone dims as it would), and asked for again at the next touch.
const AWAKE_FOR = 5 * 60 * 1000;
let wakeLock = null, touchedAt = Date.now(), idleTimer = 0;
document.addEventListener("pointerdown", () =>
{
    touchedAt = Date.now();
    clearTimeout(idleTimer); idleTimer = setTimeout(() => awake(), AWAKE_FOR + 50);
    if (!wakeLock) awake();
}, { capture: true, passive: true });
export async function awake()
{
    const want = !!project && tab === "canvas" && !document.hidden && Date.now() - touchedAt < AWAKE_FOR;
    if (!want) { if (wakeLock) { const w = wakeLock; wakeLock = null; try { await w.release(); } catch (e) { } } return; }
    if (wakeLock || !navigator.wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } catch (e) { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => awake());
render.filled.onReady = () => redrawViewers();   // (a fill's picture decoded: drawn)

// The canvas's own buttons, top right: Draw (lit while drawing), the Hierarchy, Fit everything (in full screen, Undo:
// the top bar's is put away), and Full screen (in it, the way out).
export function corner()
{
    const c = app.querySelector("#tab .corner");
    if (!c || !project) return;
    const shut = project.base.doc.readOnly;
    c.innerHTML = (shut ? "" : iconButton("draw", "brush", pen ? "Done drawing" : "Draw") + iconButton("shapes", "rect", "Shapes")) + iconButton("hierarchy", "layers", "Hierarchy")
        + (full ? (shut ? "" : iconButton("undo", "undo", "Undo", "", !undos.length)) : iconButton("fitall", "fit", "Zoom to fit all"))
        + iconButton("fullscreen", "full", full ? "Exit full screen" : "Full screen");
    const d = c.querySelector('[data-do="draw"]');
    if (d) d.classList.toggle("on", !!pen);
    const sh = c.querySelector('[data-do="shapes"]');
    if (sh) sh.classList.toggle("on", !!shaping);
    const f = c.querySelector('[data-do="fullscreen"]');
    if (f) f.classList.toggle("on", full);
    wire(c);
}
// Left by the phone's own way out (the back gesture, Escape): out of it here too.
for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(ev, () => { if (full && !document.fullscreenElement && !document.webkitFullscreenElement) setFull(false); });

// The canvas's +: a photo, a picture copied, or a new list, in the middle of what the canvas shows.
function addMenu(btn)
{
    const m = dropMenu(btn, '<button data-act="photo">' + icon("photo", 20) + "<span>Photo</span></button>"
        + '<button data-act="paste">' + icon("copy", 20) + "<span>Paste image</span></button>"
        + '<button data-act="list">' + icon("lists", 20) + "<span>New list</span></button>" + shapeItems());
    if (!m) return;
    wireShapes(m);
    const gone = m.gone;
    // (each done at once, in the tap: a phone only shows its photos, or lets a page read what is copied, then)
    m.querySelector('[data-act="photo"]').addEventListener("click", () => { gone(); app.querySelector("#photo-picker").click(); });
    m.querySelector('[data-act="paste"]').addEventListener("click", () => { const got = readClipboard(); gone(); got.then(placeCopied); });
    m.querySelector('[data-act="list"]').addEventListener("click", () => { gone(); newList(canvasView ? canvasView.middle() : null); });
}
// The shapes, from the canvas's corner: the one chosen drawn by the next drag (chosen again, or tapped again: not).
function shapeMenu(btn)
{
    if (shaping && canvasView) { shaping = null; tools(canvasView); corner(); return; }
    const m = dropMenu(btn, shapeItems());
    if (m) wireShapes(m);
}
const shapeItems = () => '<button data-act="rect">' + icon("rect", 20) + "<span>Rectangle</span></button>" + '<button data-act="oval">' + icon("oval", 20) + "<span>Ellipse</span></button>";
function wireShapes(m)
{
    for (const k of ["rect", "oval"]) m.querySelector('[data-act="' + k + '"]').addEventListener("click", () =>
    {
        m.gone();
        if (!canvasView) return;
        if (pen) endDrawing(canvasView);
        shaping = k; pick(null, canvasView); corner();
    });
}
// A menu below a button (put on the page itself, over everything: its button tapped again, put away), or null then.
export function dropMenu(btn, html)
{
    if (!btn) return null;
    const was = document.querySelector(".addmenu");
    if (was) { const same = was.from === btn; was.gone(); if (same) return null; }
    const m = element('<div class="addmenu" role="menu">' + html + "</div>");
    m.from = btn;
    const r = btn.getBoundingClientRect();
    m.style.top = r.bottom + 6 + "px";
    m.style.right = Math.max(8, innerWidth - r.right) + "px";
    document.body.appendChild(m);
    if (!calm) m.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 150, easing: "cubic-bezier(.2,.9,.3,1)" });
    const gone = m.gone = () => { m.remove(); document.removeEventListener("pointerdown", away, true); };
    const away = e => { if (!m.contains(e.target) && !btn.contains(e.target)) gone(); };
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    return m;
}
// A board's photo button: a photo from the phone, or the image it has copied (from a web page, say).
function photoMenu()
{
    const build = () => '<div class="actions"><button class="action" data-do="choose">' + icon("photo", 18) + "<span>Photo</span></button>"
        + '<button class="action" data-do="pasteimage">' + icon("copy", 18) + "<span>Paste image</span></button></div>";
    sheetUp(build, (does, value, close) =>
    {
        // (each asked for at once, in the tap: a phone only shows its photos, or lets a page read what is copied, then)
        if (does === "choose") { app.querySelector("#photo-picker").click(); close(() => { }); }
        else if (does === "pasteimage") { const got = readClipboard(); close(() => { }); got.then(placeCopied); }
    });
}
// What the phone or computer has copied: an image, or else its words (a link, say), or why not.
async function readClipboard()
{
    if (!navigator.clipboard || !navigator.clipboard.read) return { why: "This browser can't paste images here" };
    try
    {
        const items = await navigator.clipboard.read();
        let words = "";
        for (const it of items)
        {
            const type = it.types.find(t => t.startsWith("image/"));
            if (type) return { image: await it.getType(type) };
            if (!words && it.types.includes("text/plain")) words = await (await it.getType("text/plain")).text();
        }
        return { words };
    }
    catch (e) { return { why: "Pasting wasn't allowed" }; }
}
// Placed as a photo is: an image; a link to one (where its site lets a page fetch it); something copied here, pasted.
async function placeCopied(got)
{
    if (!project || project.base.doc.readOnly) return;
    if (got.why) return toast(got.why);
    const words = (got.words || "").trim();
    if (clip && words === clip.mark) { const v = boardView || canvasView; if (v) paste(v); return; }
    let image = got.image;
    if (!image && /^https?:\/\/\S+$/i.test(words))
    {
        toast("Fetching the image\u2026");
        try { const r = await fetch(words, { mode: "cors" }); const b = r.ok ? await r.blob() : null; if (b && b.type.startsWith("image/")) image = b; } catch (e) { }
        if (!image) return toast("Couldn't get an image from that link");
    }
    if (!image) return toast(words ? "What's copied isn't an image" : "Nothing copied to paste");
    addPhoto(new File([image], "pasted", { type: image.type || "image/png" }));
}
// On a computer, Ctrl+V (or Cmd+V): whichever was copied last.
document.addEventListener("paste", e =>
{
    if (!project || project.base.doc.readOnly || (e.target.closest && e.target.closest("textarea, input"))) return;
    const d = e.clipboardData, file = d ? [...d.files].find(f => f.type.startsWith("image/")) : null, words = d ? d.getData("text/plain") : "";
    if (!file && !(clip && words === clip.mark) && !/^https?:\/\//i.test(words.trim()) && !clip) return;
    e.preventDefault();
    placeCopied(file ? { image: file } : clip && (!words || words === clip.mark) ? { words: clip.mark } : { words });
});

// An object's link (Board's Links): a web address, or a board or object of the project (its id).
function webLink(href) { return /:\/\//.test(href) || /^www\./i.test(href) || /^mailto:/i.test(href); }
function linkWords(href)
{
    if (webLink(href)) return href.replace(/^https?:\/\//i, "").replace(/\/$/, "");
    const to = render.linked(project.scene, href);
    return to ? (to.board ? to.board.name : to.item ? to.item.name || "Linked object" : "Linked") : "Linked";
}
function openLink(href, v)
{
    if (webLink(href)) { window.open(/^www\./i.test(href) ? "https://" + href : href, "_blank", "noopener"); return; }
    pick(null, v);
    follow(href);
}

export function kindName(id)
{
    const o = project.scene.items.find(x => x.id === id);
    return o ? ({ image: "Image", type: "Type", paint: "Drawing", sketch: "Drawing", list: "List", rect: "Rectangle", oval: "Ellipse", path: "Path", line: "Line", arrow: "Arrow" }[o.kind] || "Object") : "Object";
}
let toastTimer = null;
export function toast(words)
{
    let t = document.querySelector(".toast");
    if (!t) { t = element('<div class="toast"></div>'); document.body.appendChild(t); }
    t.textContent = words;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}
// The canvas tab's view put away (another tab shown, or the project left): what was picked on it let go, and drawing on
// it ended (saved, as Done saves). A board open over the tabs keeps its own.
export function closeViewers()
{
    if (picked && picked.viewer !== boardView) picked = null;
    if (pen && !(boardView && open && open.kind === "board"))
    {
        penAway();
        if (project && project.steps.length && !project.local) { clearTimeout(saveTimer); save(); }
    }
    if (canvasView && project) remember("canopy.cam." + project.path, canvasView.cam);
    if (canvasView) canvasView.dispose();
    canvasView = null;
}

// ---- over the tabs: a list, or a board, opened (grown from its card) ----

function showOver()
{
    const over = app.querySelector("#over");
    if (!over) return;
    if (!open) { if (picked && picked.viewer === boardView) picked = null; over.innerHTML = ""; over.className = ""; if (boardView) boardView.dispose(); boardView = null; return; }
    if (open.kind === "list" && !current()) { open = null; return showOver(); }
    over.className = "open " + open.kind;
    over.onclick = e => { if (e.target === over) closeOver(); };   // (round a list opened on a wide screen: back to the others)
    if (open.kind === "list") showList(over);
    else showBoard(over);
}

export function grow(el, from)
{
    if (calm || !from) return;
    const to = el.getBoundingClientRect();
    const sx = from.width / to.width, sy = from.height / to.height;
    el.animate([
        { transformOrigin: "0 0", transform: "translate(" + (from.left - to.left) + "px," + (from.top - to.top) + "px) scale(" + sx + "," + sy + ")", borderRadius: "14px", opacity: 0.6 },
        { transformOrigin: "0 0", transform: "none", borderRadius: getComputedStyle(el).borderRadius || "0px", opacity: 1 }
    ], { duration: 380, easing: "cubic-bezier(.2,1.08,.3,1)" });
    const inner = el.querySelector(".fade-in");
    if (inner) inner.animate([{ opacity: 0 }, { opacity: 0 }, { opacity: 1 }], { duration: 380 });
}
function shrink(done)
{
    const over = app.querySelector("#over .sheet-wrap, #over .board-wrap");
    const card = open && app.querySelector('[data-do="' + open.kind + '"][data-value="' + CSS.escape(open.id) + '"]');
    if (calm || !over) return done();
    const from = over.getBoundingClientRect(), to = card ? card.getBoundingClientRect() : null;
    // (quick out, slowing as it lands on its card; what's on it gone at once, so nothing is seen squashed)
    const inside = over.querySelector(".sheet, .stage, .bar");
    if (inside && to) over.querySelectorAll(".sheet, .stage, .bar").forEach(el => el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, fill: "forwards" }));
    const a = to ? over.animate([{ transformOrigin: "0 0", transform: "none", borderRadius: getComputedStyle(over).borderRadius }, { transformOrigin: "0 0", transform: "translate(" + (to.left - from.left) + "px," + (to.top - from.top) + "px) scale(" + to.width / from.width + "," + to.height / from.height + ")", borderRadius: "40px" }], { duration: 230, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" })
                 : over.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(24px)" }], { duration: 160, easing: "cubic-bezier(.16,1,.3,1)", fill: "forwards" });
    a.onfinish = done;
}
let travelling = false;
export function stepTo(o) { if (!travelling && (!open || open.kind !== o.kind || open.id !== o.id)) { const at = (history.state && history.state.at || 0) + 1; history.pushState({ ...here(), open: o, at }, ""); try { sessionStorage.setItem("canopy.nav", String(at)); } catch (e) { } } }
function openList(id, card)
{
    stepTo({ kind: "list", id });
    const from = card ? card.getBoundingClientRect() : null;
    open = { kind: "list", id }; arranging = false; editing = null;
    show();
    grow(app.querySelector("#over .sheet-wrap"), from);
}
function openBoard(id, card)
{
    stepTo({ kind: "board", id });
    const from = card ? card.getBoundingClientRect() : null;
    open = { kind: "board", id };
    show();
    grow(app.querySelector("#over .board-wrap"), from);
}
function closeOver()
{
    finishTyping(false, false);
    shrink(() => { open = null; arranging = false; editing = null; show(); });
}

function showBoard(over)
{
    const b = project.scene.boards.find(o => o.id === open.id);
    if (!b) { open = null; return showOver(); }
    let wrap = over.querySelector(".board-wrap");
    if (!wrap || wrap.dataset.id !== b.id)
    {
        over.innerHTML = '<div class="board-wrap" data-id="' + text(b.id) + '"><div class="head"></div><div class="stage fade-in"></div></div>';
        wrap = over.querySelector(".board-wrap");
        if (boardView) boardView.dispose();
        boardView = new Viewer(wrap.querySelector(".stage"), () => project && project.scene, pictureGetter(), null);
        editable(boardView);
        boardView.onFitAll = () => boardView.fit(b, 0.04, true);
        boardView.fit(b, 0.04, false);
        measure(wrap.querySelector(".stage"));
    }
    else boardView.redraw();
    const head = wrap.querySelector(".head");
    head.innerHTML = bar(b.name, iconButton("close", "back", "Back"), statusHtml() + undoButtons() + iconButton("fitboard", "fit", "Zoom to fit board") + (project.base.doc.readOnly ? "" : iconButton("draw", "brush", pen ? "Done drawing" : "Draw") + iconButton("photo", "photo", "Add photo")));
    wire(head);
}

// The project as the steps leave it, worked out again (and drawn again) after every change. What the steps left last
// time is kept ("applied"), and carried on from while the steps are only added to: so a finger dragging something (a
// preview step each move) has only that one step done again, not all of them.
export function refreshView()
{
    const p = project, doc = p.base.doc, steps = p.steps, a = p.applied;
    const kept = a && a.doc === doc && a.steps === steps && a.n <= steps.length && (a.n === 0 || steps[a.n - 1] === a.last) && a.first === steps[0];
    let view = kept ? a.view : null;
    if (!kept || a.n < steps.length) view = cnpy.apply(doc, kept ? steps.slice(a.n) : steps, view);
    p.applied = { doc, steps, n: steps.length, last: steps[steps.length - 1], first: steps[0], view };
    p.view = p.preview ? cnpy.apply(doc, [p.preview], view) : view;
    p.scene = render.scene(doc, p.view);
}
export function redrawViewers() { if (canvasView) canvasView.redraw(); if (boardView) boardView.redraw(); }

export function step(s)
{
    if (!project || project.base.doc.readOnly) return;
    if (s.list === undefined && open && open.kind === "list") s.list = open.id;
    const undo = run([s]);
    if (undo.length) { undos.push(undo); if (undos.length > 200) undos.shift(); }
    redos = [];
    changed();
}
// Steps done, each with what would undo it worked out first; returns the undoing (in the order to do it).
function run(steps)
{
    const back = [];
    for (const s of steps)
    {
        back.unshift(...cnpy.inverse(project.base.doc, project.view, s));
        project.steps.push(s);
        refreshView();
    }
    return back;
}
export function undoRedo(redo)
{
    if (!project || project.base.doc.readOnly) return;
    finishTyping(false, false);
    const from = redo ? redos : undos, to = redo ? undos : redos;
    if (!from.length) return;
    let doing = from.pop();
    if (doing.saved) doing = pastSave(doing);
    selectionWith(doing);
    const again = run(doing);
    if (!again.length)
    {
        // Nothing left to take back or do again (strokes on a drawing since saved: painted into it): the steps left
        // out, and nothing saved for them.
        project.steps.splice(project.steps.length - doing.length, doing.length);
        refreshView(); undoable(); redrawViewers();
        if (doing.every(x => x.t === "unstroke" || x.t === "stroke")) toast("Saved strokes can't be undone");
        return;
    }
    if (again.length) to.push(again);
    if (picked) picked.ids = picked.ids.filter(id => project.scene.items.some(o => o.id === id));
    if (picked && !picked.ids.length) picked = null;
    if (open && open.kind === "board" && !project.scene.boards.some(b => b.id === open.id)) open = null;
    feel.drop();
    changed();
    show();
    if (picked) tools(picked.viewer);
}
export function undoable() { app.querySelectorAll('[data-do="undo"]').forEach(b => { b.disabled = !undos.length; }); app.querySelectorAll('[data-do="redo"]').forEach(b => { b.disabled = !redos.length; }); }
export function onPicture()
{
    redrawViewers();
    if (tab === "boards" && project && !open) { clearTimeout(onPicture.t); onPicture.t = setTimeout(drawThumbs, 60); }
    if (document.querySelector(".picker canvas.lthumb")) { clearTimeout(onPicture.l); onPicture.l = setTimeout(drawLinkThumbs, 60); }
}

// A photo from the phone: made smaller if it is very big, then placed in the board open, or the middle of the canvas.
export async function addPhoto(file)
{
    let img;
    try { img = await createImageBitmap(file); }
    catch (e) { problem = "Couldn't read that photo."; return show(); }
    const most = 2400, k = Math.min(1, most / Math.max(img.width, img.height));
    const pw = Math.round(img.width * k), ph = Math.round(img.height * k);
    let bytes;
    if (k === 1 && /png|gif/.test(file.type)) bytes = new Uint8Array(await file.arrayBuffer());   // (kept as it came)
    else
    {
        const c = document.createElement("canvas");
        c.width = pw; c.height = ph;
        c.getContext("2d").drawImage(img, 0, 0, pw, ph);
        const blob = await new Promise(ok => c.toBlob(ok, "image/jpeg", 0.88));
        bytes = new Uint8Array(await blob.arrayBuffer());
    }
    const id = cnpy.newId(), name = file.type === "image/gif" ? id + ".gif" : id + ".png";   // (named as the desktop app names its pictures, whatever they are inside)
    // Where it goes: a board open: fitted in its middle; else the middle of what the canvas shows.
    let area;
    const b = open && open.kind === "board" ? project.scene.boards.find(o => o.id === open.id) : null;
    if (b) area = { x: b.x + b.w * 0.15, y: b.y + b.h * 0.15, w: b.w * 0.7, h: b.h * 0.7 };
    else if (canvasView) { const m = canvasView.middle(); area = { x: m.x - m.w * 0.3, y: m.y - m.h * 0.3, w: m.w * 0.6, h: m.h * 0.6 }; }
    else { const e = render.extent(project.scene); area = { x: e.x + e.w + 80, y: e.y, w: 600, h: 600 }; }
    const s = Math.min(area.w / pw, area.h / ph, 0.5);   // (at most half its pixels' size: a phone photo's pixels are small)
    const w = pw * s, h = ph * s;
    project.pictures.set(name, bytes);
    await keepPhoto(name, bytes);
    const layer = cnpy.topLayer(project.base.doc);
    step({ t: "photo", id, list: null, photo: { file: name, x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h, pw, ph, name: "Photo", layer, author: dbx.who() } });
    project.get = render.pictures(project.base.doc, project.pictures, onPicture, project.cache);
    if (!open && tab !== "canvas") { setTab("canvas"); show(); }
    const v = open && open.kind === "board" ? boardView : canvasView;
    if (v) pick({ ids: [id], list: null }, v);   // (picked, to be moved and sized where it belongs)
    redrawViewers();
}

// A new board, the usual size, to the right of everything, opened.
function newBoard()
{
    const e = render.extent(project.scene), all = project.scene.boards;
    let k = all.length + 1;
    while (all.some(b => b.name === "Board " + k)) k++;
    const board = { id: cnpy.newId(), x: Math.round(e.x + e.w + 120), y: Math.round(e.y), w: 1920, h: 1080, name: "Board " + k };
    step({ t: "newboard", list: null, board });
    focusBoard(board.id, true);
}

// ---- opening ----

let opening = 0;   // (which opening is the latest: one overtaken by another, or by going back, is let go)
export async function openPath(path)
{
    const me = ++opening;
    problem = "";
    keepNow();   // (the last project's steps not yet kept: kept before another is opened)
    app.innerHTML = bar(fileName(path), "", "") + '<main class="page"><div class="empty">Opening…</div></main>';
    try
    {
        // From Dropbox (and the copy kept on this phone made new, if it keeps one); with no connection, that copy.
        let got;
        try { got = await dbx.read(path); if (off.has(path)) off.keep(path, got.bytes, got.rev).catch(() => { }); }
        catch (e)
        {
            if (!(e instanceof dbx.Offline)) throw e;
            got = await off.copy(path);
            if (!got) throw new Error("No connection, and this project isn't kept on this phone.");
            toast("No connection: opened the copy on this phone");
        }
        const doc = await cnpy.open(got.bytes);
        const waiting = (await off.steps(path)) || [];   // changes made here that never got saved: done again
        if (me !== opening) return;
        if (project) render.forget(project.cache);
        project = { path, name: fileName(path), local: false, base: { doc, rev: got.rev }, steps: waiting, pictures: new Map(), cache: render.cache() };
        undos = []; redos = []; forgetSaves();
        project.get = render.pictures(doc, project.pictures, onPicture, project.cache);
        await photosReady(project);
        refreshView();
        remember("canopy.recent", [path, ...remembered("canopy.recent", []).filter(r => r !== path)].slice(0, 5));
        open = null;
        setState(waiting.length ? "pending" : "saved");
        show();
        if (waiting.length) save();
    }
    catch (e) { project = null; failed(e); }
}

async function openLocal(file)
{
    problem = "";
    try
    {
        const doc = await cnpy.open(new Uint8Array(await file.arrayBuffer()));
        if (project) render.forget(project.cache);
        project = { path: file.name, name: fileName(file.name), local: true, base: { doc, rev: null }, steps: [], pictures: new Map(), cache: render.cache() };
        history.pushState({ at: (history.state && history.state.at || 0) + 1, project: file.name, local: true, open: null }, "");
        undos = []; redos = []; forgetSaves();
        project.get = render.pictures(doc, project.pictures, onPicture, project.cache);
        refreshView();
        open = null;
        show();
    }
    catch (e) { project = null; problem = "Couldn't open " + file.name + ": " + e.message; show(); }
}

export function failed(e)
{
    problem = e instanceof dbx.SignedOut ? "Signed out of Dropbox. Sign in again." : e.message || String(e);
    if (e instanceof dbx.SignedOut) project = null;
    show();
}

// A sheet up from the bottom, over the list: "build" makes its inside (again, as what it shows changes), and taps on
// its [data-do] parts go to "chose" (with "close" and "again", to draw it anew). It stays open until told or tapped off;
// the list behind is drawn again as it goes.
export function sheetOpen() { return !!app.querySelector(".picker"); }
export function sheetUp(build, chose)
{
    const over = app.querySelector("#over .sheet-wrap") || app;
    const sheet = element('<div class="picker"><div class="shade"></div><div class="panel"></div></div>');
    over.appendChild(sheet);
    const panel = sheet.querySelector(".panel"), shade = sheet.querySelector(".shade");
    let closing = false;
    // Closed: slid down from wherever it is (dragged part way, say), the shade fading with it; both held where they end
    // until it is gone (else the shade shows again, for a moment, before it goes: a flicker). The list behind is as its
    // changes left it already: not drawn again.
    const close = (then, from) =>
    {
        if (closing) return;
        closing = true;
        document.removeEventListener("keydown", esc);
        app.querySelectorAll("#entries .entry.lit").forEach(o => o.classList.remove("lit"));
        const done = () => { sheet.remove(); if (then) then(); else if (current() && app.querySelector("#over #entries")) undoable(); else show(); };
        if (calm) return done();
        const shade = sheet.querySelector(".shade"), at = from || 0, left = Math.max(0.15, 1 - at / Math.max(1, panel.offsetHeight));
        shade.animate([{ opacity: parseFloat(getComputedStyle(shade).opacity) }, { opacity: 0 }], { duration: 200 * left, easing: "ease-out", fill: "forwards" });
        panel.animate([{ transform: "translateY(" + at + "px)" }, { transform: "translateY(100%)" }], { duration: 220 * left, easing: "cubic-bezier(.3,0,.8,.15)", fill: "forwards" }).onfinish = done;
    };
    const esc = e => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    const again = () =>
    {
        panel.innerHTML = '<div class="grip"></div>' + build();
        panel.querySelectorAll("[data-do]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); if (!closing) chose(b.dataset.do, b.dataset.value, close, again); }));
    };
    again();
    sheet.again = again;   // (drawn anew from outside: the hierarchy, after a row is moved)
    // (The finger that held an entry down to open this is still on the glass: its lift is no tap on the shade. Only a
    // press that starts on the shade, after it is up, closes it.)
    const since = performance.now();
    let armed = false;
    shade.addEventListener("pointerdown", () => { armed = performance.now() - since > 120; });
    shade.addEventListener("click", () => { if (armed) close(); armed = false; });
    if (!calm)
    {
        panel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,1.1,.3,1)" });
        shade.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    // Pulled down by a finger (from anywhere on it, when it is scrolled to its top): it follows, the shade lightening;
    // let go far enough down, or flicked down, it closes; else it springs back up.
    let pull = null;
    panel.addEventListener("touchstart", e => { if (e.touches.length === 1 && !closing) pull = { y0: e.touches[0].clientY, dy: 0, on: false, top: panel.scrollTop <= 0, t: performance.now(), v: 0 }; }, { passive: true });
    panel.addEventListener("touchmove", e =>
    {
        if (!pull) return;
        const dy = e.touches[0].clientY - pull.y0;
        if (!pull.on)
        {
            if (pull.top && dy > 8) { pull.on = true; pull.y0 += 8; }
            else if (Math.abs(dy) > 8) { pull = null; return; }
            else return;
        }
        e.preventDefault();
        const d = e.touches[0].clientY - pull.y0, now = performance.now(), at = d > 0 ? d : d / 4;   // (up: a little, stiffly)
        pull.v = (at - pull.dy) / Math.max(1, now - pull.t); pull.t = now; pull.dy = at;
        panel.style.transform = "translateY(" + at + "px)";
        shade.style.opacity = String(Math.max(0, 1 - Math.max(0, at) / panel.offsetHeight));
    }, { passive: false });
    const letGo = () =>
    {
        if (!pull || !pull.on) { pull = null; return; }
        const p = pull; pull = null;
        panel.dataset.pulled = "1";   // (no tap on what the finger was over)
        setTimeout(() => { delete panel.dataset.pulled; }, 50);
        if (p.dy > panel.offsetHeight * 0.3 || p.v > 0.5) { panel.style.transform = ""; return close(undefined, p.dy); }
        panel.style.transform = ""; shade.style.opacity = "";
        if (!calm) panel.animate([{ transform: "translateY(" + p.dy + "px)" }, { transform: "none" }], { duration: 280, easing: "cubic-bezier(.2,1.2,.3,1)" });
    };
    panel.addEventListener("touchend", letGo);
    panel.addEventListener("touchcancel", letGo);
    panel.addEventListener("click", e => { if (panel.dataset.pulled) { e.stopPropagation(); e.preventDefault(); } }, true);
    return sheet;
}

function follow(id)
{
    finishTyping(false, false);
    const sc = project.scene, to = render.linked(sc, id);
    if (!to) { problem = "What it linked to is no longer in the project."; return show(); }
    if (to.board) { focusBoard(to.board.id, true); return; }
    if (to.item && to.item.kind === "list") { openList(to.item.id, null); return; }
    open = null; setTab("canvas");
    show();
    canvasView.fit(to.area, 0.18, true);
}

// Who is signed in, the sound, opening a project from this phone, signing out.
function accountMenu()
{
    const build = () => '<div class="ptitle">' + (dbx.who() ? "Signed in as " + text(dbx.who()) : "Signed in to Dropbox") + "</div>"
        + '<div class="section first">Theme</div><div class="themes">' + Object.keys(themes).sort((a, b) => themes[a].order - themes[b].order).map(n => '<button class="theme' + (n === theme ? " on" : "") + '" data-do="theme" data-value="' + n + '" style="--a:' + toned(themes[n].colors, tone).Accent + ";--c:" + toned(themes[n].colors, tone).Card + '"><i></i><span>' + n + "</span></button>").join("") + "</div>"
        + '<div class="section">Tone</div><div class="tones">' + [["dark", "Dark"], ["default", "Default"], ["light", "Light"]].map(([v, w]) => '<button class="tone' + (v === tone ? " on" : "") + '" data-do="tone" data-value="' + v + '">' + w + "</button>").join("") + "</div>"
        + '<div class="section">Other</div>'
        + '<button class="pick" data-do="onecolumn" role="switch" aria-checked="' + oneColumn + '"><span>Lists in one column</span><span class="switch' + (oneColumn ? " on" : "") + '"><i></i></span></button>'
        + '<button class="pick" data-do="sound" role="switch" aria-checked="' + sound + '"><span>Sounds</span><span class="switch' + (sound ? " on" : "") + '"><i></i></span></button>'
        + '<button class="pick" data-do="local"><span>Open a project from this phone</span></button>'
        + '<div class="hint">Its changes stay on this phone until you save a copy.</div>'
        + '<button class="pick danger" data-do="signout"><span>Sign out</span></button>';
    sheetUp(build, (does, value, close, again) =>
    {
        if (does === "onecolumn")
        {
            setOneColumn(!oneColumn); click(1100, true);
            const b = app.querySelector('.picker [data-do="onecolumn"]');
            if (b) { b.setAttribute("aria-checked", String(oneColumn)); b.querySelector(".switch").classList.toggle("on", oneColumn); }
            return;
        }
        if (does === "theme") { applyTheme(value); remember("canopy.theme", value); click(1100, true); again(); return; }
        if (does === "tone") { tone = value; remember("canopy.tone", value); applyTheme(theme); click(1100, true); again(); return; }
        if (does === "sound")
        {
            // (flipped where it is, so it slides)
            sound = !sound; remember("canopy.sound", sound); click(1100, true);
            const b = app.querySelector('.picker [data-do="sound"]');
            if (b) { b.setAttribute("aria-checked", String(sound)); b.querySelector(".switch").classList.toggle("on", sound); }
        }
        else if (does === "local") { const pk = app.querySelector("#picker"); if (pk) pk.click(); close(() => { }); }   // (asked for at once: a phone only shows its files for a tap)
        else if (does === "signout") close(() => { dbx.signOut(); project = null; show(); });
    });
}

// ---- what each button does ----

export function wire(root)
{
    (root || app).querySelectorAll("[data-do]").forEach(b => b.addEventListener("click", ev => act(b.dataset.do, b.dataset.value, ev, b)));
    if (root && !root.querySelector("textarea, input.title-edit, .handle, #entries, #picker")) return;
    const scope = root || app;
    const picker = scope.querySelector("#picker");
    if (picker) picker.addEventListener("change", () => { if (picker.files[0]) openLocal(picker.files[0]); });
    const ta = scope.querySelector("textarea, input.title-edit");
    if (ta)
    {
        if (ta.tagName === "TEXTAREA") ta.addEventListener("input", () => { growArea(ta); keepInView(); });
        ta.addEventListener("keydown", keyDown);
        ta.addEventListener("blur", () =>
        {
            if (ta.dataset.gone || !app.contains(ta)) return;
            finishTyping(false, false);
            const drawn = draws;
            setTimeout(() => { if (draws === drawn && !sheetOpen()) show(); }, 350);   // (nothing else drew the page: drawn now, the words in place)
        });
    }
    scope.querySelectorAll(".handle").forEach(h => h.addEventListener("pointerdown", e => { e.preventDefault(); drag(h, e); }));
    if (scope.querySelector("#entries")) touchEntries(scope);
}

export function act(what, value, ev, el)
{
    switch (what)
    {
        case "signin": dbx.signIn(); break;
        case "account": accountMenu(); break;
        case "picture": go({ files: folder, picture: value }); break;
        case "closepicture": goBack(); break;
        case "addpicture": addPicture(); break;
        case "fold": { const f = folded(); remember("canopy.folded", f.includes(value) ? f.filter(k => k !== value) : [...f, value]); showFiles(); break; }
        case "home": if (folder !== "") go({ files: "" }); else { window.scrollTo({ top: 0, behavior: "smooth" }); } break;
        case "back": goBack(); break;
        case "ahead": history.forward(); break;
        case "undo": undoRedo(false); break;
        case "redo": undoRedo(true); break;
        case "pick": app.querySelector("#picker").click(); break;
        case "into": go({ files: value }); break;
        case "open": go({ project: value }); break;
        case "files": goBack(); break;
        case "tab": if (value === tab && !open) { if (tab === "canvas") fitAll(true); break; } finishTyping(false, false); open = null; setTab(value); show(); break;
        case "list": go({ project: project.path, local: project.local, open: { kind: "list", id: value } }, el); break;
        case "board": focusBoard(value, true); break;
        case "close": goBack(); break;
        case "fitall": fitAll(true); break;
        case "fitboard": { const b = project.scene.boards.find(o => o.id === open.id); if (b && boardView) boardView.fit(b, 0.04, true); break; }
        case "refresh": if (state === "waiting" && stateWhy) toast("Not saved yet: " + stateWhy + (stateWhere ? " (" + stateWhere + ")" : "")); save(); catchUp(false); break;   // (the reason said too: a phone shows no tooltip)
        case "copy": saveCopy(); break;
        case "newlist": newList(); break;
        case "newboard": newBoard(); break;
        case "newproject": newProject(); break;
        case "pin":
        {
            const pins = remembered("canopy.pinned", []);
            remember("canopy.pinned", pins.includes(value) ? pins.filter(p => p !== value) : [...pins, value]);
            showFiles();
            break;
        }
        case "keep": keepOnPhone(value); break;
        case "fchanges": changesMenu(el, value); break;
        case "photo": photoMenu(); break;
        case "draw": if (shaping) shaping = null; drawMode(); break;
        case "shapes": shapeMenu(el); break;
        case "addmenu": addMenu(el); break;
        case "hierarchy": hierarchy(); break;
        case "fullscreen": setFull(!full); break;
        case "arrange": finishTyping(false, false); arranging = !arranging; editing = null; show(); break;
        case "retitle": if (project.base.doc.readOnly || arranging) break; finishTyping(false, false); editing = { title: true }; show(); break;
        case "follow": follow(value); break;
        case "tick":
        {
            const r = current().rows.find(o => o.id === value);
            if (r) { step({ t: "set", id: r.id, fields: { done: !r.done } }); if (r.done) feel.untick(); else feel.tick(); }
            refreshList();
            const row = app.querySelector('.entry[data-id="' + CSS.escape(value) + '"]'), box = row && row.querySelector(".check span");
            if (row && !calm) row.animate([{ transform: "scale(.965)" }, { transform: "scale(1.012)" }, { transform: "none" }], { duration: 300, easing: "cubic-bezier(.2,.9,.3,1.2)" });
            if (box && !calm) box.animate([{ transform: "scale(.6)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
            break;
        }
        case "type":
            if (arranging || project.base.doc.readOnly) break;
            if (editing) finishTyping(false, false);
            editing = { id: value };
            show();
            break;
        case "add":
        {
            click(1050, true);
            if (editing) finishTyping(false, false);
            const l = current(), last = l.rows.length ? l.rows[l.rows.length - 1].id : null;
            if (value === "D") { step({ t: "add", row: { id: cnpy.newId(), kind: "D", done: false, color: null, text: "", link: null }, after: last }); show(); break; }
            editing = { fresh: true, after: last, kind: value };
            show();
            break;
        }
        case "showdone": step({ t: "listset", fields: { showDone: !current().showDone } }); feel.drop(); refreshList(); break;
        case "listmenu": listMenu(); break;
    }
}

document.addEventListener("keydown", e =>
{
    if (picture && !sheetOpen())
    {
        if (e.key === "Escape") { e.preventDefault(); goBack(); return; }
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") { e.preventDefault(); nextPicture(e.key === "ArrowRight" ? 1 : -1); return; }
    }
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !project) return;
    if (e.target.closest && e.target.closest("textarea, input")) return;   // (typing: the box's own undo)
    const k = e.key.toLowerCase();
    if (k === "c" && picked) { e.preventDefault(); copyPicked(picked.viewer); return; }   // (pasting: the "paste" below)
    if (k === "z") { e.preventDefault(); undoRedo(e.shiftKey); }
    else if (k === "y") { e.preventDefault(); undoRedo(true); }
});

// ---- added to the home screen (no browser round it, so no browser swipe): a swipe in from the left edge goes back,
// from the right edge forward, as a browser's would; an arrow comes in with the finger, and it goes once past it ----

const standalone = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
document.documentElement.classList.toggle("standalone", standalone);
let popped = 0;   // when the history last moved (by the phone's own swipe, say)
window.addEventListener("popstate", () => { popped = performance.now(); }, true);
if (standalone)
{
    let edge = null;
    document.addEventListener("touchstart", e =>
    {
        const t = e.touches[0];
        edge = null;   // (one left over, whose end never came, would keep the page from scrolling)
        if (e.touches.length !== 1 || sheetOpen() || e.target.closest(".stage")) return;   // (the canvas drags itself)
        const fromLeft = t.clientX < 22, fromRight = t.clientX > innerWidth - 22;
        if (!fromLeft && !fromRight) return;
        if (fromRight && (history.state && history.state.at || 0) >= furthest()) return;   // (nothing ahead)
        edge = { x0: t.clientX, y0: t.clientY, back: fromLeft, on: false, mark: null, t: performance.now() };
    }, { passive: true });
    document.addEventListener("touchmove", e =>
    {
        if (!edge) return;
        const t = e.touches[0], dx = (t.clientX - edge.x0) * (edge.back ? 1 : -1), dy = t.clientY - edge.y0;
        if (!edge.on) { if (dx > 10 && dx > Math.abs(dy)) edge.on = true; else if (Math.abs(dy) > 10) { edge = null; return; } else return; }
        e.preventDefault();
        if (!edge.mark)
        {
            edge.mark = element('<div class="edge-mark' + (edge.back ? "" : " ahead") + '">' + icon(edge.back ? "back" : "forward", 20) + "</div>");
            document.body.appendChild(edge.mark);
            edge.mark.style.top = Math.max(60, Math.min(innerHeight - 60, t.clientY)) - 22 + "px";
        }
        const k = Math.min(1, dx / 90);
        edge.ready = k >= 1;
        edge.mark.style.transform = "translateX(" + (edge.back ? 1 : -1) * (Math.min(dx, 120) * 0.6 - 30) + "px) scale(" + (0.7 + 0.3 * k) + ")";
        edge.mark.style.opacity = String(0.3 + 0.7 * k);
        edge.mark.classList.toggle("ready", edge.ready);
    }, { passive: false });
    const lift = () =>
    {
        if (!edge) return;
        const e = edge; edge = null;
        if (e.mark) { e.mark.style.transition = "opacity .15s"; e.mark.style.opacity = "0"; setTimeout(() => e.mark.remove(), 160); }
        // (the phone's own swipe went back already, as some do on a home screen: not again)
        if (e.ready && popped < e.t) { if (e.back) goBack(); else history.forward(); }
    };
    document.addEventListener("touchend", lift);
    document.addEventListener("touchcancel", lift);
}

// ---- a newer version published: said so, and taken on a tap (each file fetched fresh first, so the phone doesn't
// keep any of the old ones) ----

const FILES = ["index.html", "app.css", "sw.js", "js/app.js", "js/files.js", "js/lists.js", "js/drawing.js", "js/hierarchy.js", "js/saving.js", "js/cnpy.js", "js/render.js", "js/viewer.js", "js/gl.js", "js/offline.js", "js/dropbox.js", "js/icons.js", "js/look.js", "js/tone.js", "js/version.js"];
let newer = null;
async function checkVersion()
{
    try
    {
        const t = await (await fetch("js/version.js?at=" + Date.now(), { cache: "no-store" })).text(), m = t.match(/VERSION\s*=\s*"([^"]+)"/);
        if (!m || m[1] === VERSION || m[1] === newer) return;
        newer = m[1];
        const note = element('<button class="update">Version ' + text(newer) + " is ready \u2014 tap to update</button>");
        note.addEventListener("click", async () =>
        {
            note.textContent = "Updating\u2026";
            await Promise.all(FILES.map(f => fetch(f, { cache: "reload" }).catch(() => { })));
            try { const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); } catch (x) { }
            location.reload();
        });
        document.body.appendChild(note);
        if (!calm) note.animate([{ transform: "translate(-50%, 20px)", opacity: 0 }, { transform: "translate(-50%, 0)", opacity: 1 }], { duration: 260, easing: "cubic-bezier(.2,1.2,.3,1)" });
    }
    catch (e) { }   // (offline: asked again later)
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") checkVersion(); });
setInterval(checkVersion, 5 * 60 * 1000);

// ---- starting ----

// The Dropbox key fetched fresh (a browser may hold on to an older copy of config.js for a while).
async function freshKey()
{
    try
    {
        const r = await fetch("config.js", { cache: "no-store" });
        const m = (await r.text()).match(/dropboxAppKey\s*:\s*"([^"]*)"/);
        if (m) { window.CANOPY = window.CANOPY || {}; window.CANOPY.dropboxAppKey = m[1]; }
    }
    catch (e) { }
}

if (location.hostname === "localhost") window.__project = () => project;   // (for checking it on this computer)
if (location.hostname === "localhost") window.__stats = () => render.stats;

(async function start()
{
    if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) { try { navigator.serviceWorker.register("sw.js"); } catch (e) { } }
    await off.all();
    await freshKey();
    try { await dbx.finish(); }
    catch (e) { problem = e.message; }
    if (!history.state) history.replaceState({ at: 0, files: folder }, "");
    show();
    checkVersion();
})();
