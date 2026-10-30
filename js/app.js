// Canopy Web Viewer: a Canopy Board project from Dropbox on a phone. Its lists (ticked, added to, edited, put in order,
// linked to boards and objects, and new ones made), its boards, and the whole canvas to look around, photos added to
// it from the phone. Changes are saved back as they happen.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import * as render from "./render.js";
import { Viewer, thumbnail } from "./viewer.js";
import { boardIcons } from "./icons.js";

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
let back = [], ahead = [];    // folders gone back from and into, for the arrows

function remembered(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function remember(key, v) { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); } catch (e) { } }

// ---- feel: a soft click and a tiny buzz as things are done (the sound can be turned off) ----

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
// A tiny buzz: vibration where the phone has it; on an iPhone (iOS 18 on), the buzz a switch gives as it is flipped,
// which it only gives during a touch: so a buzz wanted between touches (a hold) waits for the finger's lift.
let buzzLater = false;
function buzz(ms, later)
{
    try
    {
        if (navigator.vibrate) { navigator.vibrate(ms || 8); return; }
        if (later) { buzzLater = true; return; }
        const label = document.createElement("label"), input = document.createElement("input");
        label.ariaHidden = "true"; label.style.display = "none";
        input.type = "checkbox"; input.setAttribute("switch", "");
        label.appendChild(input); document.head.appendChild(label);
        label.click();
        label.remove();
    }
    catch (e) { }
}
document.addEventListener("pointerup", () => { if (buzzLater) { buzzLater = false; buzz(); } }, true);
const feel = {
    tick() { click(1320); buzz(10); },
    untick() { click(760, true); buzz(6); },
    hold() { click(980, true); buzz(12, true); },
    edge() { click(620, true); buzz(6); },     // a swipe past where it deletes (or back)
    gone() { click(420); buzz(14); },
    pick() { click(1100, true); buzz(6); },
    drop() { click(880, true); buzz(8); },
    size() { buzz(6); }                         // sized back to as it was
};

// ---- small pieces ----

