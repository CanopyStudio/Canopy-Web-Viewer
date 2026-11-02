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

const app = document.getElementById("app");
const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---- what is open ----

let folder = remembered("canopy.folder", "");
let project = null;       // { path, name, local, base: { doc, rev }, steps, view, scene, get, pictures }
let tab = remembered("canopy.tab", "lists");   // lists, boards or canvas
let open = null;          // over the tab: { kind: "list" | "board", id }
let arranging = false;    // a list being put in order: each entry's handle shown
let editing = null;       // the entry being typed in: { id } or, for a new one, { fresh: true, after, kind }; or { title: true }
let problem = "";         // what went wrong, shown until the next one
let canvasView = null, boardView = null;   // the viewers on show
let undos = [], redos = [];   // what undoes each change (steps), latest last; and what redoes each one undone
// Where things are, kept in the browser's history (so its back and forward, and a swipe from the edge, go through the
// folders, projects and lists opened here): { at (how far in), files (the folder on show) | project (its path), open }.
function here() { const at = history.state && history.state.at || 0; return project ? { at, project: project.path, local: project.local, open: open ? { ...open } : null } : { at, files: folder, picture: picture ? picture.path : null }; }
function furthest() { try { return parseInt(sessionStorage.getItem("canopy.nav") || "0", 10); } catch (e) { return 0; } }
// Somewhere new: a step on in the history (anything ahead of it gone), then shown. "from": a card it grows from.
function go(to, from)
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
    closeViewers();
    if (project && project.steps.length && !project.local) save();   // (still saving: it carries on)
    if (project && !project.steps.length) render.forget(project.cache);   // (its pictures let go)
    project = null; open = null; problem = "";
}

