// Canopy Board on a phone: a project's lists from Dropbox, ticked, added to, edited and put in order, saved back as
// they change. Three pages: the files, a project's lists, and one list full screen.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";

const app = document.getElementById("app");

// ---- what is open ----

let page = "files";       // files, project or list
let folder = remembered("canopy.folder", "");
let project = null;       // { path, name, local, base: { doc, rev }, steps, lists }
let listId = null;        // the list open full screen
let arranging = false;    // the list's Edit mode: handles, delete and kinds
let editing = null;       // the entry being typed in: { id } or, for a new one, { fresh: true, after, kind }
let problem = "";         // what went wrong, shown on the page until the next one

function remembered(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; } }
function remember(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { } }

// ---- colours, as the desktop app makes a list's from its own colour ----

function rgb(hex) { const h = (hex || "").replace("#", "").slice(-6); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function hex(c) { return "#" + c.map(v => Math.round(v).toString(16).padStart(2, "0")).join(""); }
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
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => Math.floor(v + (y[i] - v) * t + 0.5))); }
function dark(c) { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000 <= 140; }
function look(list)
{
    const card = list.fill ? derived(list.fill, 10) : "#262927", tile = list.fill ? derived(list.fill, 11) : "#313534";
    const head = list.fill ? derived(list.fill, 7) : "#D2F6D1";
    return { card, tile, head, stripe: list.ink || "#428C6A", ink: dark(tile) ? "#EAECEB" : "#151616", onCard: dark(card) ? "#EAECEB" : "#151616", box: mix(tile, head, 0.35) };
}

// ---- small pieces ----