// The few Canopy Board has none of, drawn here as its are (lines 2.667 wide at 24, round ends).
const icons = {
    back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.667" stroke-linecap="round" stroke-linejoin="round"/>',
    tick: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    handle: '<path d="M6 9h12M6 15h12" stroke="currentColor" stroke-width="2.667" stroke-linecap="round"/>',
    saved: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M8.2 12.3l2.6 2.6 5-5.3" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    saving: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4" opacity=".25"/><path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
    waiting: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M12 7.5v5.5" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="16.4" r="1.2" fill="currentColor"/>',
    chevron: '<path d="M10 7l5 5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
    forward: '<path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.667" stroke-linecap="round" stroke-linejoin="round"/>'
};
Object.assign(icons, boardIcons);   // (Canopy Board's own, where it has one)
function icon(name, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + "</svg>"; }
function text(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function bar(title, left, right, cls, titleDoes) { return '<header class="bar' + (cls ? " " + cls : "") + '">' + (left || "") + "<h1>" + (titleDoes ? '<button data-do="' + titleDoes + '">' + text(title) + "</button>" : text(title)) + "</h1>" + (right || "") + "</header>"; }
function fileName(path) { return path.split("/").pop().replace(/\.cnpy$/i, ""); }
function iconButton(does, name, label, value, off) { return '<button class="icon" data-do="' + does + '"' + (value ? ' data-value="' + text(value) + '"' : "") + (off ? " disabled" : "") + ' aria-label="' + label + '" title="' + label + '">' + icon(name) + "</button>"; }
// Undo and redo, for a bar.
function undoButtons() { return !project || project.base.doc.readOnly ? "" : iconButton("undo", "undo", "Undo", "", !undos.length) + iconButton("redo", "redo", "Redo", "", !redos.length); }

// ---- the files ----

let draws = 0;   // how many times a page has been drawn
function show()
{
    draws++;
    const typing = app.querySelector("textarea, input.title-edit");
    if (typing) typing.dataset.gone = "1";   // (drawn over: its blur, as it goes, is not the person leaving it)
    if (project) return showProject();
    return showFiles();
}

async function showFiles()
{
    closeViewers();
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
    const arrows = iconButton("back", "back", "Back", "", !back.length && folder === "") + iconButton("ahead", "forward", "Forward", "", !ahead.length);
    const inFolder = r => r.split("/").slice(-2, -1)[0] || "Dropbox";
    app.innerHTML = bar("Canopy Web Viewer", "", arrows + iconButton("account", "more", "Account"), "files-bar", "home")
        + '<main class="page enter">'
        + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + (pins.length && folder === "" ? '<h2 class="section">Pinned</h2><div class="rows">' + pins.map(r => item("file", fileName(r), inFolder(r), "open", r)).join("") + "</div>" : "")
        + (recent.length && folder === "" ? '<h2 class="section">Recent</h2><div class="rows">' + recent.map(r => item("file", fileName(r), inFolder(r), "open", r)).join("") + "</div>" : "")
        + '<h2 class="section">' + (folder === "" ? "Dropbox" : text(folder.split("/").pop())) + "</h2>"
        + (folder !== "" ? '<div class="where">' + ["Dropbox"].concat(folder.split("/").filter(Boolean)).map(text).join(" / ") + "</div>" : "")
        + '<div class="rows" id="items"><div class="empty">Loading…</div></div>'
        + '<input class="hidden-input" type="file" id="picker"></main>';
    wire();
    let items;
    try { items = await dbx.list(folder); }
    catch (e) { return failed(e); }
    const holder = document.getElementById("items");
    if (!holder || project) return;
    holder.innerHTML = items.map(i => item(i.folder ? "folder" : "file", i.folder ? i.name : fileName(i.name), i.folder ? "" : when(i.modified), i.folder ? "into" : "open", i.path)).join("")
        + (items.length === 0 ? '<div class="empty">No folders or projects here</div>' : "")
        + '<button class="item new" data-do="newproject">' + icon("plus", 18) + '<span class="name">New project here</span></button>';
    wire(holder);
}
// A row as the desktop app's project lists have them: the name, a faded note at the right (when it was saved, or where it
// is); a folder marked as one, and goes on into it; a project can be pinned.
function item(kind, name, note, does, value)
{
    const pinned = kind === "file" && remembered("canopy.pinned", []).includes(value);
    return '<div class="item-row"><button class="item' + (kind === "folder" ? " folder" : "") + '" data-do="' + does + '" data-value="' + text(value) + '">'
        + (kind === "folder" ? icon("folder", 18) : "") + '<span class="name">' + text(name) + "</span>"
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

// ---- a project: three tabs (its lists, its boards, the canvas), and a list or board opened over them ----

function current() { return project && open && open.kind === "list" ? project.view.lists.find(l => l.id === open.id) : null; }
function sortedLists() { return project.view.lists.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x)); }

function showProject()
{
    const locked = project.base.doc.readOnly;
    const add = locked ? "" : tab === "lists" ? iconButton("newlist", "plus", "New list") : tab === "boards" ? iconButton("newboard", "plus", "New board") : iconButton("photo", "photo", "Add a photo");
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
    const head = shell.querySelector("#head");
    head.innerHTML = bar(project.name, iconButton("files", "back", "Back"), statusHtml() + undoButtons() + (tab === "canvas" ? iconButton("fitall", "fit", "Fit everything") : "") + add);
    wire(head);
    const holder = shell.querySelector("#tab");
    const fresh = shell.dataset.tab !== tab;
    shell.dataset.tab = tab;
    if (tab === "lists") showLists(holder);
    else if (tab === "boards") showBoards(holder);
    else showCanvas(holder, fresh);
    if (fresh && !calm) holder.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" });
    showOver();
}