function remembered(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function remember(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (e) { } }

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
function holdScroll(end) { if (stuck.size === 0) document.addEventListener("touchmove", noScroll, { passive: false }); stuck.add(end); }
// Whether that drag was still going (ended now, the page free to scroll again once no other is).
function letScroll(end) { if (!stuck.delete(end)) return false; if (stuck.size === 0) document.removeEventListener("touchmove", noScroll); return true; }
// Whether a hold (begun by "e") still has its finger down: on a touch screen, a finger must still be on it.
function stillDown(e) { return e.pointerType !== "touch" || fingers > 0; }

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
const feel = {
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
function icon(name, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + "</svg>"; }
function text(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function bar(title, left, right, cls, titleDoes) { return '<header class="bar' + (cls ? " " + cls : "") + '">' + (left || "") + "<h1>" + (titleDoes ? '<button data-do="' + titleDoes + '">' + text(title) + "</button>" : text(title)) + "</h1>" + (right || "") + "</header>"; }
function fileName(path) { return path.split("/").pop().replace(/\.cnpy$/i, ""); }
function iconButton(does, name, label, value, off) { return '<button class="icon" data-do="' + does + '"' + (value ? ' data-value="' + text(value) + '"' : "") + (off ? " disabled" : "") + ' aria-label="' + label + '" title="' + label + '">' + icon(name) + "</button>"; }
// Undo and redo, for a bar.
function undoButtons() { return !project || project.base.doc.readOnly ? "" : iconButton("undo", "undo", "Undo", "", !undos.length) + iconButton("redo", "redo", "Redo", "", !redos.length); }

// Behind the app, the color of whatever is along the bottom of the screen.
function footColor()
{
    const c = shown, l = current();
    document.documentElement.style.backgroundColor = picture ? "#000" : l ? render.listLook(l).card : project ? (open ? c.Canvas : c.Chrome) : c.Canvas;
}

// ---- the files ----

let draws = 0;   // how many times a page has been drawn
function show()
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

async function showFiles()
{
    if (full) setFull(false);
    awake();
    closeViewers();
    document.documentElement.classList.remove("in-project");   // (come back from a project by the history, not by show: the page scrolls again)
    requestAnimationFrame(footColor);
    const signed = dbx.ready() && dbx.signedIn();
    if (!signed)
    {
        app.innerHTML = '<div class="hello"><img src="icons/icon-180.png" alt=""><h1>Canopy Web Viewer</h1>'
            + (dbx.ready() ? "<p>Sign in to Dropbox to open your Canopy Board projects.</p><button class=\"main-button\" data-do=\"signin\">Sign in with Dropbox</button>"
                           : "<p>Dropbox isn't set up for this page yet: its app key goes in config.js.</p>")
            + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
            + localOpener() + "</div>";
        wire();
        return;
    }
    const pins = remembered("canopy.pinned", []);
    const recent = remembered("canopy.recent", []).filter(r => !pins.includes(r));
    const at = history.state && history.state.at || 0;
    const arrows = iconButton("back", "back", "Back", "", at === 0 && folder === "") + iconButton("ahead", "forward", "Forward", "", at >= furthest());
    const inFolder = r => r.split("/").slice(-2, -1)[0] || "Dropbox";
    app.innerHTML = bar("Canopy Web Viewer", "", arrows + iconButton("account", "more", "Account"), "files-bar", "home")
        + '<main class="page enter">'
        + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + (pins.length && folder === "" ? heading("pinned", "Pinned") + '<div class="rows" id="pinned">' + pins.map(r => item("file", fileName(r), inFolder(r), "open", r)).join("") + "</div>" : "")
        + (recent.length && folder === "" ? heading("recent", "Recent") + '<div class="rows">' + recent.map(r => item("file", fileName(r), inFolder(r), "open", r)).join("") + "</div>" : "")
        + heading("here", folder === "" ? "Dropbox" : folder.split("/").pop())
        + (folder !== "" && !folded().includes("here") ? '<div class="where">' + ["Dropbox"].concat(folder.split("/").filter(Boolean)).map(text).join(" / ") + "</div>" : "")
        + '<div class="rows" id="items"><div class="empty">Loading…</div></div>'
        + '<input class="hidden-input" type="file" id="picker">'
        + '<div class="version">Canopy Web Viewer ' + VERSION + "</div></main>";
    wire();
    arrangePins();
    let items;
    try { items = await dbx.list(folder); }
    catch (e) { return failed(e); }
    const holder = document.getElementById("items");
    if (!holder || project) return;
    shownItems = items;
    const pics = items.filter(i => i.picture), rest = items.filter(i => !i.picture), grid = pics.length >= 6 && pics.length >= items.length * 0.6;
    holder.innerHTML = (grid ? rest : items).map(i => i.picture ? item("picture", i.name, when(i.modified), "picture", i.path)
            : item(i.folder ? "folder" : "file", i.folder ? i.name : fileName(i.name), i.folder ? "" : when(i.modified), i.folder ? "into" : "open", i.path)).join("")
        + (items.length === 0 ? '<div class="empty">No folders, projects or pictures here</div>' : "")
        + '<button class="item new" data-do="newproject">' + icon("plus", 18) + '<span class="name">New project here</span></button>';
    if (grid) holder.insertAdjacentHTML("afterend", '<div class="tiles">' + pics.map(i => '<button class="tile" data-do="picture" data-value="' + text(i.path) + '" aria-label="' + text(i.name) + '"><img alt=""></button>').join("") + "</div>");
    wire(holder);
    if (grid) wire(holder.nextElementSibling);
    thumbs(app);
}
// The pinned projects put in order: one held down, then dragged up or down, the others moving out of its way.
function arrangePins()
{
    const box = app.querySelector("#pinned");
    if (!box) return;
    box.querySelectorAll(".item-row").forEach(row =>
    {
        let timer = null, x0 = 0, y0 = 0;
        const open = row.querySelector(".item");
        row.addEventListener("pointerdown", e =>
        {
            if (e.target.closest(".pin") || e.button > 0) return;
            x0 = e.clientX; y0 = e.clientY;
            timer = setTimeout(() => { timer = null; if (stillDown(e)) lift(e); }, 420);
        });
        const stop = () => { if (timer) clearTimeout(timer); timer = null; };
        row.addEventListener("pointermove", e => { if (timer && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 8) stop(); });
        row.addEventListener("pointerup", stop);
        row.addEventListener("pointercancel", stop);
        row.addEventListener("contextmenu", e => e.preventDefault());
        open.addEventListener("click", e => { if (row.dataset.held) { e.stopPropagation(); e.preventDefault(); delete row.dataset.held; } }, true);
        function lift(e)
        {
            row.dataset.held = "1";
            feel.hold();
            const all = [...box.querySelectorAll(".item-row")], from = all.indexOf(row), h = row.offsetHeight;
            const mids = all.map(o => { const r = o.getBoundingClientRect(); return r.top + r.height / 2; }), start = e.clientY;
            let to = from;
            row.classList.add("lifted");
            const move = ev =>
            {
                const dy = ev.clientY - start, mid = mids[from] + dy;
                row.style.transform = "translateY(" + dy + "px)";
                let now = 0;
                all.forEach((o, i) => { if (o !== row && mids[i] < mid) now++; });
                to = now;
                all.forEach((o, i) => { if (o === row) return; o.classList.add("sliding"); o.style.transform = i > from && i <= to ? "translateY(" + -h + "px)" : i < from && i >= to ? "translateY(" + h + "px)" : ""; });
            };
            const drop = () =>
            {
                if (!letScroll(drop)) return;
                document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", drop); document.removeEventListener("pointercancel", drop);
                const pins = remembered("canopy.pinned", []), path = open.dataset.value;
                if (to !== from) { const order = pins.filter(p => p !== path); order.splice(to, 0, path); remember("canopy.pinned", order); feel.drop(); }
                setTimeout(() => { delete row.dataset.held; showFiles(); }, 40);
            };
            holdScroll(drop);
            document.addEventListener("pointermove", move); document.addEventListener("pointerup", drop); document.addEventListener("pointercancel", drop);
        }
    });
}
// Pictures' previews, fetched as they come into view (Dropbox makes them, a few dozen at a time).
let shownItems = [];
const thumbCache = new Map();
function thumbs(root)
{
    const want = [], seen = new IntersectionObserver(es =>
    {
        for (const e of es) if (e.isIntersecting) { seen.unobserve(e.target); want.push(e.target); }
        clearTimeout(thumbs.t);
        thumbs.t = setTimeout(async () =>
        {
            const batch = want.splice(0), paths = batch.map(el => el.closest("[data-value]").dataset.value).filter(p => !thumbCache.has(p));
            try { if (paths.length) for (const [p, url] of await dbx.thumbnails(paths)) thumbCache.set(p, url); } catch (x) { }
            for (const el of batch) { const url = thumbCache.get(el.closest("[data-value]").dataset.value); if (url) { el.src = url; el.classList.add("in"); } }
        }, 60);
    }, { rootMargin: "300px" });
    root.querySelectorAll(".tile img, .item .thumb").forEach(img => seen.observe(img));
}
let picture = null;   // the picture open over the files: { path, el, url }
function showPicture(path)
{
    if (picture && !app.contains(picture.el)) picture = null;   // (drawn over meanwhile)
    const pics = shownItems.filter(i => i.picture);
    if (!picture)
    {
        const el = element('<div class="photo-view"><div class="photo-head"></div><div class="photo-stage"><img alt=""></div><div class="photo-count"></div></div>');
        app.appendChild(el);
        picture = { path, el, url: null, s: 1, x: 0, y: 0 };
        handlePhoto(picture);
        if (!calm) el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
    }
    const p = picture, it = pics.find(i => i.path === path), at = pics.findIndex(i => i.path === path);
    p.path = path; p.s = 1; p.x = 0; p.y = 0;
    p.el.querySelector(".photo-head").innerHTML = bar(it ? it.name : path.split("/").pop(), iconButton("closepicture", "back", "Back"), '<button class="word" data-do="addpicture">Add to canvas</button>', "on-photo");
    wire(p.el.querySelector(".photo-head"));
    footColor();
    p.el.querySelector(".photo-count").textContent = pics.length > 1 && at >= 0 ? at + 1 + " of " + pics.length : "";
    const img = p.el.querySelector("img");
    img.style.transform = "";
    img.src = thumbCache.get(path) || "";   // (its small preview first, while the big one comes)
    if (p.url) { URL.revokeObjectURL(p.url); p.url = null; }
    dbx.preview(path).then(b => { if (picture !== p || p.path !== path) return; p.url = URL.createObjectURL(b); img.src = p.url; }).catch(e => toast(e.message));
}
function closePicture()
{
    const p = picture;
    if (!p) return;
    picture = null;
    p.el.style.pointerEvents = "none";   // (going: taps go to what is under it)
    const gone = () => { p.el.remove(); if (p.url) URL.revokeObjectURL(p.url); footColor(); };
    if (calm) gone(); else p.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = gone;
}
// The next or last picture of the folder (as the history's place: going back closes the picture, not each one seen).
function nextPicture(by)
{
    const pics = shownItems.filter(i => i.picture), at = pics.findIndex(i => i.path === picture.path), to = pics[at + by];
    if (!to) { if (!calm) picture.el.querySelector("img").animate([{ transform: "translateX(" + -by * 24 + "px)" }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,1.2,.3,1)" }); return; }
    history.replaceState({ ...history.state, picture: to.path }, "");
    showPicture(to.path);
    if (!calm) picture.el.querySelector("img").animate([{ transform: "translateX(" + by * 60 + "px)", opacity: 0.3 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,.9,.3,1)" });
}
function handlePhoto(p)
{
    const stage = p.el.querySelector(".photo-stage"), img = () => stage.querySelector("img");
    const pts = new Map();
    let start = null, lastTap = 0;
    const put = () => { img().style.transform = "translate(" + p.x + "px," + p.y + "px) scale(" + p.s + ")"; };
    stage.addEventListener("pointerdown", e =>
    {
        stage.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const all = [...pts.values()];
        start = { s: p.s, x: p.x, y: p.y, pts: all.map(o => ({ ...o })), t: performance.now() };
    });
    stage.addEventListener("pointermove", e =>
    {
        if (!pts.has(e.pointerId) || !start) return;
        pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const all = [...pts.values()];
        if (all.length >= 2 && start.pts.length >= 2)
        {
            const d0 = Math.hypot(start.pts[0].x - start.pts[1].x, start.pts[0].y - start.pts[1].y), d1 = Math.hypot(all[0].x - all[1].x, all[0].y - all[1].y);
            const m0 = { x: (start.pts[0].x + start.pts[1].x) / 2, y: (start.pts[0].y + start.pts[1].y) / 2 }, m1 = { x: (all[0].x + all[1].x) / 2, y: (all[0].y + all[1].y) / 2 };
            const r = stage.getBoundingClientRect(), cx = m0.x - r.left - r.width / 2, cy = m0.y - r.top - r.height / 2;
            const s = Math.max(1, Math.min(8, start.s * d1 / Math.max(1, d0))), k = s / start.s;
            p.s = s; p.x = cx - (cx - start.x) * k + (m1.x - m0.x); p.y = cy - (cy - start.y) * k + (m1.y - m0.y);
        }
        else if (all.length === 1)
        {
            const dx = all[0].x - start.pts[0].x, dy = all[0].y - start.pts[0].y;
            if (p.s > 1.01) { p.x = start.x + dx; p.y = start.y + dy; }
            else { p.x = dx; p.y = 0; }   // (not zoomed: it slides, to be swiped on)
        }
        put();
    });
    const up = e =>
    {
        if (!pts.has(e.pointerId)) return;
        const was = start, wasPts = pts.size;
        pts.delete(e.pointerId);
        if (pts.size) { const all = [...pts.values()]; start = { s: p.s, x: p.x, y: p.y, pts: all.map(o => ({ ...o })), t: performance.now() }; return; }
        start = null;
        if (!was) return;
        const moved = Math.hypot(e.clientX - was.pts[0].x, e.clientY - was.pts[0].y);
        if (wasPts === 1 && moved < 8 && performance.now() - was.t < 300)
        {
            // A double tap: in closer there, or back out.
            const now = performance.now();
            if (now - lastTap < 300)
            {
                lastTap = 0;
                const r = stage.getBoundingClientRect(), cx = e.clientX - r.left - r.width / 2, cy = e.clientY - r.top - r.height / 2;
                if (p.s > 1.01) { p.s = 1; p.x = 0; p.y = 0; } else { p.s = 2.5; p.x = -cx * 1.5; p.y = -cy * 1.5; }
                img().style.transition = "transform .25s cubic-bezier(.2,.9,.3,1)"; put(); setTimeout(() => { img().style.transition = ""; }, 260);
                return;
            }
            lastTap = now;
            return;
        }
        if (p.s <= 1.01)
        {
            // A swipe: on to the next (or last) one; not far enough, back where it was.
            if (Math.abs(p.x) > 70) { const by = p.x < 0 ? 1 : -1; p.x = 0; nextPicture(by); return; }
            p.s = 1; p.x = 0; p.y = 0;
            img().style.transition = "transform .2s cubic-bezier(.2,1.2,.3,1)"; put(); setTimeout(() => { img().style.transition = ""; }, 220);
        }
    };
    stage.addEventListener("pointerup", up);
    stage.addEventListener("pointercancel", up);
}

// "Add to canvas": which project (pinned, lately opened, this folder's), opened, and then where in it: the canvas, or
// one of its boards; the picture (as Dropbox makes it, at most 2048 across) placed there, picked, to be put right.
function addPicture()
{
    if (!picture) return;
    const path = picture.path, name = path.split("/").pop();
    const projects = [...new Set([...remembered("canopy.pinned", []), ...remembered("canopy.recent", []), ...shownItems.filter(i => !i.folder && !i.picture).map(i => i.path)])];
    if (!projects.length) { toast("No projects to add it to yet"); return; }
    const build = () => '<div class="ptitle">Add to which project?</div><div class="scroll">' + projects.map(r => '<button class="pick" data-do="to" data-value="' + text(r) + '"><span>' + text(fileName(r)) + '</span><span class="kind-name">' + text(r.split("/").slice(-2, -1)[0] || "Dropbox") + "</span></button>").join("") + "</div>";
    sheetUp(build, async (does, value, close) =>
    {
        if (does !== "to") return;
        close(() => { });
        let blob;
        try { blob = await dbx.preview(path); }
        catch (e) { toast(e.message); return; }
        const file = new File([blob], name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" });
        closePicture();
        await go({ project: value });
        if (!project || project.path !== value) return;
        if (project.base.doc.readOnly) { toast("This project can't be changed here"); return; }
        const boards = project.scene.boards;
        if (!boards.length) { tab = "canvas"; remember("canopy.tab", tab); show(); addPhoto(file); return; }
        sheetUp(() => '<div class="ptitle">Put it on…</div><div class="scroll"><button class="pick" data-do="on" data-value=""><span>The canvas</span>' + icon("canvas", 18) + "</button>"
            + '<div class="section">Boards</div>' + boards.map(b => '<button class="pick" data-do="on" data-value="' + text(b.id) + '"><span>' + text(b.name) + "</span></button>").join("") + "</div>",
            (d, id, shut) => { if (d !== "on") return; shut(() => { if (id) openBoard(id, null); else { tab = "canvas"; remember("canopy.tab", tab); show(); } addPhoto(file); }); });
    });
}

// A heading as the desktop app's are: its words, after the arrow that folds what is under it away (and back).
function folded() { return remembered("canopy.folded", []); }
function heading(key, words)
{
    const shut = folded().includes(key);
    return '<h2 class="section' + (shut ? " shut" : "") + '"><button data-do="fold" data-value="' + key + '" aria-expanded="' + !shut + '">' + icon(shut ? "chevron" : "open", 12) + "<span>" + text(words) + "</span></button></h2>";
}
// A row as the desktop app's project lists have them: the name, a faded note at the right (when it was saved, or where it
// is); a folder marked as one, and goes on into it; a project can be pinned.
function item(kind, name, note, does, value)
{
    const pinned = kind === "file" && remembered("canopy.pinned", []).includes(value);
    return '<div class="item-row"><button class="item' + (kind === "folder" ? " folder" : "") + '" data-do="' + does + '" data-value="' + text(value) + '">'
        + (kind === "folder" ? icon("folder", 18) : kind === "picture" ? '<img class="thumb" alt="">' : "") + '<span class="name">' + text(name) + "</span>"
        + (note ? '<span class="note">' + text(note) + "</span>" : "") + (kind === "folder" ? icon("chevron", 16) : "") + "</button>"
        + (kind === "file" ? '<button class="pin' + (pinned ? " on" : "") + '" data-do="pin" data-value="' + text(value) + '" aria-label="' + (pinned ? "Unpin" : "Pin to the top") + '" title="' + (pinned ? "Unpin" : "Pin to the top") + '">' + icon("pin", 16) + "</button>" : "") + "</div>";
}
// When it was saved, briefly: the time today, the day this year, else the day and year.
function when(iso)
{
    if (!iso) return "";
    const d = new Date(iso), now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString(undefined, d.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
}
function localOpener()
{
    return '<div class="local"><button class="quiet-button" data-do="pick">Open a project from this phone</button><span>Changes to a project opened this way stay on this phone until you save a copy.</span>'
        + '<input class="hidden-input" type="file" id="picker"></div>';
}

// The pictures of whichever project is open (it changes as the project is saved and read again).
function pictureGetter() { const g = (f, want) => project && project.get(f, want); g.begin = () => { if (project && project.get.begin) project.get.begin(); }; return g; }

// ---- a project: three tabs (its lists, its boards, the canvas), and a list or board opened over them ----

function current() { return project && open && open.kind === "list" ? project.view.lists.find(l => l.id === open.id) : null; }
function sortedLists()
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

// Two columns, each card going into the shorter one (so they sit together however tall they are).
let oneColumn = remembered("canopy.onecolumn", false);   // the lists in one column (the account menu's)
function masonry(holder, cards, single)
{
    const wide = Math.min(holder.clientWidth || innerWidth, 1100), n = single ? 1 : wide >= 1000 ? 4 : wide >= 720 ? 3 : 2;   // (more columns on a wider screen)
    holder.innerHTML = '<div class="masonry">' + '<div class="col"></div>'.repeat(n) + "</div>";
    const cols = holder.querySelectorAll(".col"), heights = new Array(n).fill(0);
    for (const c of cards)
    {
        const k = heights.indexOf(Math.min(...heights));
        cols[k].appendChild(c.el);
        heights[k] += c.weight + 1;
    }
}
function element(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function showLists(holder)
{
    closeViewers();
    const lists = sortedLists();
    if (lists.length === 0) { holder.innerHTML = '<div class="empty big">No lists in this project yet' + (project.base.doc.readOnly ? "" : '<br><button class="quiet-button" data-do="newlist">New list</button>') + "</div>"; wire(holder); return; }
    const cards = lists.map(l => ({ id: l.id, el: element(listCard(l)), weight: 3 + guessTall(l) / 52 }));
    masonry(holder, cards, oneColumn);
    trimCards(holder);
    if (!project.base.doc.readOnly) arrangeCards(holder, cards);
    if (project.base.doc.readOnly) holder.insertAdjacentHTML("afterbegin", '<div class="problem">This project was saved by an older version of Canopy Board, so it can be looked at here but not changed. Open and save it in Canopy Board to update it.</div>');
    if (problem) holder.insertAdjacentHTML("afterbegin", '<div class="problem">' + text(problem) + "</div>");
    wire(holder);
}
function visible(l) { return l.rows.filter(r => l.showDone || !r.done); }

// A list's card held down: lifted, and dragged to where it should be among the others, which make room for it as it
// goes (in the columns again, in the order it would leave); let go, that order is kept in the project.
let listMoved = 0, holdPending = null;   // when the lists last scrolled; the hold to let go of if they do
const watched = new WeakSet();
function arrangeCards(holder, cards)
{
    const scroller = holder;   // (#tab: scrolled while a card is held near its top or bottom)
    // A hold is a finger kept still on a card, the list not moving: not one stopping the list as it glides, or the
    // first slow moment of a scroll (which would take the card up and keep the list from scrolling).
    if (!watched.has(scroller)) { watched.add(scroller); scroller.addEventListener("scroll", () => { listMoved = performance.now(); if (holdPending) holdPending(); }, { passive: true }); }
    for (const c of cards)
    {
        let timer = null, x0 = 0, y0 = 0, top = 0;
        const el = c.el;
        el.addEventListener("pointerdown", e =>
        {
            if (e.button > 0) return;
            if (performance.now() - listMoved < 250) return;   // (gliding still: this press only stops it)
            x0 = e.clientX; y0 = e.clientY; top = scroller.scrollTop;
            el.classList.add("pressing");
            holdPending = stop;
            timer = setTimeout(() =>
            {
                timer = null; holdPending = null; el.classList.remove("pressing");
                if (stillDown(e) && el.isConnected && scroller.scrollTop === top) lift(c, e);
            }, 450);
        });
        const stop = () => { if (timer) clearTimeout(timer); timer = null; if (holdPending === stop) holdPending = null; el.classList.remove("pressing"); };
        el.addEventListener("pointermove", e => { if (timer && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 6) stop(); });
        el.addEventListener("pointerup", stop);
        el.addEventListener("pointercancel", stop);
        el.addEventListener("contextmenu", e => e.preventDefault());
        el.addEventListener("click", e => { if (el.dataset.held) { e.stopPropagation(); e.preventDefault(); delete el.dataset.held; } }, true);
    }
    function lift(c, e)
    {
        const el = c.el, r = el.getBoundingClientRect();
        el.dataset.held = "1";
        feel.hold();
        // What follows the finger: a copy of the card; the card itself stays as the gap it will drop into.
        const ghost = el.cloneNode(true);
        ghost.classList.add("ghost");
        Object.assign(ghost.style, { left: r.left + "px", top: r.top + "px", width: r.width + "px" });
        document.body.appendChild(ghost);
        el.classList.add("gap");
        let order = cards.slice(), dx = e.clientX - r.left, dy = e.clientY - r.top, px = e.clientX, py = e.clientY, scroll = 0, settling = 0;
        const place = () =>
        {
            ghost.style.transform = "translate(" + (px - dx - r.left) + "px," + (py - dy - r.top) + "px) scale(1.04) rotate(-1deg)";
            // Where it would go: only once the finger is over another card (not the gap, not between cards), and past
            // that card's middle the way it is going: before it, coming from below or the right; after it, from above
            // or the left. Never while the cards are still sliding into their places from the last move (or the card
            // just moved would move straight back: two cards swapping back and forth).
            if (performance.now() < settling) return;
            const at = order.indexOf(c), over = order.find(o => { if (o === c) return false; const b = o.el.getBoundingClientRect(); return px >= b.left && px <= b.right && py >= b.top && py <= b.bottom; });
            if (!over) return;
            const b = over.el.getBoundingClientRect(), to = order.indexOf(over), mid = b.top + b.height / 2;
            const before = at > to;   // (it is after that card now: it goes before it once above that card's middle)
            if (before ? py > mid : py < mid) return;
            const now = order.filter(o => o !== c);
            now.splice(now.indexOf(over) + (before ? 0 : 1), 0, c);
            if (now.some((o, i) => o !== order[i])) { order = now; relayout(); settling = performance.now() + 240; }
        };
        const relayout = () =>
        {
            // (each card slides from where it was to where it now is)
            const was = new Map(order.map(o => [o, o.el.getBoundingClientRect()]));
            masonry(holder, order, oneColumn);
            if (calm) return;
            for (const o of order)
            {
                const a = was.get(o), b = o.el.getBoundingClientRect();
                if (Math.abs(a.left - b.left) + Math.abs(a.top - b.top) > 1) o.el.animate([{ transform: "translate(" + (a.left - b.left) + "px," + (a.top - b.top) + "px)" }, { transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.9,.3,1)" });
            }
        };
        const edge = () =>
        {
            // Near the top or bottom: scrolled along.
            const b = scroller.getBoundingClientRect(), v = py < b.top + 70 ? -10 : py > b.bottom - 70 ? 10 : 0;
            if (v) { scroller.scrollTop += v; place(); }
            scroll = requestAnimationFrame(edge);
        };
        scroll = requestAnimationFrame(edge);
        const move = ev => { px = ev.clientX; py = ev.clientY; place(); };
        const drop = () =>
        {
            if (!letScroll(drop)) return;
            document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", drop); document.removeEventListener("pointercancel", drop);
            cancelAnimationFrame(scroll);
            const b = el.getBoundingClientRect();
            const done = () => { ghost.remove(); el.classList.remove("gap"); };
            if (calm) done();
            else ghost.animate([{ transform: ghost.style.transform }, { transform: "translate(" + (b.left - r.left) + "px," + (b.top - r.top) + "px)" }], { duration: 200, easing: "cubic-bezier(.2,.9,.3,1)", fill: "forwards" }).onfinish = done;
            const ids = order.map(o => o.id), was = sortedLists().map(l => l.id);
            if (ids.some((id, i) => id !== was[i])) { step({ t: "order", ids, list: null }); feel.drop(); }
            setTimeout(() => { delete el.dataset.held; }, 60);
        };
        // (followed from the page, not the card: the card itself moves among the columns as it goes)
        holdScroll(drop);
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", drop); document.addEventListener("pointercancel", drop);
        place();
    }
}
// A list's card shows its first entries, as many as fill about the same height (PEEK, in pixels), so short entries
// show more of the list and long ones fewer (each at most two lines), at least one: drawn with a dozen, then cut to
// fit once laid out (trimCards). Its weight in the columns, before then, is guessed from the entries' lengths.
const PEEK = 250;
function guessTall(l)
{
    let tall = 0;
    for (const r of visible(l).slice(0, 12)) tall += r.kind === "D" ? 17 : r.kind === "H" ? 29 : 25 + 16 * Math.min(2, Math.max(1, Math.ceil(cnpy.plain(r.text || "").length / 16)));
    return Math.min(PEEK, tall);
}
function trimCards(holder)
{
    holder.querySelectorAll(".lcard").forEach(card =>
    {
        const rows = [...card.querySelectorAll(":scope > .e, :scope > .d")], more = card.querySelector(".more");
        if (!rows.length) return;
        const top = rows[0].getBoundingClientRect().top;
        let kept = rows.findIndex((r, i) => i > 0 && r.getBoundingClientRect().bottom - top > PEEK);
        if (kept < 0) kept = rows.length;
        rows.slice(kept).forEach(r => r.remove());
        const hidden = Number(card.dataset.count) - kept;
        if (hidden > 0) more.textContent = "+" + hidden + " more"; else more.remove();
    });
}
function listCard(l)
{
    const c = render.listLook(l), rows = visible(l), shown = rows.slice(0, 12);
    return '<button class="lcard" data-do="list" data-value="' + text(l.id) + '" data-count="' + rows.length + '" style="background:' + c.card + ";color:" + c.onCard + '">'
        + '<div class="band" style="background:' + c.stripe + '"></div><div class="title">' + text(l.name || "List") + "</div>"
        + shown.map(r => r.kind === "D" ? '<div class="d" style="background:' + render.shade(c.tile, 0.14) + '"></div>'
            : '<div class="e ' + r.kind + (r.done ? " done" : "") + '" style="' + (r.kind === "H" ? "" : "background:" + c.tile + ";color:" + c.ink) + '">'
                + (r.kind === "T" ? '<span class="box" style="border-color:' + (r.color || c.box) + (r.done ? ";background:" + (r.color || c.box) : "") + '"></span>' : "")
                + "<span>" + text(cnpy.plain(r.text)) + "</span></div>").join("")
        + '<div class="more"></div>'
        + "</button>";
}

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
        if (b) thumbnail(el.querySelector("canvas"), project.scene, b, project.get, doc.canvas);
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
function fitAll(glide) { if (canvasView) canvasView.fit(render.extent(project.scene), 0.06, glide); }
// ---- objects picked on the canvas (or in a board): moved by dragging, sized by a corner, deleted ----

let picked = null;   // { ids, list (a list picked on its own: it can be opened), viewer }
let lifted = false;  // what is picked being moved or sized by a finger (drawn lifted)

function editable(v)
{
    v.onTap = (x, y) =>
    {
        // (drawing: a tap is a dot, not a pick; with Select, a pick; with Fill or the Eyedropper, theirs)
        if (!pen || pen.kind === "select") tapObject(v, x, y);
        else if (pen.kind === "fill") fillAt(v, v.toScreen(x, y));
        else if (pen.kind === "dropper") dropperAt(v, v.toScreen(x, y));
    };
    v.overlay = ctx => { drawPicked(v, ctx); drawSelection(v, ctx); };
    v.grab = (at, e) => pen ? drawPress(v, at, e) : grabPicked(v, at);
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
function pick(p, v)
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
function grabPicked(v, at)
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
// The bar of what can be done to what is picked, along the bottom of the canvas.
function tools(v)
{
    const host = v.host.parentNode;
    let bar = host.querySelector(".tools");
    if (pen) { drawBar(v, bar, host); return; }
    if (bar && bar.classList.contains("drawbar")) { bar.remove(); bar = null; }
    const pasting = !picked && clip && !project.base.doc.readOnly;
    if (!picked && !pasting) { if (bar) bar.remove(); return; }
    if (!bar) { bar = element('<div class="tools"></div>'); host.appendChild(bar); if (!calm) bar.animate([{ transform: "translateY(16px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,1.2,.3,1)" }); }
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
    bar.innerHTML = '<span class="what">' + (shut ? icon("lock", 15) : "") + (picked.list ? "List" : n > 1 ? "Group of " + n : kindName(picked.ids[0])) + "</span>"
        + (href ? '<button data-act="link" class="linkto">' + icon("link", 15) + "<span>" + text(linkWords(href)) + "</span></button>" : "")
        + (picked.list ? '<button data-act="open">Open</button>' : "")
        + '<button data-act="lock">' + (shut ? "Unlock" : "Lock") + "</button>"
        + '<button data-act="copy">Copy</button>'
        + (shut ? "" : '<button data-act="delete" class="danger">Delete</button>') + '<button data-act="done">Done</button>';
    bar.querySelectorAll("button").forEach(b => b.addEventListener("click", () =>
    {
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

// ---- drawing: strokes on the canvas or a board, kept as points (each a step, undone as one) and painted into a
// drawing layer's tiles as the project is saved (paintSketches), as Board keeps its own. They go on the drawing being
// drawn on (project.drawOn) until another is chosen (in the hierarchy) or a new one asked for: saved or not, it is
// drawn on and rubbed out the same, its pixels and the new strokes painted together each time it is saved ----

let pen = null;          // drawing: { kind: the tool in use, slots: the tool each of the bar's slots shows, size (on the screen), color }; null when not
let sketchId = null;     // the strokes on a saved drawing since it was last saved: kept together under this id
let paintSel = null;     // what is selected of the drawing being drawn on (Drawing Select): { pts: its outline, on the canvas }
const SIZE = { least: 1, most: 80, start: 8 };   // the brush's size, on the screen
// The palette to begin with (each phone keeps its own, changed as it likes): grays, then round the colors.
const PALETTE = ["#151616", "#FFFFFF", "#7C807E", "#C9CCCA", "#E05A47", "#F28C38", "#F2C53A", "#4FB477", "#2FA3A0", "#3F8FD8", "#8E5BD6", "#E45FA8", "#8B5E3C", "#F1D7B0"];
// The drawing bar's three slots, each holding a few tools: a tap uses the one it shows, a tap again (or a press and
// hold) picks another.
const SLOTS = [
    { id: "pick", tools: [["select", "select", "Select"], ["rect", "selrect", "Drawing Select (box)"], ["lasso", "sellasso", "Drawing Select (lasso)"]] },
    { id: "brush", tools: [["pen", "ink", "Ink"], ["flat", "flat", "Flat"]] },
    { id: "rub", tools: [["erase", "eraser", "Eraser"], ["fill", "fill", "Fill"], ["dropper", "dropper", "Eyedropper"]] }
];
const TOOL_OF = Object.fromEntries(SLOTS.flatMap(sl => sl.tools.map(t => [t[0], { slot: sl.id, icon: t[1], name: t[2] }])));
function drawMode()
{
    const v = boardView || canvasView;
    if (!v || !project || project.base.doc.readOnly) return;
    if (pen) { endDrawing(v); return; }
    const was = remembered("canopy.pen", null) || {};
    const slots = { pick: "select", brush: "pen", rub: "erase" };
    for (const k in was.slots || {}) if (TOOL_OF[was.slots[k]] && TOOL_OF[was.slots[k]].slot === k) slots[k] = was.slots[k];   // (one no longer on the bar, the Marker: the first)
    const kind = TOOL_OF[was.kind] && was.kind !== "dropper" ? was.kind : "pen";
    const size = was.size >= SIZE.least && was.size <= SIZE.most ? was.size : SIZE.start, opacity = was.opacity > 0 && was.opacity <= 1 ? was.opacity : 1;
    pen = { kind, slots, size, opacity, color: was.color || (project.base.doc.recent || [])[0] || PALETTE[0] };
    pick(null, v);
    corner();
}
function endDrawing(v)
{
    pen = null; paintSel = null; closePop();
    if (v) tools(v);
    corner();
    redrawViewers();
    if (project && project.steps.length) { clearTimeout(saveTimer); save(); }
}
// The drawing strokes go on from now (null: a new one, made with the next stroke), kept for next time.
function drawOnto(id) { project.drawOn = id; sketchId = null; paintSel = null; remember("canopy.drawon." + project.path, id); }
function keepPen() { remember("canopy.pen", { kind: pen.kind, slots: pen.slots, size: pen.size, opacity: pen.opacity, color: pen.color }); }
function useTool(kind, v)
{
    if (!TOOL_OF[kind]) return;
    if (pen.kind !== kind && TOOL_OF[pen.kind].slot === "pick" && TOOL_OF[kind].slot !== "pick") { paintSel = null; }
    pen.kind = kind; pen.slots[TOOL_OF[kind].slot] = kind;
    if (kind !== "select" && picked) pick(null, v);
    keepPen(); tools(v); v.redraw();
}
function drawBar(v, bar, host)
{
    if (!bar) { bar = element('<div class="tools drawbar"></div>'); host.appendChild(bar); }
    bar.classList.add("drawbar");
    const slot = sl =>
    {
        const k = pen.slots[sl.id], t = TOOL_OF[k], on = TOOL_OF[pen.kind].slot === sl.id;
        return '<button class="glyph slot' + (on ? " on" : "") + '" data-slot="' + sl.id + '" aria-label="' + t.name + ' (tap again for more)" title="' + t.name + '">' + icon(t.icon, 20) + '<i class="more"></i></button>';
    };
    bar.innerHTML = SLOTS.map(slot).join("") + '<span class="sep"></span>'
        + '<button class="glyph ink" data-act="ink" aria-label="Brush and color" title="Brush and color">' + dot(pen.size, pen.color, pen.opacity) + "</button>"
        + (paintSel ? '<button class="glyph" data-act="clear" aria-label="Delete what&#39;s selected" title="Delete what&#39;s selected">' + icon("trash", 20) + "</button>" : "")
        + '<button class="glyph" data-act="newdrawing" aria-label="New drawing" title="New drawing">' + icon("adddrawing", 20) + "</button>"
        + '<button class="done" data-act="done">Done</button>';
    // (the slot in use, tapped again: its tools, as a held one shows them)
    bar.querySelectorAll("[data-slot]").forEach(b => holdable(b, () => { if (TOOL_OF[pen.kind].slot === b.dataset.slot) slotPop(v, b); else useTool(pen.slots[b.dataset.slot], v); }, () => slotPop(v, b)));
    bar.querySelector('[data-act="ink"]').addEventListener("click", e => { const b = e.currentTarget; if (popOf === b) closePop(); else inkPop(v, b); });
    const clear = bar.querySelector('[data-act="clear"]');
    if (clear) clear.addEventListener("click", () => clearSelection(v));
    bar.querySelector('[data-act="newdrawing"]').addEventListener("click", () => { closePop(); drawOnto(null); if (TOOL_OF[pen.kind].slot !== "brush") useTool(pen.slots.brush, v); toast("Your next stroke starts a new drawing"); });
    bar.querySelector('[data-act="done"]').addEventListener("click", () => endDrawing(v));
}
// A button that does one thing when tapped and another when held (the bar's slots: their choices).
function holdable(b, tap, hold)
{
    let timer = null, held = false;
    b.addEventListener("pointerdown", () => { held = false; clearTimeout(timer); timer = setTimeout(() => { held = true; feel.pick(); hold(); }, 380); });
    const stop = () => clearTimeout(timer);
    b.addEventListener("pointerup", stop); b.addEventListener("pointercancel", stop); b.addEventListener("pointerleave", stop);
    b.addEventListener("contextmenu", e => e.preventDefault());
    b.addEventListener("click", () => { if (held) { held = false; return; } if (popOf === b) { closePop(); return; } closePop(); tap(); });
}
function dot(size, color, opacity) { const d = Math.max(5, Math.min(24, 4 + size * 0.45)); return '<i style="width:' + d + "px;height:" + d + "px;background:" + color + (opacity < 1 ? ";opacity:" + opacity : "") + '"></i>'; }

// ---- a popover from a button on the drawing bar: a card with a tab reaching down over its button, the two one shape
// (as Board's Drawing Bar has them); the button under the tab shows it can be put away there ----

let popOf = null, popEl = null;
function closePop() { if (popEl) popEl.remove(); popEl = null; if (popOf) popOf.classList.remove("popped"); popOf = null; document.removeEventListener("pointerdown", popAway, true); }
function popAway(e) { if (popEl && !popEl.contains(e.target) && !(popOf && popOf.contains(e.target))) closePop(); }
function popFrom(btn, html, wire)
{
    closePop();
    const bar = btn.closest(".drawbar"), frame = bar.parentNode, fb = frame.getBoundingClientRect(), bb = btn.getBoundingClientRect();
    const el = element('<div class="pop"><svg class="shape"><path/></svg><div class="card">' + html + "</div></div>");
    frame.appendChild(el);
    const card = el.querySelector(".card");
    // Its shape and place, from the card's size: again whenever what it shows changes size ("place").
    const arrow = element('<i class="down"></i>');
    el.appendChild(arrow);
    const place = () =>
    {
        const scrolled = card.scrollTop;
        card.style.maxHeight = ""; card.style.overflowY = "";
        const gap = 12, r = 8, f = 8, foot = 7, barTop = bar.getBoundingClientRect().top - fb.top;
        // (taller than the room above the bar, the phone on its side: as tall as there is room for, scrolled)
        const room0 = barTop - gap - 8;
        if (card.offsetHeight > room0) Object.assign(card.style, { maxHeight: Math.max(120, room0) + "px", overflowY: "auto" });
        const W = card.offsetWidth, body = card.offsetHeight;
        const sw = bb.width + 4, sx = bb.left - fb.left - 2, stTop = bb.top - fb.top - 2, stBot = bb.bottom - fb.top + 2;
        const room = fb.width - 8;
        let L = sx + sw / 2 - W / 2;
        L = Math.max(8, Math.min(L, room - W));
        const top = barTop - gap - body;   // (clear of the bar, comfortably, as Board's are: only its tab reaches down)
        const x = sx - L;
        const flushL = x < r + f + 2, flushR = x + sw > W - r - f - 2;
        if (flushL) L = sx; else if (flushR) L = sx + sw - W;
        const X = sx - L, H = stBot - top;
        let d = "M" + r + ",0.5 L" + (W - r) + ",0.5 A" + r + "," + r + " 0 0 1 " + (W - 0.5) + "," + r;
        if (flushR) d += " L" + (W - 0.5) + "," + (H - foot) + " A" + foot + "," + foot + " 0 0 1 " + (W - foot) + "," + (H - 0.5);
        else d += " L" + (W - 0.5) + "," + (body - r) + " A" + r + "," + r + " 0 0 1 " + (W - r) + "," + (body - 0.5) + " L" + (X + sw + f) + "," + (body - 0.5) + " A" + f + "," + f + " 0 0 0 " + (X + sw - 0.5) + "," + (body + f) + " L" + (X + sw - 0.5) + "," + (H - foot) + " A" + foot + "," + foot + " 0 0 1 " + (X + sw - foot) + "," + (H - 0.5);
        if (flushL) d += " L" + foot + "," + (H - 0.5) + " A" + foot + "," + foot + " 0 0 1 0.5," + (H - foot);
        else d += " L" + (X + foot) + "," + (H - 0.5) + " A" + foot + "," + foot + " 0 0 1 " + (X + 0.5) + "," + (H - foot) + " L" + (X + 0.5) + "," + (body + f) + " A" + f + "," + f + " 0 0 0 " + (X - f) + "," + (body - 0.5) + " L" + r + "," + (body - 0.5) + " A" + r + "," + r + " 0 0 1 0.5," + (body - r);
        d += " L0.5," + r + " A" + r + "," + r + " 0 0 1 " + r + ",0.5 Z";
        Object.assign(el.style, { left: L + "px", top: top + "px", width: W + "px", height: H + "px" });
        const svg = el.querySelector("svg");
        svg.setAttribute("width", W); svg.setAttribute("height", H); svg.setAttribute("viewBox", "0 0 " + W + " " + H);
        svg.querySelector("path").setAttribute("d", d);
        Object.assign(arrow.style, { left: X + sw / 2 - 5 + "px", top: H - (stBot - stTop) / 2 - 3 + "px" });
        card.scrollTop = scrolled;
    };
    place();
    el.place = place;
    // (its tab is pressed to put it away; not by the lifting of the finger that held its button down to open it)
    let fresh = true;
    el.addEventListener("pointerdown", () => { fresh = false; }, true);
    arrow.addEventListener("click", () => { if (!fresh) closePop(); });
    btn.classList.add("popped");
    popOf = btn; popEl = el;
    if (!calm) el.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 160, easing: "cubic-bezier(.2,.9,.3,1)" });
    setTimeout(() => document.addEventListener("pointerdown", popAway, true), 0);
    if (wire) wire(card);
}
// A slot held: its tools, the one it shows lit.
function slotPop(v, b)
{
    const sl = SLOTS.find(x => x.id === b.dataset.slot);
    popFrom(b, '<div class="choices">' + sl.tools.map(t => '<button class="glyph' + (pen.slots[sl.id] === t[0] ? " on" : "") + '" data-tool="' + t[0] + '" aria-label="' + t[2] + '" title="' + t[2] + '">' + icon(t[1], 20) + "</button>").join("") + "</div>",
        card => card.querySelectorAll("[data-tool]").forEach(x => x.addEventListener("click", () => { closePop(); useTool(x.dataset.tool, v); })));
}
// The brush and its color, as Board's Quick Color has them: its size and how opaque, the color (a field of its
// saturation and brightness, and hue, saturation and brightness to slide), and the palette, this phone's own to add to
// and take from. It stays open while it is used; a tap away, or on its tab, puts it away.
function inkPop(v, b)
{
    const pal = () => remembered("canopy.palette", null) || PALETTE.slice();
    let hsv = toHsv(pen.color), editing = false, shown = 0;
    const hue = h => "hsl(" + h + ",100%,50%)";
    // (a slider the whole width; Size and Opacity, each with its mark before it)
    const sizeMark = () => '<i class="qsize" aria-hidden="true" style="width:' + markOf(pen.size) + "px;height:" + markOf(pen.size) + 'px"></i>';
    const marks = { size: sizeMark(), opacity: icon("opacity", 20) };
    const slider = (id, label, min, max, step, val) => '<div class="qrow' + (label ? " named" : "") + '">' + (label ? '<span class="qmark" title="' + label + '">' + marks[id] + "</span>" : "") + '<input type="range" class="qslide" data-q="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + val + '" aria-label="' + ({ h: "Hue", s: "Saturation", v: "Brightness" }[id] || label) + '"></div>';
    const swatches = () => pal().map(c => '<button class="qcolor' + (!editing && c === pen.color.toUpperCase() ? " on" : "") + (editing ? " gone" : "") + '" data-ink="' + c + '" style="background:' + c + '" aria-label="' + (editing ? "Remove " : "") + c + '">' + (editing ? icon("close", 14) : "") + "</button>").join("");
    const html = '<div class="quick">'
        + slider("size", "Size", 0, 1, 0.001, sizeAt(pen.size)) + slider("opacity", "Opacity", 5, 100, 1, Math.round(pen.opacity * 100))
        + '<hr class="qline"><div class="qfield"><i class="qknob"></i></div>'
        + slider("h", "", 0, 360, 1, hsv[0]) + slider("s", "", 0, 100, 1, hsv[1]) + slider("v", "", 0, 100, 1, hsv[2])
        + '<hr class="qline"><div class="qpal"><span>Palette</span><button class="qicon" data-q="add" aria-label="Add the current color" title="Add the current color">' + icon("plus", 18) + '</button><button class="qicon" data-q="edit" aria-label="Remove colors" title="Remove colors">' + icon("more", 18) + "</button></div>"
        + '<div class="qswatches">' + swatches() + '</div><div class="qedit"><button class="qbtn" data-q="reset">Reset</button><button class="qbtn" data-q="done">Done</button></div></div>';
    popFrom(b, html, card =>
    {
        const field = card.querySelector(".qfield"), knob = card.querySelector(".qknob"), inks = card.querySelector(".qswatches");
        const q = id => card.querySelector('[data-q="' + id + '"]');
        const show = () =>
        {
            const [h, sa, va] = hsv;
            field.style.background = "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, " + hue(h) + ")";
            knob.style.left = sa + "%"; knob.style.top = 100 - va + "%"; knob.style.background = pen.color;
            q("h").value = h; q("s").value = sa; q("v").value = va;
            q("h").style.background = "linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)";
            q("s").style.background = "linear-gradient(to right, " + fromHsv(h, 0, va) + ", " + fromHsv(h, 100, va) + ")";
            q("v").style.background = "linear-gradient(to right, #000, " + fromHsv(h, sa, 100) + ")";
            q("opacity").style.background = "linear-gradient(to right, transparent, " + pen.color + "), repeating-conic-gradient(#888 0 25%, #bbb 0 50%) 0 0 / 10px 10px";
            inks.innerHTML = swatches();
            card.querySelector(".qedit").hidden = !editing;
            b.innerHTML = dot(pen.size, pen.color, pen.opacity);
            const tall = card.offsetHeight;
            if (tall !== shown && popEl && popEl.place) { shown = tall; popEl.place(); }   // (the palette grown or shrunk: the card fitted to it)
        };
        const take = (c, from) =>
        {
            pen.color = c.toUpperCase();
            if (from !== "hsv") hsv = toHsv(pen.color);
            if (TOOL_OF[pen.kind].slot !== "brush" && pen.kind !== "fill") { pen.kind = pen.slots.brush; markSlots(v); }   // (a color is to paint with)
            keepPen(); show();
        };
        const setHsv = (h, sa, va) => { hsv = [h, sa, va]; take(fromHsv(h, sa, va), "hsv"); };
        // The field: dragged across for saturation, up and down for brightness.
        field.addEventListener("pointerdown", e =>
        {
            field.setPointerCapture(e.pointerId);
            const at = ev => { const r = field.getBoundingClientRect(); setHsv(hsv[0], Math.round(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * 100), Math.round((1 - Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height))) * 100)); };
            at(e);
            const mv = ev => at(ev), up = () => { field.removeEventListener("pointermove", mv); field.removeEventListener("pointerup", up); field.removeEventListener("pointercancel", up); };
            field.addEventListener("pointermove", mv); field.addEventListener("pointerup", up); field.addEventListener("pointercancel", up);
        });
        for (const k of ["h", "s", "v"]) q(k).addEventListener("input", () => setHsv(+q("h").value, +q("s").value, +q("v").value));
        q("size").addEventListener("input", () => { pen.size = sizeOf(+q("size").value); keepPen(); b.innerHTML = dot(pen.size, pen.color, pen.opacity); card.querySelector(".qmark .qsize").outerHTML = sizeMark(); });
        q("opacity").addEventListener("input", () => { pen.opacity = +q("opacity").value / 100; keepPen(); b.innerHTML = dot(pen.size, pen.color, pen.opacity); });
        inks.addEventListener("click", e =>
        {
            const x = e.target.closest("[data-ink]");
            if (!x) return;
            if (editing) { remember("canopy.palette", pal().filter(c => c !== x.dataset.ink)); feel.gone(); show(); }
            else take(x.dataset.ink);
        });
        q("add").addEventListener("click", () => { const c = pen.color.toUpperCase(), now = pal(); if (!now.includes(c)) { remember("canopy.palette", now.concat([c])); feel.pick(); } editing = false; show(); });
        q("edit").addEventListener("click", () => { editing = !editing; show(); });
        q("done").addEventListener("click", () => { editing = false; show(); });
        q("reset").addEventListener("click", () => { remember("canopy.palette", null); editing = false; show(); });
        show();
    });
}
// The size slider's mark: a dot as big as the brush, within its place (4 to 22 across).
function markOf(size) { return Math.round(4 + 18 * sizeAt(size)); }
// The size slider: even steps for the small sizes, bigger ones as it goes (0 to 1, to a size on the screen).
function sizeOf(k) { return Math.round(SIZE.least * Math.pow(SIZE.most / SIZE.least, k) * 10) / 10; }
function sizeAt(size) { return Math.log(size / SIZE.least) / Math.log(SIZE.most / SIZE.least); }
function toHsv(c)
{
    const [r, g, b] = [1, 3, 5].map(k => parseInt((c || "#000000").slice(k, k + 2), 16) / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [Math.round((h * 60 + 360) % 360), Math.round(mx ? d / mx * 100 : 0), Math.round(mx * 100)];
}
function fromHsv(h, s, v)
{
    s /= 100; v /= 100;
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    return "#" + [f(5), f(3), f(1)].map(x => Math.round(x * 255).toString(16).padStart(2, "0")).join("").toUpperCase();
}
// The slots lit as the tool in use is, the popover left open.
function markSlots(v)
{
    const bar = (v.host.parentNode || document).querySelector(".drawbar");
    if (!bar) return;
    bar.querySelectorAll("[data-slot]").forEach(x => { const k = pen.slots[x.dataset.slot]; x.classList.toggle("on", TOOL_OF[pen.kind].slot === x.dataset.slot); x.innerHTML = icon(TOOL_OF[k].icon, 20) + '<i class="more"></i>'; });
}
// The next free name for a drawing: Drawing 1, 2, ..., past the project's own and those made here.
function drawingName()
{
    const taken = new Set(project.scene.items.filter(o => o.kind === "paint" || o.kind === "sketch").map(o => o.name));
    let n = 1;
    while (taken.has("Drawing " + n)) n++;
    return "Drawing " + n;
}
// Where what is drawn goes: the drawing being drawn on, saved (its strokes since kept together, painted onto its
// pixels as it is saved again) or not yet saved; with neither, a new one (which it then is) unless "existing" asks
// for one there already (null then).
function drawTarget(existing)
{
    if (project.drawOn === undefined) project.drawOn = remembered("canopy.drawon." + project.path, null);   // (the one drawn on last time, here)
    const doc = project.base.doc, on = project.drawOn, saved = on && doc.items.find(o => o.id === on && o.kind === "paint");
    const straight = saved && saved.file.endsWith("/") && !saved.angle && !saved.shear && !saved.flipX && !saved.flipY && !project.view.removed.has(on);   // (one turned or flipped: a new one)
    let id, base = null, k;
    if (straight)
    {
        base = on;
        k = project.view.sketches.find(o => o.base === on);
        if (!k && (!sketchId || doc.items.some(o => o.id === sketchId))) sketchId = cnpy.newId();
        id = k ? k.id : sketchId;
    }
    else if (on && (k = project.view.sketches.find(o => o.id === on && !o.base))) id = on;
    else if (existing) return null;
    else { id = cnpy.newId(); drawOnto(id); }
    const name = k ? k.name : base ? saved.name : drawingName();
    let layer = k ? k.layer : base ? cnpy.layerOf(doc, saved) : cnpy.topLayer(doc);
    if (layer && project.view.droppedLayers && project.view.droppedLayers.has(layer.id)) { const l = hierarchyModel().layers.find(x => x.id); layer = l ? { id: l.id, name: l.name } : null; }   // (that layer deleted here: the top one left)
    return { id, base, name, layer };
}
function strokeStep(tg, stroke) { return { t: "stroke", list: null, id: tg.id, base: tg.base, name: tg.name, layer: tg.layer, author: dbx.who(), stroke: { sid: cnpy.newId(), ...stroke } }; }
// What a press does while drawing: the tool in use's.
function drawPress(v, at, e)
{
    const k = pen.kind;
    if (k === "select") return grabPicked(v, at);
    if (k === "rect" || k === "lasso") return selectFrom(v, at);
    if (k === "fill" || k === "dropper") return null;   // (on a tap: a finger put down to pan or pinch fills nothing)
    return strokeFrom(v, at, e);
}
// A stroke, from a press: shown as it goes (the project's preview step), kept as a step when the finger lifts; a
// second finger (to pan or zoom) takes it back.
function strokeFrom(v, at, e)
{
    const s = strokeStep(drawTarget(false), { kind: pen.kind, color: pen.color, size: Math.round(pen.size / v.cam.s * 100) / 100, pts: [], ...(pen.opacity < 1 ? { opacity: pen.opacity } : {}) });
    const pts = s.stroke.pts;
    // Each position eased toward, as Board's brush does at its Smoothing setting (0.35, its own to start with), which
    // irons out a finger's wobble; the line is drawn as curves through the eased points (render.js, drawStrokes).
    const lag = 0.35 * 0.9;
    let ex = null, ey = null, ep = 1, lx = null, ly = null, rawX = null, rawY = null, rawP = 1;
    const ease = (p, ev) =>
    {
        const pressure = ev && ev.pointerType === "pen" ? Math.max(0.05, ev.pressure || 0.5) : 1;
        if (ex === null) { ex = p.x; ey = p.y; ep = pressure; }
        else { ex += (p.x - ex) * (1 - lag); ey += (p.y - ey) * (1 - lag); ep += (pressure - ep) * (1 - lag * 0.5); }
        return pressure;
    };
    const keep = (x, y, pr, into) =>
    {
        const c = v.toCanvas(x, y);
        into.push(Math.round(c.x * 10) / 10, Math.round(c.y * 10) / 10, Math.round(pr * 100) / 100);
    };
    const add = (p, ev) =>
    {
        rawX = p.x; rawY = p.y; rawP = ease(p, ev);
        if (lx !== null && Math.hypot(ex - lx, ey - ly) < 0.75) return;   // (closer than a pixel or so: no new point)
        lx = ex; ly = ey;
        keep(ex, ey, ep, pts);
    };
    add(at, e);
    project.preview = s;
    refreshView();
    const wet = v.wet = { id: s.base || s.id, pts, ahead: [], stroke: s.stroke };
    let mine = null;   // (its undoing, once made)   // (a saved drawing: its strokes are drawn on it, in its place)
    v.redraw();
    return {
        move(now, was, ev)
        {
            const evs = ev && ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
            if (evs.length) for (const one of evs) add(v.at(one), one); else add(now, ev);
            // Where the finger is guessed to be going next (where the browser can guess), eased on from here: drawn
            // this frame only, so the line keeps up with the finger.
            wet.ahead = [];
            const guess = ev && ev.getPredictedEvents ? ev.getPredictedEvents() : [];
            if (guess.length)
            {
                let gx = ex, gy = ey;
                for (const one of guess) { const q = v.at(one); gx += (q.x - gx) * (1 - lag); gy += (q.y - gy) * (1 - lag); }
                keep(gx, gy, ep, wet.ahead);
            }
            v.redraw();
        },
        end()
        {
            // The rest of the way to where the finger lifted (easing leaves the line a little behind it).
            if (rawX !== null && pts.length > 3 && Math.hypot(rawX - ex, rawY - ey) >= 0.75) keep(rawX, rawY, rawP, pts);
            v.wet = null; project.preview = null; step(s); mine = undos[undos.length - 1]; redrawViewers();
        },
        cancel() { v.wet = null; project.preview = null; refreshView(); v.redraw(); },
        // A dab that turned out to be the first tap of a double tap (to zoom): taken back, as if never made.
        dab: true,
        undo()
        {
            if (!mine || undos[undos.length - 1] !== mine) return;
            if (project.steps[project.steps.length - 1] === s) { undos.pop(); project.steps.pop(); refreshView(); keepSteps(); undoable(); redrawViewers(); if (!project.steps.length && state === "pending") { clearTimeout(saveTimer); setState("saved"); } }   // (not saved yet: simply never made)
            else { undoRedo(false); redos.pop(); undoable(); }
        }
    };
}
// The Eyedropper: the color drawn where it is pressed (as the screen shows it), to paint with; back to the brush.
function dropperAt(v, at)
{
    const px = v.ctx.getImageData(Math.round(at.x * v.dpr), Math.round(at.y * v.dpr), 1, 1).data;
    if (px[3] === 0) { toast("Nothing there to take a color from"); return; }
    pen.color = "#" + [px[0], px[1], px[2]].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    pen.kind = pen.slots.brush;
    keepPen(); tools(v);
    // (the color taken: shown by the bar's color pulsing, nothing said)
    const ink = (v.host.parentNode || document).querySelector('.drawbar [data-act="ink"] i');
    if (ink && !calm) ink.animate([{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(.2,.9,.3,1)" });
}
// Fill: the area pressed (as far as the color there goes, of what the screen shows), painted in the color, onto the
// drawing being drawn on. Kept as a picture of what it filled, so it lands the same when saved.
function fillAt(v, at)
{
    const W = v.canvas.width, H = v.canvas.height, sx = Math.round(at.x * v.dpr), sy = Math.round(at.y * v.dpr);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const px = v.ctx.getImageData(0, 0, W, H).data, at0 = (sy * W + sx) * 4;
    const r0 = px[at0], g0 = px[at0 + 1], b0 = px[at0 + 2], tol = 48;
    const like = i => Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) <= tol;
    const inside = new Uint8Array(W * H), todo = [sy * W + sx];
    let x0 = sx, y0 = sy, x1 = sx, y1 = sy;
    while (todo.length)
    {
        const i = todo.pop();
        if (inside[i] || !like(i * 4)) continue;
        inside[i] = 1;
        const x = i % W, y = (i / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0) todo.push(i - 1); if (x < W - 1) todo.push(i + 1); if (y > 0) todo.push(i - W); if (y < H - 1) todo.push(i + W);
    }
    // (grown a pixel, so it reaches under the soft edge of what bounds it)
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1); x1 = Math.min(W - 1, x1 + 1); y1 = Math.min(H - 1, y1 + 1);
    const w = x1 - x0 + 1, h = y1 - y0 + 1, cv = document.createElement("canvas");
    cv.width = w; cv.height = h;
    const g = cv.getContext("2d"), out = g.createImageData(w, h), [cr, cg, cb] = [1, 3, 5].map(k => parseInt(pen.color.slice(k, k + 2), 16));
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++)
        {
            const X = x + x0, Y = y + y0, i = Y * W + X;
            const on = inside[i] || (X > 0 && inside[i - 1]) || (X < W - 1 && inside[i + 1]) || (Y > 0 && inside[i - W]) || (Y < H - 1 && inside[i + W]);
            if (!on) continue;
            const o = (y * w + x) * 4;
            out.data[o] = cr; out.data[o + 1] = cg; out.data[o + 2] = cb; out.data[o + 3] = 255;
        }
    g.putImageData(out, 0, 0);
    const a = v.toCanvas(x0 / v.dpr, y0 / v.dpr), s = v.cam.s * v.dpr;
    step(strokeStep(drawTarget(false), { kind: "fill", img: cv.toDataURL("image/png"), x: Math.round(a.x * 100) / 100, y: Math.round(a.y * 100) / 100, w: Math.round(w / s * 100) / 100, h: Math.round(h / s * 100) / 100 }));
    feel.drop();
    redrawViewers();
}
// Drawing Select: a box or a lasso drawn round paint of the drawing being drawn on; pressed inside what is selected,
// it is moved instead (one step, the selection with it). A tap outside lets go.
function selectFrom(v, at)
{
    const c0 = v.toCanvas(at.x, at.y);
    if (paintSel && insidePoly(paintSel.pts, c0.x, c0.y))
    {
        const tg = drawTarget(true);
        if (!tg) { paintSel = null; v.redraw(); return null; }
        const s = strokeStep(tg, { kind: "move", pts: paintSel.pts.slice(), dx: 0, dy: 0 });
        project.preview = s; refreshView(); v.redraw();
        return {
            move(now) { const c = v.toCanvas(now.x, now.y); s.stroke.dx = Math.round((c.x - c0.x) * 10) / 10; s.stroke.dy = Math.round((c.y - c0.y) * 10) / 10; paintSel.by = { dx: s.stroke.dx, dy: s.stroke.dy }; refreshView(); v.redraw(); },   // (its outline going along with it)
            end()
            {
                project.preview = null; paintSel.by = null;
                if (s.stroke.dx || s.stroke.dy) { step(s); paintSel = { pts: paintSel.pts.map((q, i) => q + (i % 2 ? s.stroke.dy : s.stroke.dx)) }; }
                else refreshView();
                redrawViewers();
            },
            cancel() { project.preview = null; paintSel.by = null; refreshView(); v.redraw(); }
        };
    }
    if (!drawTarget(true)) { toast("Choose a drawing to select on, in the Hierarchy"); return null; }
    const box = pen.kind === "rect", pts = [c0.x, c0.y];
    paintSel = null;
    selecting = { pts, box };
    v.redraw();
    return {
        move(now)
        {
            const c = v.toCanvas(now.x, now.y);
            if (box) { pts.length = 2; pts.push(c.x, c0.y, c.x, c.y, c0.x, c.y); }
            else { const lx = pts[pts.length - 2], ly = pts[pts.length - 1]; if (Math.hypot((c.x - lx) * v.cam.s, (c.y - ly) * v.cam.s) > 3) pts.push(c.x, c.y); }
            v.redraw();
        },
        end()
        {
            selecting = null;
            const xs = pts.filter((q, i) => i % 2 === 0), ys = pts.filter((q, i) => i % 2 === 1);
            const big = (Math.max(...xs) - Math.min(...xs)) * v.cam.s > 6 || (Math.max(...ys) - Math.min(...ys)) * v.cam.s > 6;
            paintSel = big && pts.length >= 6 ? { pts: pts.map(q => Math.round(q * 10) / 10) } : null;
            tools(v); v.redraw();
        },
        cancel() { selecting = null; v.redraw(); }
    };
}
let selecting = null;   // a selection being drawn: { pts, box }
function insidePoly(p, x, y)
{
    let inside = false;
    for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
        if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) inside = !inside;
    return inside;
}
// What is selected rubbed out (one step).
function clearSelection(v)
{
    const tg = paintSel && drawTarget(true);
    if (!tg) return;
    step(strokeStep(tg, { kind: "clear", pts: paintSel.pts.slice() }));
    paintSel = null; feel.gone(); tools(v); redrawViewers();
}
// Drawing Select's outline, as a move of what it holds is undone (back where it was) or done again (where it went).
function selectionWith(doing)
{
    if (!pen) return;
    for (const x of doing)
    {
        if (x.t === "unstroke") { const k = project.view.sketches.find(o => o.id === x.id), st = k && k.strokes.find(o => o.sid === x.sid); if (st && st.kind === "move") paintSel = { pts: st.pts.slice() }; }
        if (x.t === "stroke" && x.stroke.kind === "move") paintSel = { pts: x.stroke.pts.map((q, i) => q + (i % 2 ? x.stroke.dy : x.stroke.dx)) };
    }
}
// The selection's outline over the canvas, marching black and white so it shows on any paint.
function drawSelection(v, ctx)
{
    const p = selecting ? selecting.pts : paintSel ? paintSel.pts : null;
    if (!pen || !p || p.length < 4) return;
    ctx.save();
    ctx.beginPath();
    const by = !selecting && paintSel.by ? paintSel.by : { dx: 0, dy: 0 };
    for (let i = 0; i < p.length; i += 2) { const q = v.toScreen(p[i] + by.dx, p[i + 1] + by.dy); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y); }
    if (!selecting || selecting.box) ctx.closePath();
    ctx.lineWidth = 1.2; ctx.strokeStyle = "#fff"; ctx.stroke();
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "#000"; ctx.stroke();
    ctx.restore();
}

// The drawings made here, painted into tiles as Board keeps a drawing layer's pixels (cnpy.TILE square, at cnpy.DENSITY
// to a unit, from the canvas's corner), for the file: tiles with nothing on them left out. Strokes on a saved drawing
// are painted onto its own pixels, in its own pixels' size and place, into a folder of its own (so the old tiles,
// held by the pictures already drawn, never stand in for the new).
async function paintSketches(view, doc)
{
    const out = [], D = cnpy.DENSITY, T = cnpy.TILE;
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
    const again = new Set((view.sketches || []).filter(k => k.base).map(k => k.base).concat((view.merges || []).map(m => m.into)));
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
            if (!any) continue;
            const blob = await new Promise(ok => cv.toBlob(ok, "image/png"));
            tiles.set(c + "_" + r + ".png", new Uint8Array(await blob.arrayBuffer()));
        }
    return tiles;
}
// A saved drawing painted again: its tiles read back, then its strokes since it was saved, then any drawings merged
// down into it (their tiles and strokes, at their opacity), all in its own pixels (its frame is its box), over the area
// of them all. Its box and frame grow together, so what was there stays where it was.
async function repaint(doc, view, id)
{
    const T = cnpy.TILE, own = x => view.moved.has(x.id) ? cnpy.placed(x, view.moved.get(x.id)) : x;
    const o = doc.items.find(x => x.id === id);
    if (!o || o.kind !== "paint" || view.removed.has(o.id)) return null;
    const area = x =>
    {
        // Its pixels' rectangle (its frame; or, in an older file, what its tiles cover), and its box on the canvas.
        const tiles = render.tilesOf(doc, x.file);
        let a = x.frame && x.frame.w > 0 ? x.frame : null;
        if (!a && tiles.length) { const cs = tiles.map(t => t.c), rs = tiles.map(t => t.r); a = { x: Math.min(...cs) * T, y: Math.min(...rs) * T, w: (Math.max(...cs) - Math.min(...cs) + 1) * T, h: (Math.max(...rs) - Math.min(...rs) + 1) * T }; }
        const b = own(x);
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
        for (const l of layers) { for (const t of l.tiles) if (!images.has(t.file)) images.set(t.file, await createImageBitmap(await doc.zip.file(t.file).async("blob"))); await render.fillsDecoded(l.strokes); }
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
    return { id: o.id, base: true, name: o.name, folder: o.id + "." + cnpy.newId().slice(0, 6) + "/", old: o.file, drop: layers.slice(1).map(l => l.x.file), frame, box, tiles };
}

// ---- full screen: the canvas alone (the bars put away; the browser's too, where the phone lets a page), its two
// buttons in the corner they were pressed in, and the drawing bar while drawing ----

let full = false;
function setFull(on)
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
// lets a page; let go everywhere else, and asked for again when the page comes back.
let wakeLock = null;
async function awake()
{
    const want = !!project && tab === "canvas" && !document.hidden;
    if (!want) { if (wakeLock) { const w = wakeLock; wakeLock = null; try { await w.release(); } catch (e) { } } return; }
    if (wakeLock || !navigator.wakeLock) return;
    try { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); } catch (e) { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => awake());
render.filled.onReady = () => redrawViewers();   // (a fill's picture decoded: drawn)

// The canvas's own buttons, top right: Draw (lit while drawing), the Hierarchy, Fit everything (in full screen, Undo:
// the top bar's is put away), and Full screen (in it, the way out).
function corner()
{
    const c = app.querySelector("#tab .corner");
    if (!c || !project) return;
    const shut = project.base.doc.readOnly;
    c.innerHTML = (shut ? "" : iconButton("draw", "brush", pen ? "Done drawing" : "Draw")) + iconButton("hierarchy", "layers", "Hierarchy")
        + (full ? (shut ? "" : iconButton("undo", "undo", "Undo", "", !undos.length)) : iconButton("fitall", "fit", "Fit everything"))
        + iconButton("fullscreen", "full", full ? "Exit full screen" : "Full screen");
    const d = c.querySelector('[data-do="draw"]');
    if (d) d.classList.toggle("on", !!pen);
    const f = c.querySelector('[data-do="fullscreen"]');
    if (f) f.classList.toggle("on", full);
    wire(c);
}
// Left by the phone's own way out (the back gesture, Escape): out of it here too.
for (const ev of ["fullscreenchange", "webkitfullscreenchange"]) document.addEventListener(ev, () => { if (full && !document.fullscreenElement && !document.webkitFullscreenElement) setFull(false); });

// ---- the hierarchy: the project's layers and what is in each, topmost first, as Board's Layers panel has them. A row
// picks its object (and goes to it); while drawing, a drawing's row is the one drawn on. Each shows and hides, locks
// and unlocks; held by its handle it goes above another, into that one's layer; its menu renames, duplicates,
// deletes, and merges a drawing down into the one below ----

const foldedLayers = new Set();
function layerLocked(id) { const doc = project.base.doc, v = project.view; return (doc.locks.has(id) && !v.unlocked.has(id)) || v.relocked.has(id); }
function hierarchyModel()
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
function hierarchy()
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
                        + '<button class="hbtn" data-do="hmore" data-value="' + text(o.id) + '" aria-label="More">' + icon("more", 18) + "</button>" : "")
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
    const build = () => '<div class="ptitle mtitle"><button class="hbtn" data-do="back" aria-label="Back to the hierarchy">' + icon("back", 18) + "</button><span>" + text("Layer \u00b7 " + l.name) + "</span></div>"
        + '<button class="pick danger" data-do="delete"><span>Delete layer</span><span class="kind-name">' + (n ? "and the " + (n === 1 ? "one thing" : n + " things") + " in it" : "it's empty") + "</span></button>";
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
    const isPaint = o.kind === "paint" && doc.items.some(x => x.id === o.id);
    const below = isPaint ? drawingBelow(o) : null;
    const build = () => '<div class="ptitle mtitle"><button class="hbtn" data-do="back" aria-label="Back to the hierarchy">' + icon("back", 18) + "</button><span>" + text(kindName(o.id) + " \u00b7 " + objectName(o)) + "</span></div>"
        + '<button class="pick" data-do="rename"><span>Rename</span></button>'
        + '<button class="pick" data-do="duplicate"><span>Duplicate</span></button>'
        + (o.kind === "paint" ? '<button class="pick" data-do="drawon"><span>Draw on this drawing</span></button>' : "")
        + (isPaint ? '<button class="pick" data-do="merge"' + (below ? "" : " disabled") + "><span>Merge down</span>" + (below ? '<span class="kind-name">into ' + text(below.name || "the drawing below") + "</span>" : '<span class="kind-name">no drawing below</span>') + "</button>" : "")
        + '<button class="pick danger" data-do="delete"><span>Delete</span></button>';
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
            step({ t: "merge", list: null, id: o.id, into: below.id });
            if (project.drawOn === o.id) drawOnto(below.id);
            close(() => { redrawViewers(); toast("Merged into " + (below.name || "the drawing below")); });
            return;
        }
        if (does === "delete") { if (picked && picked.ids.includes(o.id)) pick(null, picked.viewer); step({ t: "delobj", list: null, ids: [o.id] }); feel.gone(); close(() => redrawViewers()); }
    });
}
// The saved drawing just below one, in the order they are drawn (the one a merge down goes into), or null.
function drawingBelow(o)
{
    const items = project.scene.items, doc = project.base.doc, at = items.findIndex(x => x.id === o.id);
    for (let i = at - 1; i >= 0; i--) if (items[i].kind === "paint" && doc.items.some(x => x.id === items[i].id)) return items[i];
    return null;
}

// The photo button: a photo from the phone, or the image it has copied (from a web page, say).
// The canvas's +: a photo, a picture copied, or a new list, in the middle of what the canvas shows.
function addMenu(btn)
{
    if (!btn) return;
    const was = document.querySelector(".addmenu");   // (it is put on the page itself, over everything: tapped again, put away)
    if (was) { was.gone(); return; }
    const m = element('<div class="addmenu" role="menu">'
        + '<button data-act="photo">' + icon("photo", 20) + "<span>Photo</span></button>"
        + '<button data-act="paste">' + icon("copy", 20) + "<span>Paste image</span></button>"
        + '<button data-act="list">' + icon("lists", 20) + "<span>New list</span></button></div>");
    const r = btn.getBoundingClientRect();
    m.style.top = r.bottom + 6 + "px";
    m.style.right = Math.max(8, innerWidth - r.right) + "px";
    document.body.appendChild(m);
    if (!calm) m.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 150, easing: "cubic-bezier(.2,.9,.3,1)" });
    const gone = m.gone = () => { m.remove(); document.removeEventListener("pointerdown", away, true); };
    const away = e => { if (!m.contains(e.target) && !btn.contains(e.target)) gone(); };
    setTimeout(() => document.addEventListener("pointerdown", away, true), 0);
    // (each done at once, in the tap: a phone only shows its photos, or lets a page read what is copied, then)
    m.querySelector('[data-act="photo"]').addEventListener("click", () => { gone(); app.querySelector("#photo-picker").click(); });
    m.querySelector('[data-act="paste"]').addEventListener("click", () => { const got = readClipboard(); gone(); got.then(placeCopied); });
    m.querySelector('[data-act="list"]').addEventListener("click", () => { gone(); newList(canvasView ? canvasView.middle() : null); });
}
function photoMenu()
{
    const build = () => '<div class="actions"><button class="action" data-do="choose">' + icon("photo", 18) + "<span>Choose a photo</span></button>"
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

function kindName(id)
{
    const o = project.scene.items.find(x => x.id === id);
    return o ? ({ image: "Image", type: "Type", paint: "Drawing", sketch: "Drawing", list: "List", rect: "Shape", oval: "Shape", path: "Path", line: "Line", arrow: "Arrow" }[o.kind] || "Object") : "Object";
}
let toastTimer = null;
function toast(words)
{
    let t = document.querySelector(".toast");
    if (!t) { t = element('<div class="toast"></div>'); document.body.appendChild(t); }
    t.textContent = words;
    t.classList.add("on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("on"), 2200);
}
function closeViewers()
{
    picked = null;
    pen = null;
    if (canvasView && project) remember("canopy.cam." + project.path, canvasView.cam);
    if (canvasView) canvasView.canvas.remove();
    canvasView = null;
}

// ---- over the tabs: a list, or a board, opened (grown from its card) ----

function showOver()
{
    const over = app.querySelector("#over");
    if (!over) return;
    if (!open) { if (picked && picked.viewer === boardView) picked = null; over.innerHTML = ""; over.className = ""; boardView = null; return; }
    if (open.kind === "list" && !current()) { open = null; return showOver(); }
    over.className = "open " + open.kind;
    over.onclick = e => { if (e.target === over) closeOver(); };   // (round a list opened on a wide screen: back to the others)
    if (open.kind === "list") showList(over);
    else showBoard(over);
}

function grow(el, from)
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
function stepTo(o) { if (!travelling && (!open || open.kind !== o.kind || open.id !== o.id)) { const at = (history.state && history.state.at || 0) + 1; history.pushState({ ...here(), open: o, at }, ""); try { sessionStorage.setItem("canopy.nav", String(at)); } catch (e) { } } }
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

function showList(over)
{
    const l = current(), c = render.listLook(l), locked = project.base.doc.readOnly;
    const showDone = l.showDone;
    const rows = l.rows.filter(r => showDone || !r.done || (editing && editing.id === r.id));
    let html = "";
    for (const r of rows)
    {
        html += entry(r, c);
        if (editing && editing.fresh && editing.after === r.id) html += draft(c);
    }
    if (editing && editing.fresh && (editing.after === null || !rows.some(r => r.id === editing.after))) html = editing.after === null ? draft(c) + html : html + draft(c);
    const hidden = l.rows.filter(r => r.done).length;
    let wrap = over.querySelector(".sheet-wrap");
    const keepScroll = wrap ? wrap.querySelector(".sheet").scrollTop : 0;
    over.innerHTML = '<div class="sheet-wrap" style="background:' + c.card + ";color:" + c.onCard + '">'
        + '<div class="band" style="background:' + c.stripe + '"></div>'
        + bar("", iconButton("close", "back", "Back"), statusHtml() + undoButtons() + (locked ? "" : '<button class="word' + (arranging ? " on" : "") + '" data-do="arrange">' + (arranging ? "Done" : "Reorder") + "</button>" + iconButton("listmenu", "more", "List options")), "on-card")
        + '<main class="sheet"><div class="fade-in">'
        + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + (editing && editing.title ? '<input class="title-edit" value="' + text(l.name) + '" enterkeyhint="done">' : '<h2 class="title" data-do="retitle">' + (text(l.name) || '<span class="faint">Untitled list</span>') + "</h2>")
        + '<div class="entries" id="entries">' + html + "</div>"
        + (locked || arranging ? "" : '<div class="adders"><button class="adder" data-do="add" data-value="T">' + icon("plus", 18) + "Add task</button>"
            + '<button class="adder small" data-do="add" data-value="H">Heading</button><button class="adder small" data-do="add" data-value="D">Divider</button></div>')
        + (hidden ? '<button class="note-line" data-do="showdone">' + (showDone ? "Hide completed" : "Show " + hidden + " completed") + "</button>" : "")
        + "</div></main></div>";
    over.querySelector(".sheet").scrollTop = keepScroll;
    wire(over);
    const ta = over.querySelector("textarea, input.title-edit");
    if (ta)
    {
        if (ta.tagName === "TEXTAREA") growArea(ta);
        ta.focus({ preventScroll: true });
        const n = ta.value.length; ta.setSelectionRange(n, n);
        keepInView();
        setTimeout(keepInView, 350);   // (once the keyboard is up)
    }
}

function entry(r, c)
{
    const tile = r.kind === "T" || r.kind === "N" ? "background:" + c.tile + ";color:" + c.ink : "";
    const isEditing = editing && !editing.fresh && editing.id === r.id;
    let inner = "";
    if (r.kind === "D") inner += '<div class="line" style="background:' + render.shade(c.tile, 0.14) + '"></div>';
    else
    {
        if (r.kind === "T")
        {
            const box = r.color || c.box;
            inner += '<button class="check" data-do="tick" data-value="' + r.id + '" aria-label="' + (r.done ? "Not done" : "Done") + '"><span style="border-color:' + box + (r.done ? ";background:" + box + ";color:" + (render.dark(box) ? "#fff" : "#000") : "") + '">' + (r.done ? icon("tick", 16) : "") + "</span></button>";
        }
        inner += isEditing ? '<textarea rows="1" data-id="' + r.id + '">' + text(r.text) + "</textarea>"
                           : '<div class="words" data-do="type" data-value="' + r.id + '">' + cnpy.rich(r.text) + "</div>";
        if (r.link && !arranging && !isEditing) inner += '<button class="link" data-do="follow" data-value="' + text(r.link) + '" aria-label="Go to what it links to">' + icon("link", 18) + "</button>";
    }
    if (arranging) inner += '<span class="handle" data-id="' + r.id + '" aria-label="Move">' + icon("handle") + "</span>";
    return '<div class="entry ' + r.kind + (r.done ? " done" : "") + (isEditing ? " editing" : "") + '" data-id="' + r.id + '" style="' + tile + '">' + inner + "</div>";
}
function draft(c)   // a new entry being typed, not in the list until it has words
{
    const k = editing.kind;
    return '<div class="entry ' + k + ' editing arriving" style="' + (k === "H" ? "" : "background:" + c.tile + ";color:" + c.ink) + '">'
        + (k === "T" ? '<span class="check"><span style="border-color:' + c.box + '"></span></span>' : "")
        + '<textarea rows="1" data-fresh="1" placeholder="' + (k === "H" ? "Heading" : "New task") + '"></textarea></div>';
}
function growArea(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
// What is being typed in, kept in sight above the keyboard: the list given room below for the keyboard, and scrolled
// to just above it (the screen the keyboard leaves is the phone's "visual viewport").
function keepInView()
{
    const ta = app.querySelector("#over textarea, #over input.title-edit"), sheet = app.querySelector("#over .sheet");
    if (!ta || !sheet) return;
    const vv = window.visualViewport, bottom = vv ? vv.offsetTop + vv.height : innerHeight, under = Math.max(0, innerHeight - bottom);
    sheet.style.setProperty("--kb", under + "px");
    const row = ta.closest(".entry") || ta, r = row.getBoundingClientRect(), top = sheet.getBoundingClientRect().top;
    if (r.bottom > bottom - 16) sheet.scrollBy({ top: r.bottom - bottom + 24, behavior: calm ? "auto" : "smooth" });
    else if (r.top < top + 8) sheet.scrollBy({ top: r.top - top - 16, behavior: calm ? "auto" : "smooth" });
}
if (window.visualViewport) visualViewport.addEventListener("resize", () => { if (app.querySelector("#over textarea, #over input.title-edit")) keepInView(); else { const sh = app.querySelector("#over .sheet"); if (sh) sh.style.removeProperty("--kb"); } });

function showBoard(over)
{
    const b = project.scene.boards.find(o => o.id === open.id);
    if (!b) { open = null; return showOver(); }
    let wrap = over.querySelector(".board-wrap");
    if (!wrap || wrap.dataset.id !== b.id)
    {
        over.innerHTML = '<div class="board-wrap" data-id="' + text(b.id) + '"><div class="head"></div><div class="stage fade-in"></div></div>';
        wrap = over.querySelector(".board-wrap");
        boardView = new Viewer(wrap.querySelector(".stage"), () => project && project.scene, pictureGetter(), null);
        editable(boardView);
        boardView.onFitAll = () => boardView.fit(b, 0.04, true);
        boardView.fit(b, 0.04, false);
        measure(wrap.querySelector(".stage"));
    }
    else boardView.redraw();
    const head = wrap.querySelector(".head");
    head.innerHTML = bar(b.name, iconButton("close", "back", "Back"), statusHtml() + undoButtons() + iconButton("fitboard", "fit", "Fit the board") + (project.base.doc.readOnly ? "" : iconButton("draw", "draw", "Draw") + iconButton("photo", "photo", "Add a photo")));
    wire(head);
}

// ---- saving: what is done here kept as steps, written back on top of whatever the file now is ----

let saving = false, saveTimer = null, state = "saved", stateWhy = "";

function statusHtml()
{
    if (!project) return "";
    if (project.local) return '<button class="icon status" data-do="copy" aria-label="Save a copy" title="Save a copy">' + icon("download") + "</button>";
    // A round mark: a tick once saved (lit as a save lands), a still ring while changes wait to be saved, turning only
    // while a save is under way, a warning while it can't be.
    const words = { saved: "Saved", pending: "Changes to save", saving: "Saving", waiting: "Not saved yet" + (stateWhy ? ": " + stateWhy : ""), updated: "Updated from Dropbox" }[state] || "";
    const mark = state === "saving" || state === "pending" ? "saving" : state === "waiting" ? "waiting" : "saved";
    return '<button class="icon status ' + state + (landed ? " landed" : "") + '" data-do="refresh" aria-label="' + text(words) + '" title="' + text(words) + '">' + icon(mark) + "</button>";   // (tapped: saved now, and checked for changes)
}
let landed = false;   // a save just landed: the tick lit for a moment
function setState(s, why)
{
    landed = state === "saving" && (s === "saved" || s === "updated");
    state = s; stateWhy = why || "";
    app.querySelectorAll(".status").forEach(at => { at.outerHTML = statusHtml(); });
    app.querySelectorAll(".status").forEach(at => at.addEventListener("click", () => act(at.dataset.do)));
}

// The project as the steps leave it, worked out again (and drawn again) after every change.
function refreshView()
{
    project.view = cnpy.apply(project.base.doc, project.preview ? project.steps.concat([project.preview]) : project.steps);
    project.scene = render.scene(project.base.doc, project.view);
}
function redrawViewers() { if (canvasView) canvasView.redraw(); if (boardView) boardView.redraw(); }

function step(s)
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
function undoRedo(redo)
{
    if (!project || project.base.doc.readOnly) return;
    finishTyping(false, false);
    const from = redo ? redos : undos, to = redo ? undos : redos;
    if (!from.length) return;
    const doing = from.pop();
    selectionWith(doing);
    const again = run(doing);
    // (strokes on a drawing that has since been saved: painted into it, so there is nothing left here to take back)
    if (!again.length && doing.every(x => x.t === "unstroke" || x.t === "stroke")) toast("Saved strokes can't be undone");
    if (again.length) to.push(again);
    if (picked) picked.ids = picked.ids.filter(id => project.scene.items.some(o => o.id === id));
    if (picked && !picked.ids.length) picked = null;
    if (open && open.kind === "board" && !project.scene.boards.some(b => b.id === open.id)) open = null;
    feel.drop();
    changed();
    show();
    if (picked) tools(picked.viewer);
}
function undoable() { app.querySelectorAll('[data-do="undo"]').forEach(b => { b.disabled = !undos.length; }); app.querySelectorAll('[data-do="redo"]').forEach(b => { b.disabled = !redos.length; }); }
function changed()
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
function keepSteps() { clearTimeout(keepTimer); keepTimer = setTimeout(keepNow, 1500); }
function keepNow() { clearTimeout(keepTimer); keepTimer = null; if (project && !project.local) remember("canopy.steps." + project.path, project.steps.length ? project.steps : null); }
addEventListener("pagehide", keepNow);
document.addEventListener("visibilitychange", () => { if (document.hidden) keepNow(); });

async function save()
{
    if (!project || project.local || saving || project.steps.length === 0) return;
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
            const bytes = await cnpy.save(p.base.doc, upto, p.pictures, await paintSketches(upto, p.base.doc));
            try
            {
                const rev = await dbx.write(p.path, bytes, p.base.rev);
                await rebase(p, bytes, rev);
                p.steps = p.steps.slice(n);
                break;
            }
            catch (e)
            {
                if (!(e instanceof dbx.Conflict)) throw e;
                // Someone saved it meanwhile: theirs read, and these steps done again on top of it.
                const got = await dbx.read(p.path);
                await rebase(p, got.bytes, got.rev);
            }
        }
        if (p !== project) return;
        refreshView();
        keepSteps();
        forgetPhotos(p);
        problem = "";
        setState(project.steps.length ? "pending" : "saved");
        if (project.steps.length && !pen) saveTimer = setTimeout(save, 400);
        if (!editing && !sheetOpen()) show(); else { redrawViewers(); if (sheetOpen()) redrawEntries(); }
    }
    catch (e)
    {
        if (e instanceof dbx.SignedOut) return failed(e);
        setState("waiting", e.message);   // (offline, say: kept here, and tried again)
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 8000);
    }
    finally { saving = false; }
}
async function rebase(p, bytes, rev)
{
    p.base = { doc: await cnpy.open(bytes), rev };
    p.get = render.pictures(p.base.doc, p.pictures, onPicture, p.cache);
}
function onPicture()
{
    redrawViewers();
    if (tab === "boards" && project && !open) { clearTimeout(onPicture.t); onPicture.t = setTimeout(drawThumbs, 60); }
    if (document.querySelector(".picker canvas.lthumb")) { clearTimeout(onPicture.l); onPicture.l = setTimeout(drawLinkThumbs, 60); }
}

// A newer version saved elsewhere, read in (only with nothing of ours waiting: that goes through saving).
async function catchUp(quiet)
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
        refreshView();
        if (open && open.kind === "list" && !current()) open = null;
        show();
        setState("updated");
        setTimeout(() => { if (state === "updated") setState("saved"); }, 2500);
    }
    catch (e) { if (e instanceof dbx.SignedOut) failed(e); }
}
setInterval(() => catchUp(true), 20000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { catchUp(true); save(); } });
window.addEventListener("online", () => save());

// ---- photos: kept on the phone (in its own storage) until they are saved into the file ----

const DB = "canopy-photos";
function store() { return new Promise((ok, no) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore("photos"); r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }
async function keepPhoto(file, bytes) { try { const db = await store(); db.transaction("photos", "readwrite").objectStore("photos").put(bytes, file); } catch (e) { } }
async function photoBytes(file) { try { const db = await store(); return await new Promise(ok => { const r = db.transaction("photos").objectStore("photos").get(file); r.onsuccess = () => ok(r.result || null); r.onerror = () => ok(null); }); } catch (e) { return null; } }
// The pictures the steps add (photos, and pictures pasted from another project) that the file doesn't have yet.
function stepPictures(p) { return p.steps.flatMap(s => s.t === "photo" ? [s.photo.file] : s.t === "restore" ? s.things.map(cnpy.fileOf).filter(f => f && f.kind === "image").map(f => f.file) : []).filter(f => !p.base.doc.zip.file(f)); }
async function photosReady(p) { for (const f of stepPictures(p)) if (!p.pictures.has(f)) { const b = await photoBytes(f); if (b) p.pictures.set(f, b); } }
function forgetPhotos(p)
{
    // Saved into the file: no longer kept on the phone.
    const waiting = new Set(stepPictures(p));
    for (const f of [...p.pictures.keys()]) if (!waiting.has(f) && p.base.doc.zip.file(f)) { p.pictures.delete(f); store().then(db => db.transaction("photos", "readwrite").objectStore("photos").delete(f)).catch(() => { }); }
}

// A photo from the phone: made smaller if it is very big, then placed in the board open, or the middle of the canvas.
async function addPhoto(file)
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
    if (!open && tab !== "canvas") { tab = "canvas"; remember("canopy.tab", tab); show(); }
    const v = open && open.kind === "board" ? boardView : canvasView;
    if (v) pick({ ids: [id], list: null }, v);   // (picked, to be moved and sized where it belongs)
    redrawViewers();
}

// A new list: on the canvas clear of everything, to the right of it all and level with the top of the other lists,
// opened to be named (it can be moved where it belongs on the desktop).
function newList(at)
{
    // (from the canvas: in the middle of what it shows; else to the right of everything)
    const doc = project.base.doc, lists = project.view.lists, e = render.extent(project.scene);
    const x = at ? at.x - cnpy.LIST_W / 2 : e.x + e.w + 80, y = at ? at.y - 120 : lists.length ? Math.min(...lists.map(l => l.y)) : e.y;
    const id = cnpy.newId();
    step({ t: "newlist", list: id, x, y, name: "", layer: cnpy.topLayer(doc), author: dbx.who() });
    stepTo({ kind: "list", id });
    open = { kind: "list", id }; arranging = false; editing = { title: true };
    show();
    grow(app.querySelector("#over .sheet-wrap"), null);
}

// A new board, the usual size, to the right of everything, opened.
function newBoard()
{
    const e = render.extent(project.scene), all = project.scene.boards;
    let k = all.length + 1;
    while (all.some(b => b.name === "Board " + k)) k++;
    const board = { id: cnpy.newId(), x: Math.round(e.x + e.w + 120), y: Math.round(e.y), w: 1920, h: 1080, name: "Board " + k };
    step({ t: "newboard", list: null, board });
    openBoard(board.id, null);
}

// A new project, empty, in the Dropbox folder on show, opened.
async function newProject()
{
    const name = (prompt("Name the new project") || "").trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!name) return;
    const path = (folder ? folder : "") + "/" + name + ".cnpy";
    try { await dbx.create(path, await cnpy.blankFile()); }
    catch (e) { problem = e.message; return showFiles(); }
    openPath(path);
}

// ---- opening ----

async function openPath(path)
{
    problem = "";
    keepNow();   // (the last project's steps not yet kept: kept before another is opened)
    app.innerHTML = bar(fileName(path), "", "") + '<main class="page"><div class="empty">Opening…</div></main>';
    try
    {
        const got = await dbx.read(path);
        const doc = await cnpy.open(got.bytes);
        const waiting = remembered("canopy.steps." + path, null) || [];   // changes made here that never got saved: done again
        if (project) render.forget(project.cache);
        project = { path, name: fileName(path), local: false, base: { doc, rev: got.rev }, steps: waiting, pictures: new Map(), cache: render.cache() };
        undos = []; redos = [];
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
        undos = []; redos = [];
        project.get = render.pictures(doc, project.pictures, onPicture, project.cache);
        refreshView();
        open = null;
        show();
    }
    catch (e) { project = null; problem = "Couldn't open " + file.name + ": " + e.message; show(); }
}

async function saveCopy()
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

function failed(e)
{
    problem = e instanceof dbx.SignedOut ? "Signed out of Dropbox. Sign in again." : e.message || String(e);
    if (e instanceof dbx.SignedOut) project = null;
    show();
}

// ---- typing in an entry, or the list's name ----

// The words typed kept (Enter, "goOn": on to a new entry below). "draw": the page again now; a tap elsewhere that
// ended the typing draws it itself (it would be lost if the page were drawn again under the finger first).
function finishTyping(goOn, draw)
{
    const ta = app.querySelector("#over textarea, #over input.title-edit");
    if (!ta || !editing) return;
    const words = ta.value.replace(/\s+$/, "");
    const was = editing;
    editing = null;
    let next = null;
    const l = current();
    if (was.title)
    {
        if (l && words !== l.name) step({ t: "name", name: words.replace(/\n/g, " ") });
        if (goOn && l && l.rows.length === 0) next = { fresh: true, after: null, kind: "T" };   // a new list named: on to its first entry
    }
    else if (was.fresh)
    {
        if (words !== "")
        {
            const before = l && l.rows.find(o => o.id === was.after), like = before && before.kind === "T" ? before : l && [...l.rows].reverse().find(o => o.kind === "T");
            const r = { id: cnpy.newId(), kind: was.kind, done: false, color: was.kind === "T" && like ? like.color : null, text: words, link: null };   // (a task takes the box color of the one before, as in Board)
            step({ t: "add", row: r, after: was.after });
            if (goOn) next = { fresh: true, after: r.id, kind: was.kind === "H" ? "T" : was.kind };
        }
    }
    else
    {
        const r = l && l.rows.find(o => o.id === was.id);
        if (r && r.text !== words) step({ t: "set", id: r.id, fields: { text: words } });
        if (goOn && words !== "") next = { fresh: true, after: was.id, kind: r && r.kind === "N" ? "N" : "T" };   // Enter carries on to the next entry
    }
    editing = next;
    if (draw !== false) show();
}

function keyDown(e)
{
    const ta = e.target;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finishTyping(true); return; }
    if (e.key === "Escape") { editing = null; show(); return; }
    if (e.key === "Backspace" && ta.value === "" && editing && !editing.title)
    {
        // An empty entry backspaced: gone, and the one above it typed in.
        e.preventDefault();
        const l = current(), was = editing;
        editing = null;
        let above = null;
        if (was.fresh) above = was.after;
        else
        {
            const at = l.rows.findIndex(r => r.id === was.id);
            above = at > 0 ? l.rows[at - 1].id : null;
            step({ t: "del", id: was.id });
        }
        const r = above && current().rows.find(o => o.id === above);
        editing = r && r.kind !== "D" ? { id: r.id } : null;
        show();
    }
}

// ---- moving entries (Edit mode): held by the handle and dragged ----

function drag(handle, e)
{
    const row = handle.closest(".entry"), all = Array.from(document.querySelectorAll("#entries .entry"));
    const from = all.indexOf(row), box = row.getBoundingClientRect(), h = box.height + 8, y0 = e.clientY;
    const mids = all.map(o => { const r = o.getBoundingClientRect(); return r.top + r.height / 2; });   // where each entry's middle was
    let to = from;
    row.classList.add("lifted");
    handle.setPointerCapture(e.pointerId);
    const move = ev =>
    {
        const dy = ev.clientY - y0, mid = box.top + box.height / 2 + dy;
        row.style.transform = "translateY(" + dy + "px) scale(1.02)";
        // It goes where its middle now is among the others' middles.
        to = 0;
        all.forEach((o, i) => { if (o !== row && mids[i] < mid) to++; });
        all.forEach((o, i) =>
        {
            if (o === row) return;
            o.classList.add("sliding");
            o.style.transform = i > from && i <= to ? "translateY(" + -h + "px)" : i < from && i >= to ? "translateY(" + h + "px)" : "";
        });
    };
    const up = () =>
    {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        if (to !== from)
        {
            const order = all.map(o => o.dataset.id);
            const [id] = order.splice(from, 1);
            order.splice(to, 0, id);
            step({ t: "move", id, after: to === 0 ? null : order[to - 1] });
        }
        show();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
}

// ---- an entry held down: its menu (what kind it is, its box's color, a link, delete); swiped left: deleted ----

function touchEntries(root)
{
    root.querySelectorAll("#entries .entry").forEach(el =>
    {
        if (arranging || !el.dataset.id) return;
        let timer = null, x0 = 0, y0 = 0, sliding = false, dx = 0, id = null, past = false;
        const stop = () => { if (timer) clearTimeout(timer); timer = null; el.classList.remove("pressing"); };
        el.addEventListener("pointerdown", e =>
        {
            if (e.target.closest(".check, .link")) return;
            x0 = e.clientX; y0 = e.clientY; sliding = false; dx = 0; id = e.pointerId; past = false;
            el.classList.add("pressing");   // (sinks a little while held)
            timer = setTimeout(() =>
            {
                timer = null; el.classList.remove("pressing");
                feel.hold();
                let at = el;
                if (el.querySelector("textarea"))
                {
                    // (typing in it: the words kept, the box let go, so the phone's own selecting doesn't start)
                    const id = el.dataset.id;
                    el.querySelector("textarea").blur();
                    finishTyping(false, false);
                    refreshList();
                    at = app.querySelector('#entries .entry[data-id="' + CSS.escape(id) + '"]') || el;
                }
                at.dataset.held = "1";
                if (!calm) at.animate([{ transform: "scale(.96)" }, { transform: "scale(1.025)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
                entryMenu(at.dataset.id);
            }, 460);
        });
        el.addEventListener("pointermove", e =>
        {
            if (e.pointerId !== id) return;
            const mx = e.clientX - x0, my = e.clientY - y0;
            if (Math.abs(mx) + Math.abs(my) > 10) stop();
            if (!sliding && mx < -14 && Math.abs(mx) > Math.abs(my) * 1.5) { sliding = true; el.setPointerCapture(e.pointerId); el.classList.add("swiping"); }
            if (sliding)
            {
                dx = Math.min(0, mx); el.style.transform = "translateX(" + dx + "px)"; el.style.setProperty("--swipe", Math.min(1, -dx / (el.offsetWidth * 0.35)));
                const now = -dx > el.offsetWidth * 0.35;
                if (now !== past) { past = now; feel.edge(); el.classList.toggle("doomed", now); }
            }
        });
        const up = () =>
        {
            stop();
            if (!sliding) return;
            sliding = false;
            el.dataset.held = "1";   // (no tap after a swipe)
            if (-dx > el.offsetWidth * 0.35)
            {
                const gone = () => { step({ t: "del", id: el.dataset.id }); show(); };
                feel.gone();
                if (calm) return gone();
                el.animate([{ transform: "translateX(" + dx + "px)", opacity: 1 }, { transform: "translateX(-110%)", opacity: 0 }], { duration: 180, easing: "ease-in" }).onfinish = gone;
            }
            else { el.style.transition = "transform .2s cubic-bezier(.2,1.2,.3,1)"; el.style.transform = ""; el.classList.remove("swiping", "doomed"); setTimeout(() => { el.style.transition = ""; }, 220); }
        };
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
        el.addEventListener("contextmenu", e => e.preventDefault());
        el.addEventListener("click", e => { if (el.dataset.held) { e.stopPropagation(); e.preventDefault(); delete el.dataset.held; } }, true);   // (a hold's or swipe's own release is no tap)
    });
}

// A sheet up from the bottom, over the list: "build" makes its inside (again, as what it shows changes), and taps on
// its [data-do] parts go to "chose" (with "close" and "again", to draw it anew). It stays open until told or tapped off;
// the list behind is drawn again as it goes.
function sheetOpen() { return !!app.querySelector(".picker"); }
function sheetUp(build, chose)
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
// The list's entries, and its "Show completed" line, as they now are (the rest of it left as it is).
function refreshList()
{
    const l = current(), sheet = app.querySelector("#over .sheet");
    if (!l || !sheet || editing) return show();
    redrawEntries();
    const hidden = l.rows.filter(r => r.done).length, line = sheet.querySelector(".note-line");
    if (!hidden && line) line.remove();
    else if (hidden && line) line.textContent = l.showDone ? "Hide completed" : "Show " + hidden + " completed";
    else if (hidden)
    {
        const b = element('<button class="note-line" data-do="showdone">' + (l.showDone ? "Hide completed" : "Show " + hidden + " completed") + "</button>");
        b.addEventListener("click", ev => act("showdone", null, ev, b));
        sheet.querySelector(".fade-in").appendChild(b);
    }
}
// The list behind a sheet in its colors as they now are (the sheet left as it is).
function recolor()
{
    const l = current(), wrap = app.querySelector("#over .sheet-wrap");
    if (!l || !wrap) return;
    const c = render.listLook(l);
    wrap.style.background = c.card; wrap.style.color = c.onCard;
    const stripe = wrap.querySelector(".band");
    if (stripe) stripe.style.background = c.stripe;
    redrawEntries();
}
// The list's entries drawn again behind a sheet (the sheet left as it is).
function redrawEntries()
{
    const l = current(), holder = app.querySelector("#over #entries");
    if (!l || !holder) return;
    const c = render.listLook(l);
    holder.innerHTML = l.rows.filter(r => l.showDone || !r.done).map(r => entry(r, c)).join("");
    holder.querySelectorAll("[data-do]").forEach(b => b.addEventListener("click", ev => act(b.dataset.do, b.dataset.value, ev, b)));
    touchEntries(holder.parentNode);
}
function swatches(chosen, colors, does, none)
{
    return '<div class="swatches">' + (none ? '<button class="swatch none' + (!chosen ? " on" : "") + '" data-do="' + does + '" data-value="" aria-label="' + none + '"></button>' : "")
        + colors.map(c => '<button class="swatch' + (chosen && chosen.toUpperCase().slice(-6) === c.toUpperCase().slice(-6) ? " on" : "") + '" data-do="' + does + '" data-value="' + c + '" style="background:' + c + '"></button>').join("") + "</div>";
}
const KIT = ["#EF5EB8", "#DAFF00", "#27FF98", "#5EC8EF", "#8E4DFF", "#FF8A3D", "#E04848", "#1F5A8C", "#428C6A", "#6B6F6E"];   // (with the project's own palette first)
function colors() { const own = project.base.doc.palette.map(c => "#" + c.replace("#", "").slice(-6)); return [...new Set([...own, ...KIT].map(c => c.toUpperCase()))].slice(0, 16); }

// The entry a menu is for, lit above the shade (and scrolled clear of the menu, if the menu would cover it).
function lightUp(rowId)
{
    app.querySelectorAll("#entries .entry.lit").forEach(o => o.classList.remove("lit"));
    const el = rowId && app.querySelector('#entries .entry[data-id="' + CSS.escape(rowId) + '"]');
    if (!el) return;
    el.classList.add("lit");
    requestAnimationFrame(() =>
    {
        const panel = app.querySelector(".picker .panel"), sheet = app.querySelector("#over .sheet");
        if (!panel || !sheet) return;
        const top = panel.getBoundingClientRect().top - 16, b = el.getBoundingClientRect();
        if (b.bottom > top) sheet.scrollBy({ top: b.bottom - top, behavior: calm ? "auto" : "smooth" });
    });
}
function entryMenu(rowId)
{
    const kinds = [["T", "Task"], ["N", "Note"], ["H", "Heading"], ["D", "Divider"]];
    const row = () => current() && current().rows.find(o => o.id === rowId);
    if (!row()) return;
    const build = () =>
    {
        const r = row();
        if (!r) return "";
        return '<div class="segments">' + kinds.map(k => '<button class="' + (k[0] === r.kind ? "on" : "") + '" data-do="kind" data-value="' + k[0] + '">' + k[1] + "</button>").join("") + "</div>"
            + (r.kind === "T" ? '<div class="section">Checkbox color</div>' + swatches(r.color, colors(), "boxcolor", "The list's own") : "")
            + '<div class="actions">'
            + (r.kind !== "D" ? '<button class="action" data-do="linkto">' + icon("link", 18) + "<span>" + (r.link ? "Change link" : "Link") + "</span></button>" : "")
            + (r.link && r.kind !== "D" ? '<button class="action" data-do="unlink"><span>Unlink</span></button>' : "")
            + '<button class="action danger" data-do="delete">' + icon("trash", 18) + "<span>Delete</span></button></div>";
    };
    lightUp(rowId);
    sheetUp(build, (does, value, close, again) =>
    {
        // Its kind and color change as they are picked, the sheet staying open to pick more.
        // (A divider keeps its words and link, unseen, for being made a task again.)
        if (does === "kind") { if (row().kind === value) return; step({ t: "set", id: rowId, fields: value === "T" ? { kind: value } : { kind: value, done: false } }); again(); redrawEntries(); lightUp(rowId); }
        else if (does === "boxcolor") { step({ t: "set", id: rowId, fields: { color: value || null } }); again(); redrawEntries(); lightUp(rowId); }
        else if (does === "unlink") { step({ t: "set", id: rowId, fields: { link: null } }); again(); redrawEntries(); lightUp(rowId); }
        else if (does === "delete") { step({ t: "del", id: rowId }); feel.gone(); close(() => { refreshList(); undoable(); }); }
        else if (does === "linkto") close(() => { show(); pickLink(rowId); });
    });
}

// What can be linked to: the boards, then the named objects (a group as one, past the layer it is in).
function linkTargets()
{
    const doc = project.base.doc, sc = project.scene;
    const out = sc.boards.map(b => ({ id: b.id, name: b.name, kind: "Board", area: b }));
    const groups = new Set();
    for (let i = sc.items.length - 1; i >= 0; i--)
    {
        const o = sc.items[i];
        if (o.id === (open && open.id) || o.kind === "sketch") continue;
        let g = null;
        if (o.group) { const ids = o.group.split("/"); const k = doc.folders.has(ids[0]) ? 1 : 0; if (ids.length > k) g = ids.slice(0, k + 1).join("/"); }
        if (g) { if (groups.has(g)) continue; groups.add(g); out.push({ id: o.id, name: (o.groupName || "").split("\u001f")[g.split("/").length - 1] || "Group", kind: "Group", items: sc.items.filter(x => x.group && (x.group === g || x.group.startsWith(g + "/"))) }); continue; }
        const kinds = { list: "List", image: "Image", type: "Type", paint: "Drawing", rect: "Shape", oval: "Shape", path: "Path", line: "Line", arrow: "Arrow" };
        out.push({ id: o.id, name: o.kind === "list" ? o.name || "List" : o.kind === "type" ? (o.text || "").split("\n")[0].slice(0, 40) : o.name || kinds[o.kind], kind: kinds[o.kind] || "Object", items: [o] });
    }
    return out;
}
function pickLink(rowId)
{
    const r = current().rows.find(o => o.id === rowId);
    if (!r) return;
    const all = linkTargets();
    const build = () => '<div class="ptitle">Link “' + text(cnpy.plain(r.text).slice(0, 40)) + '” to…</div><div class="scroll">'
        + ["Board", null].map(k => { const these = all.filter(t => k ? t.kind === k : t.kind !== "Board"); return these.length ? '<div class="section">' + (k ? "Boards" : "Objects") + "</div>" + these.map(t => '<button class="pick' + (t.id === r.link ? " on" : "") + '" data-do="link" data-value="' + text(t.id) + '"><canvas class="lthumb"></canvas><span class="pname">' + text(t.name) + '</span><span class="kind-name">' + t.kind + "</span></button>").join("") : ""; }).join("")
        + (all.length ? "" : '<div class="empty">Nothing to link to yet</div>') + "</div>";
    linkShown = all;
    sheetUp(build, (does, value, close) => { if (does === "link") { step({ t: "set", id: rowId, fields: { link: value } }); close(() => { refreshList(); undoable(); }); } });
    requestAnimationFrame(drawLinkThumbs);
}
// Each place a link can go, drawn small beside its name: a board as it is, an object or group on its own.
let linkShown = [];
function drawLinkThumbs()
{
    if (!project) return;
    const sc = project.scene, cans = document.querySelectorAll(".picker canvas.lthumb");
    if (!cans.length) return;
    const ids = linkShown.map(t => t.id);
    cans.forEach(c =>
    {
        const t = linkShown[ids.indexOf(c.parentElement.dataset.value)];
        if (!t) return;
        let area = t.area, shown = sc;
        if (!area)
        {
            let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
            for (const o of t.items) { const b = render.outer(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
            if (x0 === Infinity) return;
            const pad = Math.max(x1 - x0, y1 - y0) * 0.06;
            area = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
            shown = { ...sc, items: t.items, boards: [] };
        }
        thumbnail(c, shown, area, project.get, project.base.doc.canvas);
    });
}

// The list's own options: its color (the stripe made from it), showing what's done, deleting it.
function listMenu()
{
    finishTyping(false, false);
    const build = () =>
    {
    const l = current();
    return '<div class="section first">List color</div>' + swatches(l.fill, colors(), "fill", "The theme's")
        + '<div class="section">Band color</div>' + swatches(l.ink, colors(), "ink", null)
        + '<div class="actions"><button class="action" data-do="done"><span>' + (l.showDone ? "Hide completed" : "Show completed") + "</span></button>"
        + '<button class="action danger' + (sure ? " sure" : "") + '" data-do="dellist">' + icon("trash", 18) + "<span>" + (sure ? "Tap again to delete" : "Delete list") + "</span></button></div>";
    };
    let sure = false;
    sheetUp(build, (does, value, close, again) =>
    {
        // Colors and showing what's done change as they are picked, the list behind with them; the sheet stays.
        const l = current();
        if (does === "fill") { step({ t: "listset", fields: value ? { fill: value, ink: render.bright(value) } : { fill: null } }); again(); recolor(); }
        else if (does === "ink") { step({ t: "listset", fields: { ink: value } }); again(); recolor(); }
        else if (does === "done") { step({ t: "listset", fields: { showDone: !l.showDone } }); again(); redrawEntries(); }
        else if (does === "dellist")
        {
            if (!sure) { sure = true; return again(); }
            close(() => { step({ t: "dellist" }); open = null; show(); });
        }
    });
}

function follow(id)
{
    finishTyping(false, false);
    const sc = project.scene, to = render.linked(sc, id);
    if (!to) { problem = "What it linked to is no longer in the project."; return show(); }
    if (to.board) { openBoard(to.board.id, null); return; }
    if (to.item && to.item.kind === "list") { openList(to.item.id, null); return; }
    open = null; tab = "canvas"; remember("canopy.tab", tab);
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
        + '<div class="hint">Changes to a project opened from the phone stay on it until you save a copy.</div>'
        + '<button class="pick danger" data-do="signout"><span>Sign out</span></button>';
    sheetUp(build, (does, value, close, again) =>
    {
        if (does === "onecolumn")
        {
            oneColumn = !oneColumn; remember("canopy.onecolumn", oneColumn); click(1100, true);
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

function wire(root)
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

function act(what, value, ev, el)
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
        case "tab": if (value === tab && !open) { if (tab === "canvas") fitAll(true); break; } finishTyping(false, false); open = null; tab = value; remember("canopy.tab", tab); show(); break;
        case "list": go({ project: project.path, local: project.local, open: { kind: "list", id: value } }, el); break;
        case "board": go({ project: project.path, local: project.local, open: { kind: "board", id: value } }, el); break;
        case "close": goBack(); break;
        case "fitall": fitAll(true); break;
        case "fitboard": { const b = project.scene.boards.find(o => o.id === open.id); if (b && boardView) boardView.fit(b, 0.04, true); break; }
        case "refresh": save(); catchUp(false); break;
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
        case "photo": photoMenu(); break;
        case "draw": drawMode(); break;
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

const FILES = ["index.html", "app.css", "js/app.js", "js/cnpy.js", "js/render.js", "js/viewer.js", "js/dropbox.js", "js/icons.js", "js/look.js", "js/tone.js", "js/version.js"];
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
    await freshKey();
    try { await dbx.finish(); }
    catch (e) { problem = e.message; }
    if (!history.state) history.replaceState({ at: 0, files: folder }, "");
    show();
    checkVersion();
})();
