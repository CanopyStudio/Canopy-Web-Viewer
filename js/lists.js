// The lists: their cards on the Lists tab (put in order by holding one), and a list opened over the tabs, its entries
// ticked, typed in, moved, swiped away and changed from their menus; the list's own options, and links to the canvas.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import * as render from "./render.js";
import { thumbnail } from "./viewer.js";
import { act, app, arranging, bar, calm, closeViewers, current, editing, element, feel, grow, holdScroll, icon, iconButton, letScroll, open, problem, project, remember, remembered, setArranging, setEditing, setOpen, sheetUp, show, sortedLists, step, stepTo, stillDown, text, undoable, undoButtons, wire } from "./app.js";
import { statusHtml } from "./saving.js";

export function setOneColumn(on) { oneColumn = on; remember("canopy.onecolumn", on); }
// Two columns, each card going into the shorter one (so they sit together however tall they are).
export let oneColumn = remembered("canopy.onecolumn", false);   // the lists in one column (the account menu's)
export function masonry(holder, cards, single)
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

export function showLists(holder)
{
    closeViewers();
    const lists = sortedLists();
    if (lists.length === 0) { holder.innerHTML = '<div class="empty big">No lists in this project yet' + (project.base.doc.readOnly ? "" : '<br><button class="quiet-button" data-do="newlist">New list</button>') + "</div>"; wire(holder); return; }
    const cards = lists.map(l => ({ id: l.id, el: element(listCard(l)), weight: 3 + guessTall(l) / 52 }));
    masonry(holder, cards, oneColumn);
    trimCards(holder);
    if (!project.base.doc.readOnly) arrangeCards(holder, cards);
    if (project.base.doc.readOnly) holder.insertAdjacentHTML("afterbegin", '<div class="problem">This project was saved by an older version of Canopy Board, so it can&#39;t be changed here. Open and save it in Canopy Board to update it.</div>');
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

export function showList(over)
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
        if (r.link && !arranging && !isEditing) inner += '<button class="link" data-do="follow" data-value="' + text(r.link) + '" aria-label="Go to link">' + icon("link", 18) + "</button>";
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
export function growArea(ta) { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; }
// What is being typed in, kept in sight above the keyboard: the list given room below for the keyboard, and scrolled
// to just above it (the screen the keyboard leaves is the phone's "visual viewport").
export function keepInView()
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

// A new list: on the canvas clear of everything, to the right of it all and level with the top of the other lists,
// opened to be named (it can be moved where it belongs on the desktop).
export function newList(at)
{
    // (from the canvas: in the middle of what it shows; else to the right of everything)
    const doc = project.base.doc, lists = project.view.lists, e = render.extent(project.scene);
    const x = at ? at.x - cnpy.LIST_W / 2 : e.x + e.w + 80, y = at ? at.y - 120 : lists.length ? Math.min(...lists.map(l => l.y)) : e.y;
    const id = cnpy.newId();
    step({ t: "newlist", list: id, x, y, name: "", layer: cnpy.topLayer(doc), author: dbx.who() });
    stepTo({ kind: "list", id });
    setOpen({ kind: "list", id }); setArranging(false); setEditing({ title: true });
    show();
    grow(app.querySelector("#over .sheet-wrap"), null);
}

// ---- typing in an entry, or the list's name ----

// The words typed kept (Enter, "goOn": on to a new entry below). "draw": the page again now; a tap elsewhere that
// ended the typing draws it itself (it would be lost if the page were drawn again under the finger first).
export function finishTyping(goOn, draw)
{
    const ta = app.querySelector("#over textarea, #over input.title-edit");
    if (!ta || !editing) return;
    const words = ta.value.replace(/\s+$/, "");
    const was = editing;
    setEditing(null);
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
    setEditing(next);
    if (draw !== false) show();
}

export function keyDown(e)
{
    const ta = e.target;
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); finishTyping(true); return; }
    if (e.key === "Escape") { setEditing(null); show(); return; }
    if (e.key === "Backspace" && ta.value === "" && editing && !editing.title)
    {
        // An empty entry backspaced: gone, and the one above it typed in.
        e.preventDefault();
        const l = current(), was = editing;
        setEditing(null);
        let above = null;
        if (was.fresh) above = was.after;
        else
        {
            const at = l.rows.findIndex(r => r.id === was.id);
            above = at > 0 ? l.rows[at - 1].id : null;
            step({ t: "del", id: was.id });
        }
        const r = above && current().rows.find(o => o.id === above);
        setEditing(r && r.kind !== "D" ? { id: r.id } : null);
        show();
    }
}

// ---- moving entries (Edit mode): held by the handle and dragged ----

export function drag(handle, e)
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

export function touchEntries(root)
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

// The list's entries, and its "Show completed" line, as they now are (the rest of it left as it is).
export function refreshList()
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
export function redrawEntries()
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
            + (r.link && r.kind !== "D" ? '<button class="action" data-do="unlink"><span>Remove link</span></button>' : "")
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
        const kinds = { list: "List", image: "Image", type: "Type", paint: "Drawing", rect: "Rectangle", oval: "Ellipse", path: "Path", line: "Line", arrow: "Arrow" };
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
export function drawLinkThumbs()
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
        thumbnail(c, shown, area, project.get, render.back(project.base.doc));
    });
}

// The list's own options: its color (the stripe made from it), showing what's done, deleting it.
export function listMenu()
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
            close(() => { step({ t: "dellist" }); setOpen(null); show(); });
        }
    });
}