// Two columns, each card going into the shorter one (so they sit together however tall they are).
function masonry(holder, cards)
{
    const wide = Math.min(holder.clientWidth || innerWidth, 1100), n = wide >= 1000 ? 4 : wide >= 720 ? 3 : 2;   // (more columns on a wider screen)
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
    masonry(holder, lists.map(l => ({ el: element(listCard(l)), weight: 3 + Math.min(4, visible(l).length) * 1.1 })));
    if (project.base.doc.readOnly) holder.insertAdjacentHTML("afterbegin", '<div class="problem">This project was saved by an older version of Canopy Board, so it can be looked at here but not changed. Open and save it in Canopy Board to update it.</div>');
    if (problem) holder.insertAdjacentHTML("afterbegin", '<div class="problem">' + text(problem) + "</div>");
    wire(holder);
}
function visible(l) { return l.rows.filter(r => l.showDone || !r.done); }
function listCard(l)
{
    const c = render.listLook(l), rows = visible(l), shown = rows.slice(0, 4);
    return '<button class="lcard" data-do="list" data-value="' + text(l.id) + '" style="background:' + c.card + ";color:" + c.onCard + '">'
        + '<div class="band" style="background:' + c.stripe + '"></div><div class="title">' + text(l.name || "List") + "</div>"
        + shown.map(r => r.kind === "D" ? '<div class="d" style="background:' + render.shade(c.tile, 0.14) + '"></div>'
            : '<div class="e ' + r.kind + (r.done ? " done" : "") + '" style="' + (r.kind === "H" ? "" : "background:" + c.tile + ";color:" + c.ink) + '">'
                + (r.kind === "T" ? '<span class="box" style="border-color:' + (r.color || c.box) + (r.done ? ";background:" + (r.color || c.box) : "") + '"></span>' : "")
                + "<span>" + text(cnpy.plain(r.text)) + "</span></div>").join("")
        + (rows.length > shown.length ? '<div class="more">+' + (rows.length - shown.length) + " more</div>" : "")
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
        holder.innerHTML = '<div class="stage"></div>';
        canvasView = new Viewer(holder.querySelector(".stage"), () => project && project.scene, (f, want) => project && project.get(f, want), null);
        editable(canvasView);
        canvasView.onFitAll = () => fitAll(true);
        if (location.hostname === "localhost") window.__view = () => canvasView;   // (for checking it on this computer)
        const cam = remembered("canopy.cam." + project.path, null);
        if (cam && fresh) { canvasView.cam = cam; canvasView.redraw(); } else fitAll(false);
    }
    else canvasView.redraw();
}
function fitAll(glide) { if (canvasView) canvasView.fit(render.extent(project.scene), 0.06, glide); }
// ---- objects picked on the canvas (or in a board): moved by dragging, sized by a corner, deleted ----

let picked = null;   // { ids, list (a list picked on its own: it can be opened), viewer }
let lifted = false;  // what is picked being moved or sized by a finger (drawn lifted)

