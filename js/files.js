// The files page: the Dropbox folder on show, the projects pinned, lately opened and kept on this phone, and the
// pictures of a folder, looked at one at a time (and added to a project's canvas).

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import * as off from "./offline.js";
import { VERSION } from "./version.js";
import { addPhoto, app, awake, bar, calm, closeViewers, element, failed, feel, fileName, focusBoard, folder, footColor, full, furthest, go, holdScroll, icon, iconButton, letScroll, openPath, problem, project, remember, remembered, setFull, setProblem, setTab, sheetUp, show, stillDown, text, toast, wire } from "./app.js";

export async function showFiles()
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
    const phone = (await off.all()).sort((a, b) => fileName(a.path).localeCompare(fileName(b.path))), waits = await off.waiting();
    const at = history.state && history.state.at || 0;
    const arrows = iconButton("back", "back", "Back", "", at === 0 && folder === "") + iconButton("ahead", "forward", "Forward", "", at >= furthest());
    const inFolder = r => r.split("/").slice(-2, -1)[0] || "Dropbox";
    app.innerHTML = bar("Canopy Web Viewer", "", arrows + iconButton("account", "more", "Account"), "files-bar", "home")
        + '<main class="page enter">'
        + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + (pins.length && folder === "" ? heading("pinned", "Pinned") + '<div class="rows" id="pinned">' + pins.map(r => item("file", fileName(r), inFolder(r), "open", r)).join("") + "</div>" : "")
        + (recent.length && folder === "" ? heading("recent", "Recent") + '<div class="rows">' + recent.map(r => item("file", fileName(r), inFolder(r), "open", r)).join("") + "</div>" : "")
        + (phone.length && folder === "" ? heading("phone", "On this phone") + '<div class="rows">' + phone.map(k => item("file", fileName(k.path), waits.has(k.path) ? "Changes to save" : "Kept " + when(new Date(k.at).toISOString()), "open", k.path)).join("") + "</div>" : "")
        + heading("here", folder === "" ? "Dropbox" : folder.split("/").pop())
        + (folder !== "" && !folded().includes("here") ? '<div class="where">' + ["Dropbox"].concat(folder.split("/").filter(Boolean)).map(text).join(" / ") + "</div>" : "")
        + '<div class="rows" id="items"><div class="empty">Loading…</div></div>'
        + '<input class="hidden-input" type="file" id="picker">'
        + '<div class="version">Canopy Web Viewer ' + VERSION + "</div></main>";
    wire();
    arrangePins();
    let items;
    try { items = await dbx.list(folder); }
    catch (e)
    {
        // (no connection: the projects kept on this phone are what can be opened)
        if (!(e instanceof dbx.Offline)) return failed(e);
        const h = document.getElementById("items");
        if (h)
        {
            h.innerHTML = '<div class="empty">No connection.' + (phone.length ? " Projects on this phone still open, and save once you're back online." : " Projects kept on this phone (tap the arrow by one) open without one.") + "</div>"
                + (folder !== "" ? phone.map(k => item("file", fileName(k.path), waits.has(k.path) ? "Changes to save" : "On this phone", "open", k.path)).join("") : "");   // (in a folder: they are here too)
            wire(h);
        }
        return;
    }
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
export let picture = null;   // the picture open over the files: { path, el, url }
export function showPicture(path)
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
export function closePicture()
{
    const p = picture;
    if (!p) return;
    picture = null;
    p.el.style.pointerEvents = "none";   // (going: taps go to what is under it)
    const gone = () => { p.el.remove(); if (p.url) URL.revokeObjectURL(p.url); footColor(); };
    if (calm) gone(); else p.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 }).onfinish = gone;
}
// The next or last picture of the folder (as the history's place: going back closes the picture, not each one seen).
export function nextPicture(by)
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
export function addPicture()
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
        if (!boards.length) { setTab("canvas"); show(); addPhoto(file); return; }
        sheetUp(() => '<div class="ptitle">Put it on…</div><div class="scroll"><button class="pick" data-do="on" data-value=""><span>The canvas</span>' + icon("canvas", 18) + "</button>"
            + '<div class="section">Boards</div>' + boards.map(b => '<button class="pick" data-do="on" data-value="' + text(b.id) + '"><span>' + text(b.name) + "</span></button>").join("") + "</div>",
            (d, id, shut) => { if (d !== "on") return; shut(() => { if (id) focusBoard(id, false); else { setTab("canvas"); show(); } addPhoto(file); }); });
    });
}

// A heading as the desktop app's are: its words, after the arrow that folds what is under it away (and back).
export function folded() { return remembered("canopy.folded", []); }
function heading(key, words)
{
    const shut = folded().includes(key);
    return '<h2 class="section' + (shut ? " shut" : "") + '"><button data-do="fold" data-value="' + key + '" aria-expanded="' + !shut + '">' + icon(shut ? "chevron" : "open", 12) + "<span>" + text(words) + "</span></button></h2>";
}
// A row as the desktop app's project lists have them: the name, a faded note at the right (when it was saved, or where it
// is); a folder marked as one, and goes on into it; a project can be pinned.
function item(kind, name, note, does, value)
{
    const pinned = kind === "file" && remembered("canopy.pinned", []).includes(value), kept = kind === "file" && off.has(value);
    return '<div class="item-row"><button class="item' + (kind === "folder" ? " folder" : "") + '" data-do="' + does + '" data-value="' + text(value) + '">'
        + (kind === "folder" ? icon("folder", 18) : kind === "picture" ? '<img class="thumb" alt="">' : "") + '<span class="name">' + text(name) + "</span>"
        + (note ? '<span class="note">' + text(note) + "</span>" : "") + (kind === "folder" ? icon("chevron", 16) : "") + "</button>"
        + (kind === "file" ? '<button class="pin keep' + (kept ? " on" : "") + '" data-do="keep" data-value="' + text(value) + '" aria-label="' + (kept ? "Remove from this phone" : "Keep on this phone") + '" title="' + (kept ? "Remove from this phone" : "Keep on this phone") + '">' + icon("download", 16) + "</button>"
            + '<button class="pin' + (pinned ? " on" : "") + '" data-do="pin" data-value="' + text(value) + '" aria-label="' + (pinned ? "Unpin" : "Pin to top") + '" title="' + (pinned ? "Unpin" : "Pin to top") + '">' + icon("pin", 16) + "</button>" : "") + "</div>";
}
// A project kept on this phone for when there is no connection (a copy of it made now), or no longer.
export async function keepOnPhone(path)
{
    if (off.has(path)) { await off.drop(path); toast("No longer kept on this phone"); showFiles(); return; }
    toast("Keeping it on this phone\u2026");
    try { const got = await dbx.read(path); await off.keep(path, got.bytes, got.rev); toast("Kept on this phone: it opens without a connection"); }
    catch (e) { toast(e instanceof dbx.Offline ? "No connection: it can be kept once there is one" : e instanceof dbx.SignedOut || /^Couldn't|^That file/.test(e.message) ? e.message : "This phone hasn't room to keep it"); }
    if (!project) showFiles();
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

// A new project, empty, in the Dropbox folder on show, opened.
export async function newProject()
{
    const name = (prompt("Name the new project") || "").trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!name) return;
    const path = (folder ? folder : "") + "/" + name + ".cnpy";
    try { await dbx.create(path, await cnpy.blankFile()); }
    catch (e) { setProblem(e.message); return showFiles(); }
    openPath(path);
}
