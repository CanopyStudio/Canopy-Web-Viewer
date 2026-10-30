// Canopy Web Viewer: a Canopy Board project from Dropbox on a phone. Its lists (ticked, added to, edited, put in order,
// linked to boards and objects, and new ones made), its boards, and the whole canvas to look around, photos added to
// it from the phone. Changes are saved back as they happen.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import * as render from "./render.js";
import { Viewer, thumbnail } from "./viewer.js";
import { boardIcons } from "./icons.js";
import { themes, sizes } from "./look.js";
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

let theme = remembered("canopy.theme", "Forest");
function applyTheme(name)
{
    if (!themes[name]) name = "Forest";
    theme = name;
    const c = themes[name].colors, root = document.documentElement.style, z = sizes;
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
    const c = themes[theme].colors, l = current();
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
            timer = setTimeout(() => { timer = null; lift(e); }, 420);
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
            const noScroll = ev => ev.preventDefault();
            document.addEventListener("touchmove", noScroll, { passive: false });
            const move = ev =>
            {
                const dy = ev.clientY - start, mid = mids[from] + dy;
                row.style.transform = "translateY(" + dy + "px)";
                let now = 0;
                all.forEach((o, i) => { if (o !== row && mids[i] < mid) now++; });
                if (now !== to) { to = now; buzz(4); }
                all.forEach((o, i) => { if (o === row) return; o.classList.add("sliding"); o.style.transform = i > from && i <= to ? "translateY(" + -h + "px)" : i < from && i >= to ? "translateY(" + h + "px)" : ""; });
            };
            const drop = () =>
            {
                document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", drop); document.removeEventListener("pointercancel", drop);
                document.removeEventListener("touchmove", noScroll);
                const pins = remembered("canopy.pinned", []), path = open.dataset.value;
                if (to !== from) { const order = pins.filter(p => p !== path); order.splice(to, 0, path); remember("canopy.pinned", order); feel.drop(); }
                setTimeout(() => { delete row.dataset.held; showFiles(); }, 40);
            };
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
    requestAnimationFrame(() => { const t = shell.querySelector(".tabs"); if (t) document.documentElement.style.setProperty("--tabs-h", t.offsetHeight + "px"); });   // (a board opened stops above them)
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
    const cards = lists.map(l => ({ id: l.id, el: element(listCard(l)), weight: 3 + Math.min(4, visible(l).length) * 1.1 }));
    masonry(holder, cards, oneColumn);
    if (!project.base.doc.readOnly) arrangeCards(holder, cards);
    if (project.base.doc.readOnly) holder.insertAdjacentHTML("afterbegin", '<div class="problem">This project was saved by an older version of Canopy Board, so it can be looked at here but not changed. Open and save it in Canopy Board to update it.</div>');
    if (problem) holder.insertAdjacentHTML("afterbegin", '<div class="problem">' + text(problem) + "</div>");
    wire(holder);
}
function visible(l) { return l.rows.filter(r => l.showDone || !r.done); }