function editable(v)
{
    v.onTap = (x, y) => tapObject(v, x, y);
    v.overlay = ctx => drawPicked(v, ctx);
    v.grab = at => grabPicked(v, at);
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
// The handles: the picked box's corners, on the screen.
function corners(v)
{
    const b = pickedBox();
    if (!b) return [];
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
        ctx.strokeStyle = "rgba(95,211,155,.6)"; ctx.lineWidth = 3; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
        ctx.restore();
    }
    ctx.strokeStyle = pickedLocked() ? "#A5A8A7" : "#5fd39b"; ctx.lineWidth = 1.5;
    ctx.setLineDash(pickedLocked() ? [5, 4] : []);
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(c.x - a.x), Math.round(c.y - a.y));
    if (pickedLocked()) return;   // (locked: no handles)
    for (const h of corners(v))
    {
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(h.x, h.y, lifted ? 9 : 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#428C6A"; ctx.lineWidth = 2; ctx.stroke();
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
        lifted = true; buzz(6);
        return {
            move(now)
            {
                const p = v.toCanvas(now.x, now.y), k = Math.max(0.05, ((p.x - ax) * (c0.x - ax) + (p.y - ay) * (c0.y - ay)) / d2), was = project.preview.by.k;
                if ((was - 1) * (k - 1) < 0) feel.size();   // (passing the size it was)
                project.preview.by = { k, ox: ax - ax * k, oy: ay - ay * k }; refreshView(); v.redraw();
            },
            end() { settle(v); }
        };
    }
    const b = pickedBox(), p = v.toCanvas(at.x, at.y), m = 12 / v.cam.s;
    if (!b || p.x < b.x - m || p.x > b.x + b.w + m || p.y < b.y - m || p.y > b.y + b.h + m) return null;
    // On it: moved with the finger.
    project.preview = { t: "place", ids, list: null, by: { k: 1, ox: 0, oy: 0 } };
    lifted = true; buzz(6);
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
    if (!picked) { if (bar) bar.remove(); return; }
    if (!bar) { bar = element('<div class="tools"></div>'); host.appendChild(bar); if (!calm) bar.animate([{ transform: "translateY(16px)", opacity: 0 }, { transform: "none", opacity: 1 }], { duration: 220, easing: "cubic-bezier(.2,1.2,.3,1)" }); }
    const n = picked.ids.length, shut = pickedLocked();
    bar.innerHTML = '<span class="what">' + (shut ? icon("lock", 15) : "") + (picked.list ? "List" : n > 1 ? "Group of " + n : kindName(picked.ids[0])) + "</span>"
        + (picked.list ? '<button data-act="open">Open</button>' : "")
        + '<button data-act="lock">' + (shut ? "Unlock" : "Lock") + "</button>"
        + (shut ? "" : '<button data-act="delete" class="danger">Delete</button>') + '<button data-act="done">Done</button>';
    bar.querySelectorAll("button").forEach(b => b.addEventListener("click", () =>
    {
        if (b.dataset.act === "open") openList(picked.list, null);
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
                if (groups.some(g => doc.folders.has(g))) toast("Its whole layer is unlocked too");
            }
            feel.pick(); tools(v); v.redraw();
        }
        else pick(null, v);
    }));
}
function kindName(id)
{
    const o = project.scene.items.find(x => x.id === id);
    return o ? ({ image: "Image", type: "Type", paint: "Drawing", rect: "Shape", oval: "Shape", path: "Path", line: "Line", arrow: "Arrow" }[o.kind] || "Object") : "Object";
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
function openList(id, card)
{
    const from = card ? card.getBoundingClientRect() : null;
    open = { kind: "list", id }; arranging = false; editing = null;
    show();
    grow(app.querySelector("#over .sheet-wrap"), from);
}
function openBoard(id, card)
{
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
        ta.focus();
        const n = ta.value.length; ta.setSelectionRange(n, n);
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

function showBoard(over)
{
    const b = project.scene.boards.find(o => o.id === open.id);
    if (!b) { open = null; return showOver(); }
    let wrap = over.querySelector(".board-wrap");
    if (!wrap || wrap.dataset.id !== b.id)
    {
        over.innerHTML = '<div class="board-wrap" data-id="' + text(b.id) + '"><div class="head"></div><div class="stage fade-in"></div></div>';
        wrap = over.querySelector(".board-wrap");
        boardView = new Viewer(wrap.querySelector(".stage"), () => project && project.scene, (f, want) => project && project.get(f, want), null);
        editable(boardView);
        boardView.onFitAll = () => boardView.fit(b, 0.04, true);
        boardView.fit(b, 0.04, false);
    }
    else boardView.redraw();
    const head = wrap.querySelector(".head");
    head.innerHTML = bar(b.name, iconButton("close", "back", "Back"), statusHtml() + undoButtons() + iconButton("fitboard", "fit", "Fit the board") + (project.base.doc.readOnly ? "" : iconButton("photo", "photo", "Add a photo")));
    wire(head);
}

// ---- saving: what is done here kept as steps, written back on top of whatever the file now is ----

let saving = false, saveTimer = null, state = "saved", stateWhy = "";

function statusHtml()
{
    if (!project) return "";
    if (project.local) return '<button class="icon status" data-do="copy" aria-label="Save a copy" title="Save a copy">' + icon("download") + "</button>";
    // A round mark: a tick once saved (lit as a save lands), turning while saving, a warning while it can't be.
    const words = { saved: "Saved", saving: "Saving", waiting: "Not saved yet" + (stateWhy ? ": " + stateWhy : ""), updated: "Updated from Dropbox" }[state] || "";
    const mark = state === "saving" ? "saving" : state === "waiting" ? "waiting" : "saved";
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
    const again = run(from.pop());
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
    setState("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
}
function keepSteps() { if (project && !project.local) remember("canopy.steps." + project.path, project.steps.length ? project.steps : null); }

async function save()
{
    if (!project || project.local || saving || project.steps.length === 0) return;
    saving = true;
    const p = project;
    try
    {
        await photosReady(p);
        for (let tries = 0; tries < 5; tries++)
        {
            const n = p.steps.length;
            const bytes = await cnpy.save(p.base.doc, cnpy.apply(p.base.doc, p.steps.slice(0, n)), p.pictures);
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
        setState(project.steps.length ? "saving" : "saved");
        if (project.steps.length) saveTimer = setTimeout(save, 400);
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
function onPicture() { redrawViewers(); if (tab === "boards" && project && !open) { clearTimeout(onPicture.t); onPicture.t = setTimeout(drawThumbs, 60); } }

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
async function photosReady(p) { for (const s of p.steps) if (s.t === "photo" && !p.pictures.has(s.photo.file)) { const b = await photoBytes(s.photo.file); if (b) p.pictures.set(s.photo.file, b); } }
function forgetPhotos(p)
{
    // Saved into the file: no longer kept on the phone.
    const waiting = new Set(p.steps.filter(s => s.t === "photo").map(s => s.photo.file));
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
function newList()
{
    const doc = project.base.doc, lists = project.view.lists, e = render.extent(project.scene);
    const x = e.x + e.w + 80, y = lists.length ? Math.min(...lists.map(l => l.y)) : e.y;
    const id = cnpy.newId();
    step({ t: "newlist", list: id, x, y, name: "", layer: cnpy.topLayer(doc), author: dbx.who() });
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
    open = { kind: "board", id: board.id };
    show();
    grow(app.querySelector("#over .board-wrap"), null);
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
        setState(waiting.length ? "saving" : "saved");
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
    const bytes = await cnpy.save(project.base.doc, project.view, project.pictures);
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
    problem = e instanceof dbx.SignedOut ? "Signed out of Dropbox: sign in again." : e.message || String(e);
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
            const r = { id: cnpy.newId(), kind: was.kind, done: false, color: null, text: words, link: null };
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

// ---- an entry held down: its menu (what kind it is, its box's colour, a link, delete); swiped left: deleted ----

function touchEntries(root)
{
    root.querySelectorAll("#entries .entry").forEach(el =>
    {
        if (arranging || !el.dataset.id) return;
        let timer = null, x0 = 0, y0 = 0, sliding = false, dx = 0, id = null, past = false;
        const stop = () => { if (timer) clearTimeout(timer); timer = null; el.classList.remove("pressing"); };
        el.addEventListener("pointerdown", e =>
        {
            if (e.target.closest("textarea, .check, .link")) return;
            x0 = e.clientX; y0 = e.clientY; sliding = false; dx = 0; id = e.pointerId; past = false;
            el.classList.add("pressing");   // (sinks a little while held)
            timer = setTimeout(() =>
            {
                timer = null; el.dataset.held = "1"; el.classList.remove("pressing");
                feel.hold();
                if (!calm) el.animate([{ transform: "scale(.96)" }, { transform: "scale(1.025)" }, { transform: "scale(1)" }], { duration: 260, easing: "cubic-bezier(.2,.9,.3,1.3)" });
                entryMenu(el.dataset.id);
            }, 480);
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
    const panel = sheet.querySelector(".panel");
    let closing = false;
    const close = then =>
    {
        if (closing) return;
        closing = true;
        const done = () => { sheet.remove(); if (then) then(); else if (current() && app.querySelector("#over #entries")) { redrawEntries(); undoable(); } else show(); };
        if (calm) return done();
        sheet.querySelector(".shade").animate([{ opacity: 1 }, { opacity: 0 }], { duration: 170 });
        panel.animate([{ transform: "none" }, { transform: "translateY(100%)" }], { duration: 180, easing: "ease-in" }).onfinish = done;
    };
    const again = () =>
    {
        panel.innerHTML = '<div class="grip"></div>' + build();
        panel.querySelectorAll("[data-do]").forEach(b => b.addEventListener("click", e => { e.stopPropagation(); if (!closing) chose(b.dataset.do, b.dataset.value, close, again); }));
    };
    again();
    // (The finger that held an entry down to open this is still on the glass: its lift is no tap on the shade. Only a
    // press that starts on the shade, after it is up, closes it.)
    const shade = sheet.querySelector(".shade"), since = performance.now();
    let armed = false;
    shade.addEventListener("pointerdown", () => { armed = performance.now() - since > 120; });
    shade.addEventListener("click", () => { if (armed) close(); armed = false; });
    if (!calm)
    {
        panel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 320, easing: "cubic-bezier(.2,1.1,.3,1)" });
        sheet.querySelector(".shade").animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    }
    return sheet;
}
// The list behind a sheet in its colours as they now are (the sheet left as it is).
function recolour()
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
function swatches(chosen, colours, does, none)
{
    return '<div class="swatches">' + (none ? '<button class="swatch none' + (!chosen ? " on" : "") + '" data-do="' + does + '" data-value="" aria-label="' + none + '"></button>' : "")
        + colours.map(c => '<button class="swatch' + (chosen && chosen.toUpperCase().slice(-6) === c.toUpperCase().slice(-6) ? " on" : "") + '" data-do="' + does + '" data-value="' + c + '" style="background:' + c + '"></button>').join("") + "</div>";
}
const KIT = ["#EF5EB8", "#DAFF00", "#27FF98", "#5EC8EF", "#8E4DFF", "#FF8A3D", "#E04848", "#1F5A8C", "#428C6A", "#6B6F6E"];   // (with the project's own palette first)
function colours() { const own = project.base.doc.palette.map(c => "#" + c.replace("#", "").slice(-6)); return [...new Set([...own, ...KIT].map(c => c.toUpperCase()))].slice(0, 16); }

function entryMenu(rowId)
{
    const kinds = [["T", "Task"], ["N", "Note"], ["H", "Heading"], ["D", "Divider"]];
    const row = () => current() && current().rows.find(o => o.id === rowId);
    if (!row()) return;
    const build = () =>
    {
        const r = row();
        if (!r) return "";
        return '<div class="ptitle">' + (text(cnpy.plain(r.text).slice(0, 60)) || (r.kind === "D" ? "Divider" : "Entry")) + "</div>"
            + '<div class="segments">' + kinds.map(k => '<button class="' + (k[0] === r.kind ? "on" : "") + '" data-do="kind" data-value="' + k[0] + '">' + k[1] + "</button>").join("") + "</div>"
            + (r.kind === "T" ? '<div class="section">Checkbox colour</div>' + swatches(r.color, colours(), "boxcolor", "The list's own") : "")
            + (r.kind !== "D" ? '<button class="pick" data-do="linkto"><span>' + (r.link ? "Change link…" : "Link to a board or object…") + "</span>" + icon("link", 18) + "</button>" : "")
            + (r.link && r.kind !== "D" ? '<button class="pick" data-do="unlink"><span>Remove link</span></button>' : "")
            + '<button class="pick danger" data-do="delete"><span>Delete</span></button>';
    };
    sheetUp(build, (does, value, close, again) =>
    {
        // Its kind and colour change as they are picked, the sheet staying open to pick more.
        // (A divider keeps its words and link, unseen, for being made a task again.)
        if (does === "kind") { if (row().kind === value) return; step({ t: "set", id: rowId, fields: value === "T" ? { kind: value } : { kind: value, done: false } }); again(); redrawEntries(); }
        else if (does === "boxcolor") { step({ t: "set", id: rowId, fields: { color: value || null } }); again(); redrawEntries(); }
        else if (does === "unlink") { step({ t: "set", id: rowId, fields: { link: null } }); again(); redrawEntries(); }
        else if (does === "delete") { step({ t: "del", id: rowId }); close(); }
        else if (does === "linkto") close(() => { show(); pickLink(rowId); });
    });
}

// What can be linked to: the boards, then the named objects (a group as one, past the layer it is in).
function linkTargets()
{
    const doc = project.base.doc, sc = project.scene;
    const out = sc.boards.map(b => ({ id: b.id, name: b.name, kind: "Board" }));
    const groups = new Set();
    for (let i = sc.items.length - 1; i >= 0; i--)
    {
        const o = sc.items[i];
        if (o.id === (open && open.id)) continue;
        let g = null;
        if (o.group) { const ids = o.group.split("/"); const k = doc.folders.has(ids[0]) ? 1 : 0; if (ids.length > k) g = ids.slice(0, k + 1).join("/"); }
        if (g) { if (groups.has(g)) continue; groups.add(g); out.push({ id: o.id, name: (o.groupName || "").split("\u001f")[g.split("/").length - 1] || "Group", kind: "Group" }); continue; }
        const kinds = { list: "List", image: "Image", type: "Type", paint: "Drawing", rect: "Shape", oval: "Shape", path: "Path", line: "Line", arrow: "Arrow" };
        out.push({ id: o.id, name: o.kind === "list" ? o.name || "List" : o.kind === "type" ? (o.text || "").split("\n")[0].slice(0, 40) : o.name || kinds[o.kind], kind: kinds[o.kind] || "Object" });
    }
    return out;
}
function pickLink(rowId)
{
    const r = current().rows.find(o => o.id === rowId);
    if (!r) return;
    const all = linkTargets();
    const build = () => '<div class="ptitle">Link “' + text(cnpy.plain(r.text).slice(0, 40)) + '” to…</div><div class="scroll">'
        + ["Board", null].map(k => { const these = all.filter(t => k ? t.kind === k : t.kind !== "Board"); return these.length ? '<div class="section">' + (k ? "Boards" : "Objects") + "</div>" + these.map(t => '<button class="pick' + (t.id === r.link ? " on" : "") + '" data-do="link" data-value="' + text(t.id) + '"><span>' + text(t.name) + '</span><span class="kind-name">' + t.kind + "</span></button>").join("") : ""; }).join("")
        + (all.length ? "" : '<div class="empty">Nothing to link to yet</div>') + "</div>";
    sheetUp(build, (does, value, close) => { if (does === "link") { step({ t: "set", id: rowId, fields: { link: value } }); close(); } });
}

// The list's own options: its colour (the stripe made from it), showing what's done, deleting it.
function listMenu()
{
    finishTyping(false, false);
    const build = () =>
    {
    const l = current();
    return '<div class="ptitle">' + (text(l.name) || "Untitled list") + "</div>"
        + '<div class="section">List colour</div>' + swatches(l.fill, colours(), "fill", "The theme's")
        + '<div class="section">Stripe colour</div>' + swatches(l.ink, colours(), "ink", null)
        + '<button class="pick" data-do="done"><span>' + (l.showDone ? "Hide completed" : "Show completed") + "</span></button>"
        + '<button class="pick danger" data-do="dellist"><span>' + (sure ? "Tap again to delete “" + text(l.name || "this list") + "”" : "Delete list") + "</span></button>";
    };
    let sure = false;
    sheetUp(build, (does, value, close, again) =>
    {
        // Colours and showing what's done change as they are picked, the list behind with them; the sheet stays.
        const l = current();
        if (does === "fill") { step({ t: "listset", fields: value ? { fill: value, ink: render.bright(value) } : { fill: null } }); again(); recolour(); }
        else if (does === "ink") { step({ t: "listset", fields: { ink: value } }); again(); recolour(); }
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
    if (!to) { problem = "What it linked to isn't in the project any more."; return show(); }
    if (to.board) { open = { kind: "board", id: to.board.id }; show(); grow(app.querySelector("#over .board-wrap"), null); return; }
    if (to.item && to.item.kind === "list") { openList(to.item.id, null); return; }
    open = null; tab = "canvas"; remember("canopy.tab", tab);
    show();
    canvasView.fit(to.area, 0.18, true);
}

// Who is signed in, the sound, opening a project from this phone, signing out.
function accountMenu()
{
    const build = () => '<div class="ptitle">' + (dbx.who() ? "Signed in as " + text(dbx.who()) : "Signed in to Dropbox") + "</div>"
        + '<button class="pick" data-do="sound"><span>Sounds</span><span class="kind-name">' + (sound ? "On" : "Off") + "</span></button>"
        + '<button class="pick" data-do="local"><span>Open a project from this phone</span></button>'
        + '<div class="hint">Changes to a project opened from the phone stay on it until you save a copy.</div>'
        + '<button class="pick danger" data-do="signout"><span>Sign out</span></button>';
    sheetUp(build, (does, value, close, again) =>
    {
        if (does === "sound") { sound = !sound; remember("canopy.sound", sound); click(1100, true); again(); }
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
        if (ta.tagName === "TEXTAREA") ta.addEventListener("input", () => growArea(ta));
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
        case "home": if (folder !== "") { back.push(folder); ahead = []; folder = ""; remember("canopy.folder", folder); } window.scrollTo(0, 0); showFiles(); break;
        case "back":
            if (back.length) { ahead.push(folder); folder = back.pop(); }
            else if (folder !== "") { ahead.push(folder); folder = folder.split("/").slice(0, -1).join("/"); }   // (opened here: back is up a folder)
            remember("canopy.folder", folder); showFiles();
            break;
        case "ahead": if (ahead.length) { back.push(folder); folder = ahead.pop(); remember("canopy.folder", folder); showFiles(); } break;
        case "undo": undoRedo(false); break;
        case "redo": undoRedo(true); break;
        case "pick": app.querySelector("#picker").click(); break;
        case "into": back.push(folder); ahead = []; folder = value; remember("canopy.folder", folder); showFiles(); break;
        case "open": openPath(value); break;
        case "files":
            closeViewers();
            if (project && project.steps.length && !project.local) save();   // (still saving: it carries on)
            if (project && !project.steps.length) render.forget(project.cache);   // (its pictures let go)
            project = null; open = null; problem = ""; show();
            break;
        case "tab": if (value === tab && !open) { if (tab === "canvas") fitAll(true); break; } finishTyping(false, false); open = null; tab = value; remember("canopy.tab", tab); show(); break;
        case "list": openList(value, el); break;
        case "board": openBoard(value, el); break;
        case "close": closeOver(); break;
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
        case "photo": app.querySelector("#photo-picker").click(); break;
        case "arrange": finishTyping(false, false); arranging = !arranging; editing = null; show(); break;
        case "retitle": if (project.base.doc.readOnly || arranging) break; finishTyping(false, false); editing = { title: true }; show(); break;
        case "follow": follow(value); break;
        case "tick":
        {
            const r = current().rows.find(o => o.id === value);
            if (r) { step({ t: "set", id: r.id, fields: { done: !r.done } }); if (r.done) feel.untick(); else feel.tick(); }
            show();
            const box = app.querySelector('.entry[data-id="' + CSS.escape(value) + '"] .check span');
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
            if (editing) finishTyping(false, false);
            const l = current(), last = l.rows.length ? l.rows[l.rows.length - 1].id : null;
            if (value === "D") { step({ t: "add", row: { id: cnpy.newId(), kind: "D", done: false, color: null, text: "", link: null }, after: last }); show(); break; }
            editing = { fresh: true, after: last, kind: value };
            show();
            break;
        }
        case "showdone": step({ t: "listset", fields: { showDone: !current().showDone } }); show(); break;
        case "listmenu": listMenu(); break;
    }
}

document.addEventListener("keydown", e =>
{
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !project) return;
    if (e.target.closest && e.target.closest("textarea, input")) return;   // (typing: the box's own undo)
    const k = e.key.toLowerCase();
    if (k === "z") { e.preventDefault(); undoRedo(e.shiftKey); }
    else if (k === "y") { e.preventDefault(); undoRedo(true); }
});

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

(async function start()
{
    await freshKey();
    try { await dbx.finish(); }
    catch (e) { problem = e.message; }
    show();
})();