const icons = {
    back: '<path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2h9A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    file: '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 9h8M8 12.5h8M8 16h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    up: '<path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    more: '<circle cx="5" cy="12" r="1.8" fill="currentColor"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/><circle cx="19" cy="12" r="1.8" fill="currentColor"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.05-4.95M19 5v4h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
    tick: '<path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
    handle: '<path d="M6 9h12M6 15h12" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
    remove: '<circle cx="12" cy="12" r="9" fill="currentColor"/><path d="M8 12h8" stroke="#1a1a1a" stroke-width="2.4" stroke-linecap="round"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
};
function icon(name, size) { return '<svg width="' + (size || 22) + '" height="' + (size || 22) + '" viewBox="0 0 24 24" aria-hidden="true">' + icons[name] + "</svg>"; }
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function text(s) { return (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function plain(s) { return (s || "").replace(/\*\*(\S[\s\S]*?\S|\S)\*\*/g, "$1").replace(/\*([^\s*][^*]*?[^\s*]|[^\s*])\*/g, "$1").split("\n")[0]; }
function bar(title, left, right) { return '<header class="bar">' + (left || "") + "<h1>" + text(title) + "</h1>" + (right || "") + "</header>"; }
function fileName(path) { return path.split("/").pop().replace(/\.cnpy$/i, ""); }

// ---- the pages ----

let draws = 0;   // how many times a page has been drawn
function show()
{
    draws++;
    const typing = app.querySelector("textarea");
    if (typing) typing.dataset.gone = "1";   // (drawn over: its blur, as it goes, is not the person leaving it)
    if (page === "list" && project && current()) return showList();
    if (page === "project" && project) return showProject();
    return showFiles();
}

function current() { return project && project.lists.find(l => l.id === listId); }

async function showFiles()
{
    page = "files";
    const signed = dbx.ready() && dbx.signedIn();
    if (!signed)
    {
        app.innerHTML = '<div class="hello"><img src="icons/icon-180.png" alt=""><h1>Canopy Board</h1>'
            + (dbx.ready() ? "<p>Sign in to Dropbox to open your projects' lists.</p><button class=\"main-button\" data-do=\"signin\">Sign in with Dropbox</button>"
                           : "<p>Dropbox isn't set up for this page yet: its app key goes in config.js.</p>")
            + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
            + localOpener() + "</div>";
        wire();
        return;
    }
    const recent = remembered("canopy.recent", []);
    app.innerHTML = bar("Canopy Board", "", '<button class="icon" data-do="account" aria-label="Account">' + icon("more") + "</button>")
        + '<main class="page">'
        + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + (recent.length && folder === "" ? '<div class="section">Recent</div><div class="rows">' + recent.map(r => item("file", fileName(r), r.split("/").slice(0, -1).join("/") || "Dropbox", "open", r)).join("") + "</div>" : "")
        + '<div class="section">' + (folder === "" ? "Dropbox" : text(folder.split("/").pop())) + '</div>'
        + (folder !== "" ? '<div class="where">' + text(folder) + "</div>" : "")
        + '<div class="rows" id="items"><div class="empty">Loading…</div></div>'
        + localOpener() + "</main>";
    wire();
    let items;
    try { items = await dbx.list(folder); }
    catch (e) { return failed(e); }
    if (page !== "files") return;
    const holder = document.getElementById("items");
    holder.innerHTML = (folder !== "" ? item("up", "Up a folder", "", "up", "") : "")
        + items.map(i => item(i.folder ? "folder" : "file", i.folder ? i.name : fileName(i.name), i.folder ? "" : when(i.modified), i.folder ? "into" : "open", i.path)).join("")
        + (items.length === 0 ? '<div class="empty">No folders or projects here</div>' : "");
    wire(holder);
}

function item(kind, name, sub, does, value)
{
    return '<button class="item" data-do="' + does + '" data-value="' + text(value) + '">' + icon(kind) + '<span class="label"><div class="name">' + text(name) + "</div>"
        + (sub ? '<div class="sub">' + text(sub) + "</div>" : "") + "</span></button>";
}
function when(iso) { if (!iso) return ""; const d = new Date(iso); return "Saved " + d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
function localOpener()
{
    return '<div class="local"><button class="quiet-button" data-do="pick">Open a file on this phone</button><span>Edits to a file opened this way stay here: save a copy to keep them.</span>'
        + '<input class="hidden-input" type="file" id="picker"></div>';
}

function showProject()
{
    page = "project";
    const lists = project.lists.slice().sort((a, b) => (a.y - b.y) || (a.x - b.x));
    app.innerHTML = bar(project.name, '<button class="icon" data-do="files" aria-label="Back">' + icon("back") + "</button>", statusHtml() + refreshButton())
        + '<main class="page">' + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + (project.base.doc.readOnly ? '<div class="problem">Saved by an older version of Canopy Board: its lists can be read here, not changed. Opening and saving it on the desktop updates it.</div>' : "")
        + (lists.length === 0 ? '<div class="empty">This project has no lists</div>' : '<div class="cards">' + lists.map(card).join("") + "</div>")
        + (project.local ? '<div class="local"><button class="quiet-button" data-do="copy">Save a copy</button></div>' : "")
        + "</main>";
    wire();
}

function card(l)
{
    const c = look(l), tasks = l.rows.filter(r => r.kind === "T"), done = tasks.filter(r => r.done).length;
    const peek = l.rows.filter(r => r.kind !== "D" && (l.showDone || !r.done)).slice(0, 3);
    return '<button class="card" data-do="list" data-value="' + text(l.id) + '" style="background:' + c.card + ";color:" + c.onCard + '">'
        + '<div class="stripe" style="background:' + c.stripe + '"></div><div class="title">' + text(l.name || "List") + "</div>"
        + '<div class="count">' + (tasks.length ? done + " of " + tasks.length + " done" : l.rows.length + (l.rows.length === 1 ? " entry" : " entries")) + "</div>"
        + (peek.length ? '<div class="peek">' + peek.map(r => '<div class="' + (r.done ? "done" : "") + '" style="' + (r.kind === "H" ? "font-weight:700;padding-left:2px" : "background:" + c.tile + ";color:" + c.ink) + '">' + text(plain(r.text)) + "</div>").join("") + "</div>" : "")
        + (l.layer ? '<div class="layer">' + text(l.layer) + "</div>" : "")
        + "</button>";
}

function showList()
{
    page = "list";
    const l = current(), c = look(l);
    const showDone = remembered("canopy.done." + l.id, l.showDone);
    const rows = l.rows.filter(r => showDone || !r.done || (editing && editing.id === r.id));
    const locked = project.base.doc.readOnly;
    let html = "";
    for (const r of rows)
    {
        html += entry(r, c);
        if (editing && editing.fresh && editing.after === r.id) html += draft(c);
    }
    if (editing && editing.fresh && (editing.after === null || !rows.some(r => r.id === editing.after))) html = (editing.after === null ? draft(c) + html : html + draft(c));
    const hidden = l.rows.filter(r => r.done).length;
    app.innerHTML = bar(l.name || "List", '<button class="icon" data-do="project" aria-label="Back">' + icon("back") + "</button>",
            statusHtml() + (locked ? "" : '<button class="word' + (arranging ? " on" : "") + '" data-do="arrange">' + (arranging ? "Done" : "Edit") + "</button>")
            )
        + '<main class="sheet" style="background:' + c.card + ";color:" + c.onCard + '">'
        + (problem ? '<div class="problem">' + text(problem) + "</div>" : "")
        + '<div class="stripe" style="background:' + c.stripe + '"></div><h2 class="title">' + text(l.name || "List") + "</h2>"
        + '<div class="entries" id="entries">' + html + "</div>"
        + (locked ? "" : '<div class="adders"><button class="adder" data-do="add" data-value="T">+ Add task</button>'
            + (arranging ? '<button class="adder" data-do="add" data-value="H">+ Heading</button><button class="adder" data-do="add" data-value="D">+ Divider</button>' : "") + "</div>")
        + (hidden ? '<button class="note-line" data-do="showdone">' + (showDone ? "Hide completed" : "Show " + hidden + " completed") + "</button>" : "")
        + "</main>";
    app.style.background = c.card;
    wire();
    const ta = app.querySelector("textarea");
    if (ta) { grow(ta); ta.focus(); const n = ta.value.length; ta.setSelectionRange(n, n); }
}

function entry(r, c)
{
    const tile = r.kind === "T" || r.kind === "N" ? "background:" + c.tile + ";color:" + c.ink : "";
    const isEditing = editing && !editing.fresh && editing.id === r.id;
    let inner = "";
    if (arranging) inner += '<button class="remove" data-do="remove" data-value="' + r.id + '" aria-label="Delete">' + icon("remove", 20) + "</button>";
    if (r.kind === "D") inner += '<div class="line" style="background:' + mix(c.tile, dark(c.tile) ? "#ffffff" : "#000000", 0.14) + '"></div>';
    else
    {
        if (r.kind === "T")
        {
            const box = r.color || c.box;
            inner += '<button class="check" data-do="tick" data-value="' + r.id + '" aria-label="' + (r.done ? "Not done" : "Done") + '"><span style="border-color:' + box + (r.done ? ";background:" + box + ";color:" + (dark(box) ? "#fff" : "#000") : "") + '">' + (r.done ? icon("tick", 16) : "") + "</span></button>";
        }
        inner += isEditing ? '<textarea rows="1" data-id="' + r.id + '">' + text(r.text) + "</textarea>"
                           : '<div class="words" data-do="type" data-value="' + r.id + '">' + cnpy.rich(r.text) + "</div>";
        if (r.link && !arranging) inner += '<span class="link">' + icon("link", 16) + "</span>";
    }
    if (arranging)
    {
        inner += '<select class="kind" data-id="' + r.id + '" style="color:inherit">' + [["T", "Task"], ["N", "Note"], ["H", "Heading"], ["D", "Divider"]].map(k => '<option value="' + k[0] + '"' + (k[0] === r.kind ? " selected" : "") + ">" + k[1] + "</option>").join("") + "</select>";
        inner += '<span class="handle" data-id="' + r.id + '" aria-label="Move">' + icon("handle") + "</span>";
    }
    return '<div class="entry ' + r.kind + (r.done ? " done" : "") + (isEditing ? " editing" : "") + '" data-id="' + r.id + '" style="' + tile + '">' + inner + "</div>";
}

function draft(c)   // a new entry being typed, not in the list until it has words
{
    const k = editing.kind;
    return '<div class="entry ' + k + ' editing" style="' + (k === "H" ? "" : "background:" + c.tile + ";color:" + c.ink) + '">'
        + (k === "T" ? '<span class="check"><span style="border-color:' + c.box + '"></span></span>' : "")
        + '<textarea rows="1" data-fresh="1" placeholder="' + (k === "H" ? "Heading" : "New task") + '"></textarea></div>';
}

function grow(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }

// ---- saving: what is done here kept as steps, written back on top of whatever the file now is ----

let saving = false, saveTimer = null, state = "saved", stateWhy = "";

function statusHtml()
{
    if (!project) return "";
    if (project.local) return '<span class="status">On this phone</span>';
    const words = { saved: "Saved", saving: "Saving…", waiting: "Not saved yet", updated: "Updated" }[state] || "";
    return '<button class="status' + (state === "waiting" ? " warn" : "") + '" id="status" data-do="refresh" title="' + text(stateWhy || "Check for changes") + '">' + words + "</button>";   // (tapped: saved now, and checked for changes)
}
function refreshButton() { return project && !project.local ? '<button class="icon" data-do="refresh" aria-label="Check for changes">' + icon("refresh", 20) + "</button>" : ""; }
function setState(s, why)
{
    state = s; stateWhy = why || "";
    const at = document.getElementById("status");
    if (at) { at.outerHTML = statusHtml(); document.getElementById("status").addEventListener("click", () => act("refresh")); }
}

function step(s)
{
    if (!project || project.base.doc.readOnly) return;
    s.list = listId;
    project.steps.push(s);
    project.lists = cnpy.apply(project.base.doc.lists, project.steps);
    keepSteps();
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
        for (let tries = 0; tries < 5; tries++)
        {
            const n = p.steps.length;
            const bytes = await cnpy.save(p.base.doc, cnpy.apply(p.base.doc.lists, p.steps.slice(0, n)));
            try
            {
                const rev = await dbx.write(p.path, bytes, p.base.rev);
                p.base = { doc: await cnpy.open(bytes), rev };
                p.steps = p.steps.slice(n);
                break;
            }
            catch (e)
            {
                if (!(e instanceof dbx.Conflict)) throw e;
                // Someone saved it meanwhile: theirs read, and these steps done again on top of it.
                const got = await dbx.read(p.path);
                p.base = { doc: await cnpy.open(got.bytes), rev: got.rev };
            }
        }
        if (p !== project) return;
        project.lists = cnpy.apply(project.base.doc.lists, project.steps);
        keepSteps();
        problem = "";
        setState(project.steps.length ? "saving" : "saved");
        if (project.steps.length) saveTimer = setTimeout(save, 400);
        if (!editing) show();
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

// A newer version saved elsewhere, read in (only with nothing of ours waiting: that goes through saving).
async function catchUp(quiet)
{
    if (!project || project.local || saving || editing || project.steps.length) return;
    const p = project;
    try
    {
        const rev = await dbx.version(p.path);
        if (rev === p.base.rev) { if (!quiet) setState("saved"); return; }
        const got = await dbx.read(p.path);
        if (p !== project || editing || project.steps.length) return;
        project.base = { doc: await cnpy.open(got.bytes), rev: got.rev };
        project.lists = cnpy.apply(project.base.doc.lists, project.steps);
        if (page === "list" && !current()) page = "project";
        show();
        setState("updated");
        setTimeout(() => { if (state === "updated") setState("saved"); }, 2500);
    }
    catch (e) { if (e instanceof dbx.SignedOut) failed(e); }
}
setInterval(() => catchUp(true), 20000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { catchUp(true); save(); } });
window.addEventListener("online", () => save());

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
        project = { path, name: fileName(path), local: false, base: { doc, rev: got.rev }, steps: waiting, lists: [] };
        project.lists = cnpy.apply(doc.lists, project.steps);
        const recent = remembered("canopy.recent", []).filter(r => r !== path);
        remember("canopy.recent", [path, ...recent].slice(0, 5));
        page = project.lists.length === 1 ? "list" : "project";
        listId = project.lists.length === 1 ? project.lists[0].id : null;
        setState(waiting.length ? "saving" : "saved");
        show();
        if (waiting.length) save();
    }
    catch (e) { failed(e); }
}

async function openLocal(file)
{
    problem = "";
    try
    {
        const doc = await cnpy.open(new Uint8Array(await file.arrayBuffer()));
        project = { path: file.name, name: fileName(file.name), local: true, base: { doc, rev: null }, steps: [], lists: doc.lists };
        page = doc.lists.length === 1 ? "list" : "project";
        listId = doc.lists.length === 1 ? doc.lists[0].id : null;
        show();
    }
    catch (e) { problem = "Couldn't open " + file.name + ": " + e.message; show(); }
}

async function saveCopy()
{
    const bytes = await cnpy.save(project.base.doc, project.lists);
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const name = project.name + ".cnpy";
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
    if (e instanceof dbx.SignedOut) { project = null; page = "files"; }
    show();
}

// ---- typing in an entry ----

// The words typed kept (Enter, "goOn": on to a new entry below). "draw": the page again now; a tap elsewhere that
// ended the typing draws it itself (it would be lost if the page were drawn again under the finger first).
function finishTyping(goOn, draw)
{
    const ta = app.querySelector("textarea");
    if (!ta || !editing) return;
    const words = ta.value.replace(/\s+$/, "");
    const was = editing;
    editing = null;
    let next = null;
    if (was.fresh)
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
        const r = current().rows.find(o => o.id === was.id);
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
    if (e.key === "Backspace" && ta.value === "" && editing)
    {
        // An empty entry backspaced: gone, and the one above it typed in.
        e.preventDefault();
        const l = current();
        const was = editing;
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
    const from = all.indexOf(row), box = row.getBoundingClientRect(), h = box.height + 6, y0 = e.clientY;
    const mids = all.map(o => { const r = o.getBoundingClientRect(); return r.top + r.height / 2; });   // where each entry's middle was
    let to = from;
    row.classList.add("lifted");
    handle.setPointerCapture(e.pointerId);
    const move = ev =>
    {
        const dy = ev.clientY - y0, mid = box.top + box.height / 2 + dy;
        row.style.transform = "translateY(" + dy + "px)";
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

// ---- what each button does ----

function wire(root)
{
    (root || app).querySelectorAll("[data-do]").forEach(b => b.addEventListener("click", ev => act(b.dataset.do, b.dataset.value, ev)));
    if (root) return;
    const picker = app.querySelector("#picker");
    if (picker) picker.addEventListener("change", () => { if (picker.files[0]) openLocal(picker.files[0]); });
    const ta = app.querySelector("textarea");
    if (ta)
    {
        ta.addEventListener("input", () => grow(ta));
        ta.addEventListener("keydown", keyDown);
        ta.addEventListener("blur", () =>
        {
            if (ta.dataset.gone || !app.contains(ta)) return;
            finishTyping(false, false);
            const drawn = draws;
            setTimeout(() => { if (draws === drawn) show(); }, 350);   // (nothing else drew the page: drawn now, the words in place)
        });
    }
    app.querySelectorAll("select.kind").forEach(s => s.addEventListener("change", () =>
    {
        const fields = { kind: s.value };
        if (s.value !== "T") fields.done = false;
        if (s.value === "D") fields.text = "";
        step({ t: "set", id: s.dataset.id, fields });
        show();
    }));
    app.querySelectorAll(".handle").forEach(h => h.addEventListener("pointerdown", e => { e.preventDefault(); drag(h, e); }));
    if (page !== "list") app.style.background = "";
}

function act(what, value, ev)
{
    switch (what)
    {
        case "signin": dbx.signIn(); break;
        case "account":
            if (confirm("Signed in to Dropbox" + (dbx.who() ? " as " + dbx.who() : "") + ".\n\nSign out?")) { dbx.signOut(); project = null; show(); }
            break;
        case "pick": app.querySelector("#picker").click(); break;
        case "into": folder = value; remember("canopy.folder", folder); showFiles(); break;
        case "up": folder = folder.split("/").slice(0, -1).join("/"); remember("canopy.folder", folder); showFiles(); break;
        case "open": openPath(value); break;
        case "files": editing = null; arranging = false; page = "files"; project = project && project.steps.length && !project.local ? project : null; show(); break;
        case "project": finishTyping(false); editing = null; arranging = false; page = "project"; show(); break;
        case "list": listId = value; page = "list"; editing = null; arranging = false; show(); break;
        case "refresh": save(); catchUp(false); break;
        case "copy": saveCopy(); break;
        case "arrange": finishTyping(false); arranging = !arranging; editing = null; show(); break;
        case "tick":
        {
            const r = current().rows.find(o => o.id === value);
            if (r) step({ t: "set", id: r.id, fields: { done: !r.done } });
            show();
            break;
        }
        case "type":
            if (arranging || project.base.doc.readOnly) break;
            if (ev && ev.target.closest("a")) break;
            if (editing) finishTyping(false);
            editing = { id: value };
            show();
            break;
        case "add":
        {
            if (editing) finishTyping(false);
            const l = current(), last = l.rows.length ? l.rows[l.rows.length - 1].id : null;
            if (value === "D") { step({ t: "add", row: { id: cnpy.newId(), kind: "D", done: false, color: null, text: "", link: null }, after: last }); show(); break; }
            editing = { fresh: true, after: last, kind: value };
            show();
            break;
        }
        case "remove": step({ t: "del", id: value }); show(); break;
        case "showdone":   // (on this phone only: the list's own setting is the desktop app's)
        {
            const l = current();
            remember("canopy.done." + l.id, !remembered("canopy.done." + l.id, l.showDone));
            show();
            break;
        }
    }
}

// ---- starting ----

(async function start()
{
    try { await dbx.finish(); }
    catch (e) { problem = e.message; }
    show();
})();