// A list's card held down: lifted, and dragged to where it should be among the others, which make room for it as it
// goes (in the columns again, in the order it would leave); let go, that order is kept in the project.
function arrangeCards(holder, cards)
{
    const scroller = holder;   // (#tab: scrolled while a card is held near its top or bottom)
    for (const c of cards)
    {
        let timer = null, x0 = 0, y0 = 0;
        const el = c.el;
        el.addEventListener("pointerdown", e =>
        {
            if (e.button > 0) return;
            x0 = e.clientX; y0 = e.clientY;
            el.classList.add("pressing");
            timer = setTimeout(() => { timer = null; el.classList.remove("pressing"); lift(c, e); }, 420);
        });
        const stop = () => { if (timer) clearTimeout(timer); timer = null; el.classList.remove("pressing"); };
        el.addEventListener("pointermove", e => { if (timer && Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) > 8) stop(); });
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
        const noScroll = ev => ev.preventDefault();
        document.addEventListener("touchmove", noScroll, { passive: false });
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
            document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", drop); document.removeEventListener("pointercancel", drop);
            document.removeEventListener("touchmove", noScroll);
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
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", drop); document.addEventListener("pointercancel", drop);
        place();
    }
}
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
        canvasView = new Viewer(holder.querySelector(".stage"), () => project && project.scene, pictureGetter(), null);
        editable(canvasView);
        canvasView.onFitAll = () => fitAll(true);
        measure(holder.querySelector(".stage"));
        if (location.hostname === "localhost") window.__view = () => canvasView;   // (for checking it on this computer)
        const cam = remembered("canopy.cam." + project.path, null);
        if (cam && fresh) { canvasView.cam = cam; canvasView.redraw(); } else fitAll(false);
    }
    else canvasView.redraw();
}
// The measuring readout (the address ending ?measure): what drawing and the pictures cost on this phone, as it goes.
const measuring = new URLSearchParams(location.search).has("measure");
function measure(stage)
{
    if (!measuring || !stage) return;
    const box = element('<div class="measure"></div>');
    stage.appendChild(box);
    const tick = () =>
    {
        if (!box.isConnected) return;
        const st = render.stats, now = performance.now(), recent = st.draws.filter(d => now - d.at < 2000), ms = st.draws.slice(-20).map(d => d.ms);
        const avg = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : 0, worst = ms.length ? Math.max(...ms) : 0;
        const c = project && project.cache, seen = c ? [...c.seen.values()] : [];
        const dm = st.decodeMs.length ? st.decodeMs.reduce((a, b) => a + b, 0) / st.decodeMs.length : 0;
        const v = canvasView || boardView, items = project ? project.scene.items : [];
        box.textContent = [
            "Drawing: " + avg.toFixed(0) + " ms average, " + worst.toFixed(0) + " ms worst (last 20), " + (recent.length / 2).toFixed(1) + " a second",
            "Pictures: " + seen.filter(e => e.img).length + " held of " + items.filter(o => o.kind === "image").length + " images and " + items.filter(o => o.kind === "paint").length + " drawings",
            "Memory: " + (c ? (c.pixels / 1e6).toFixed(1) : 0) + " of 48 megapixels; widest " + st.widest + " px",
            "Decoded " + st.decoded + " (" + dm.toFixed(0) + " ms each); waiting " + (c ? c.queue.length + c.busy : 0) + "; let go " + st.dropped + "; failed " + st.failed,
            "Zoom " + (v ? (v.cam.s * 100).toFixed(0) : "?") + "%, screen " + (v ? v.w + " \u00d7 " + v.h + " at " + v.dpr + "x" : "?") + (navigator.deviceMemory ? ", " + navigator.deviceMemory + " GB" : "")
        ].join("\n");
        setTimeout(tick, 500);
    };
    tick();
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
        ctx.strokeStyle = themes[theme].colors.Heading; ctx.globalAlpha = 0.6; ctx.lineWidth = 3; ctx.strokeRect(a.x, a.y, c.x - a.x, c.y - a.y);
        ctx.restore();
    }
    const tone = themes[theme].colors;
    ctx.strokeStyle = pickedLocked() ? tone.Muted : tone.Heading; ctx.lineWidth = 1.5;
    ctx.setLineDash(pickedLocked() ? [5, 4] : []);
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(c.x - a.x), Math.round(c.y - a.y));
    if (pickedLocked()) return;   // (locked: no handles)
    for (const h of corners(v))
    {
        ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(h.x, h.y, lifted ? 9 : 7, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = tone.Accent; ctx.lineWidth = 2; ctx.stroke();
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
    sheetUp(build, (does, value, close) => { if (does === "link") { step({ t: "set", id: rowId, fields: { link: value } }); close(() => { refreshList(); undoable(); }); } });
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
    if (!to) { problem = "What it linked to isn't in the project any more."; return show(); }
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
        + '<div class="section first">Theme</div><div class="themes">' + Object.keys(themes).map(n => '<button class="theme' + (n === theme ? " on" : "") + '" data-do="theme" data-value="' + n + '" style="--a:' + themes[n].colors.Accent + ";--c:" + themes[n].colors.Card + '"><i></i><span>' + n + "</span></button>").join("") + "</div>"
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
            oneColumn = !oneColumn; remember("canopy.onecolumn", oneColumn); click(1100, true); buzz(6);
            const b = app.querySelector('.picker [data-do="onecolumn"]');
            if (b) { b.setAttribute("aria-checked", String(oneColumn)); b.querySelector(".switch").classList.toggle("on", oneColumn); }
            return;
        }
        if (does === "theme") { applyTheme(value); remember("canopy.theme", value); click(1100, true); again(); return; }
        if (does === "sound")
        {
            // (flipped where it is, so it slides)
            sound = !sound; remember("canopy.sound", sound); click(1100, true); buzz(6);
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
        case "photo": app.querySelector("#photo-picker").click(); break;
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
            click(1050, true); buzz(6);
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
        const k = Math.min(1, dx / 90), was = edge.ready;
        edge.ready = k >= 1;
        edge.mark.style.transform = "translateX(" + (edge.back ? 1 : -1) * (Math.min(dx, 120) * 0.6 - 30) + "px) scale(" + (0.7 + 0.3 * k) + ")";
        edge.mark.style.opacity = String(0.3 + 0.7 * k);
        edge.mark.classList.toggle("ready", edge.ready);
        if (edge.ready && !was) buzz(6);
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

const FILES = ["index.html", "app.css", "js/app.js", "js/cnpy.js", "js/render.js", "js/viewer.js", "js/dropbox.js", "js/icons.js", "js/look.js", "js/version.js"];
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

(async function start()
{
    await freshKey();
    try { await dbx.finish(); }
    catch (e) { problem = e.message; }
    if (!history.state) history.replaceState({ at: 0, files: folder }, "");
    show();
    checkVersion();
})();
