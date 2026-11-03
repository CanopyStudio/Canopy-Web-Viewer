// Drawing on the canvas or a board: the drawing bar's tools and its popovers (the tools of a slot, the brush and its
// color), strokes, Fill, the Eyedropper and Drawing Select.

import * as cnpy from "./cnpy.js";
import * as dbx from "./dropbox.js";
import { boardView, calm, canvasView, corner, element, feel, grabPicked, icon, pick, picked, project, redos, redrawViewers, refreshView, remember, remembered, step, toast, tools, undoable, undoRedo, undos } from "./app.js";
import { keepSteps, save, saveTimer, setState, state } from "./saving.js";
import { hierarchyModel } from "./hierarchy.js";

// Its color: one of the palette's (the color of every shape picked).
export function shapeColors(v, btn)
{
    const ids = picked.ids, pal = remembered("canopy.palette", null) || PALETTE;
    const now = (project.scene.items.find(o => o.id === ids[0]) || {}).fill || "";
    popFrom(btn, '<div class="qswatches">' + pal.map(c => '<button class="qcolor' + (c.toUpperCase() === now.toUpperCase() ? " on" : "") + '" data-ink="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join("") + "</div>",
        card => card.querySelectorAll("[data-ink]").forEach(x => x.addEventListener("click", () =>
        {
            const fills = {};
            for (const id of ids) fills[id] = x.dataset.ink;
            step({ t: "fill", list: null, fills });
            session = { ...sessionInk(), color: x.dataset.ink };
            card.querySelectorAll("[data-ink]").forEach(y => y.classList.toggle("on", y === x));
            btn.querySelector("i").style.background = x.dataset.ink;
            v.redraw();
        })));
}

// ---- drawing: strokes on the canvas or a board, kept as points (each a step, undone as one) and painted into a
// drawing layer's tiles as the project is saved (paintSketches), as Board keeps its own. They go on the drawing being
// drawn on (project.drawOn) until another is chosen (in the hierarchy) or a new one asked for: saved or not, it is
// drawn on and rubbed out the same, its pixels and the new strokes painted together each time it is saved ----

export let pen = null;          // drawing: { kind: the tool in use, slots: the tool each of the bar's slots shows, size (on the screen), color }; null when not
let sketchId = null;     // the strokes on a saved drawing since it was last saved: kept together under this id
export let paintSel = null;     // what is selected of the drawing being drawn on (Drawing Select): { pts: its outline, on the canvas }
const SIZE = { least: 1, most: 120, start: 8 };   // the brush's size, on the canvas (as Board's: the same however far in it is zoomed)
// The palette to begin with (each phone keeps its own, changed as it likes): grays, then round the colors.
const PALETTE = ["#151616", "#FFFFFF", "#7C807E", "#C9CCCA", "#E05A47", "#F28C38", "#F2C53A", "#4FB477", "#2FA3A0", "#3F8FD8", "#8E5BD6", "#E45FA8", "#8B5E3C", "#F1D7B0"];
// The drawing bar's three slots, each holding a few tools: a tap uses the one it shows, a tap again (or a press and
// hold) picks another.
const SLOTS = [
    { id: "pick", tools: [["select", "select", "Select"], ["rect", "selrect", "Drawing Select (rectangle)"], ["lasso", "sellasso", "Drawing Select (lasso)"]] },
    { id: "brush", tools: [["pen", "ink", "Ink"], ["flat", "flat", "Flat"]] },
    { id: "rub", tools: [["erase", "eraser", "Eraser"], ["fill", "fill", "Fill"], ["dropper", "dropper", "Eyedropper"]] }
];
const TOOL_OF = Object.fromEntries(SLOTS.flatMap(sl => sl.tools.map(t => [t[0], { slot: sl.id, icon: t[1], name: t[2] }])));
export function drawMode()
{
    const v = boardView || canvasView;
    if (!v || !project || project.base.doc.readOnly) return;
    if (pen) { endDrawing(v); return; }
    const was = remembered("canopy.pen", null) || {};
    const slots = { pick: "select", brush: "pen", rub: "erase" };
    for (const k in was.slots || {}) if (TOOL_OF[was.slots[k]] && TOOL_OF[was.slots[k]].slot === k) slots[k] = was.slots[k];   // (one no longer on the bar: the first)
    const kind = TOOL_OF[was.kind] && was.kind !== "dropper" ? was.kind : "pen";
    const size = was.size >= SIZE.least && was.size <= SIZE.most ? was.size : SIZE.start;
    const ink = sessionInk();
    pen = { kind, slots, size, opacity: ink.opacity, color: ink.color };
    pick(null, v);
    corner();
    setState(state);   // (the save button shown as drawing has it)
}
// The color drawing (and a shape) starts with: each time the app is opened, fully opaque and a color of the palette's
// picked at random (grays left out); after that, the one last drawn with.
let session = null;
export function sessionInk()
{
    if (session) return session;
    const pal = remembered("canopy.palette", null) || PALETTE, bright = pal.filter(c => toHsv(c)[1] >= 25 && toHsv(c)[2] >= 25);
    const from = bright.length ? bright : pal;
    return session = { color: from[Math.floor(Math.random() * from.length)] || PALETTE[0], opacity: 1 };
}
export function endDrawing(v)
{
    penAway();
    if (v) tools(v);
    corner();
    redrawViewers();
    if (project) setState(state);
    if (project && project.steps.length) { clearTimeout(saveTimer); save(); }
}
// Drawing ended (its color kept for next time), what was selected let go.
export function penAway()
{
    if (pen) session = { color: pen.color, opacity: pen.opacity };
    pen = null; paintSel = null; closePop();
}
// The drawing strokes go on from now (null: a new one, made with the next stroke), kept for next time.
export function drawOnto(id) { project.drawOn = id; sketchId = null; paintSel = null; remember("canopy.drawon." + project.path, id); }
function keepPen() { remember("canopy.pen", { kind: pen.kind, slots: pen.slots, size: pen.size, opacity: pen.opacity, color: pen.color }); }
function useTool(kind, v)
{
    if (!TOOL_OF[kind]) return;
    if (pen.kind !== kind && TOOL_OF[pen.kind].slot === "pick" && TOOL_OF[kind].slot !== "pick") { paintSel = null; }
    pen.kind = kind; pen.slots[TOOL_OF[kind].slot] = kind;
    if (kind !== "select" && picked) pick(null, v);
    keepPen(); tools(v); v.redraw();
}
export function drawBar(v, bar, host)
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
    b.addEventListener("pointerdown", () => { held = false; clearTimeout(timer); timer = setTimeout(() => { if (!b.isConnected) return; held = true; feel.pick(); hold(); }, 380); });   // (the bar drawn anew meanwhile: no longer there to hold)
    const stop = () => clearTimeout(timer);
    b.addEventListener("pointerup", stop); b.addEventListener("pointercancel", stop); b.addEventListener("pointerleave", stop);
    b.addEventListener("contextmenu", e => e.preventDefault());
    b.addEventListener("click", () => { if (held) { held = false; return; } if (popOf === b) { closePop(); return; } closePop(); tap(); });
}
function dot(size, color, opacity) { const d = Math.max(5, Math.min(24, 4 + size * 0.45)); return '<i style="width:' + d + "px;height:" + d + "px;background:" + color + (opacity < 1 ? ";opacity:" + opacity : "") + '"></i>'; }

// ---- a popover from a button on the drawing bar: a card with a tab reaching down over its button, the two one shape
// (as Board's Drawing Bar has them); the button under the tab shows it can be put away there ----

export let popOf = null, popEl = null;
export function closePop() { if (popEl) popEl.remove(); popEl = null; if (popOf) popOf.classList.remove("popped"); popOf = null; document.removeEventListener("pointerdown", popAway, true); }
// (a tap away puts it away; one on the canvas does only that, and lays no paint)
function popAway(e)
{
    if (!popEl || popEl.contains(e.target) || (popOf && popOf.contains(e.target))) return;
    closePop();
    if (e.target.closest && e.target.closest(".stage")) { e.stopPropagation(); e.preventDefault(); }
}
function popFrom(btn, html, wire)
{
    closePop();
    const bar = btn.closest(".tools");
    if (!bar) return;   // (its button gone, the bar drawn anew)
    const frame = bar.parentNode, fb = frame.getBoundingClientRect(), bb = btn.getBoundingClientRect();
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
        const top = Math.round(barTop - gap - body);   // (on whole pixels, as its left: a phone draws a layer put between them soft)   // (clear of the bar, comfortably, as Board's are: only its tab reaches down)
        const x = sx - L;
        const flushL = x < r + f + 2, flushR = x + sw > W - r - f - 2;
        if (flushL) L = sx; else if (flushR) L = sx + sw - W;
        L = Math.round(L);
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
        card =>
        {
            card.querySelectorAll("[data-tool]").forEach(x => x.addEventListener("click", () => { closePop(); useTool(x.dataset.tool, v); }));
        });
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
export function drawPress(v, at, e)
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
    const s = strokeStep(drawTarget(false), { kind: pen.kind, color: pen.color, size: pen.size, pts: [], ...(pen.opacity < 1 ? { opacity: pen.opacity } : {}) });
    const pts = s.stroke.pts;
    // Each position eased toward, as Board's brush eases it, which irons out a finger's wobble. The eased points are then joined by a smooth curve through them (Catmull-Rom), points put
    // along it a short way apart, so a quick sweep is as round as a slow one; the last stretch, still to come right as
    // the next point decides its bend, is drawn each time but kept only once the next point comes (or the finger lifts).
    const lag = 0.54, gap = 2.5;   // (gap: between the points put along the curve, on the screen)
    let ex = null, ey = null, ep = 1, lx = null, ly = null, rawX = null, rawY = null, rawP = 1;
    const eased = [];   // the eased points, on the screen: x, y, pressure each
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
    // The curve from eased point i to i + 1 (its ends' neighbours bending it), points along it after its start.
    const along = (i, into) =>
    {
        const q = k => { const j = Math.max(0, Math.min(eased.length / 3 - 1, k)) * 3; return [eased[j], eased[j + 1], eased[j + 2]]; };
        const [x0, y0] = q(i - 1), [x1, y1, p1] = q(i), [x2, y2, p2] = q(i + 1), [x3, y3] = q(i + 2);
        const steps = Math.max(1, Math.min(48, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / gap)));
        for (let k = 1; k <= steps; k++)
        {
            const t = k / steps, t2 = t * t, t3 = t2 * t;
            const x = 0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3);
            const y = 0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
            keep(x, y, p1 + (p2 - p1) * t, into);
        }
    };
    const add = (p, ev) =>
    {
        rawX = p.x; rawY = p.y; rawP = ease(p, ev);
        if (lx !== null && Math.hypot(ex - lx, ey - ly) < 0.75) return;   // (closer than a pixel or so: no new point)
        lx = ex; ly = ey;
        eased.push(ex, ey, ep);
        const n = eased.length / 3;
        if (n === 1) keep(ex, ey, ep, pts);
        else if (n >= 3) along(n - 3, pts);   // (the stretch before the last: its bend now known)
    };
    // The last stretch, as it would be now: drawn this time only.
    const pending = () => { const out = [], n = eased.length / 3; if (n >= 2) along(n - 2, out); return out; };
    add(at, e);
    project.preview = s;
    refreshView();
    const wet = v.wet = { id: s.base || s.id, pts, ahead: [], stroke: s.stroke };
    let mine = null;   // (its undoing, once made)
    v.redraw();
    return {
        move(now, was, ev)
        {
            const evs = ev && ev.getCoalescedEvents ? ev.getCoalescedEvents() : [];
            if (evs.length) for (const one of evs) add(v.at(one), one); else add(now, ev);
            // Where the finger is guessed to be going next (where the browser can guess), eased on from here: drawn
            // this frame only, so the line keeps up with the finger.
            wet.ahead = pending();
            const guess = ev && ev.getPredictedEvents ? ev.getPredictedEvents() : [];
            if (guess.length)
            {
                let gx = ex, gy = ey;
                for (const one of guess) { const q = v.at(one); gx += (q.x - gx) * (1 - lag); gy += (q.y - gy) * (1 - lag); }
                keep(gx, gy, ep, wet.ahead);
            }
            v.redrawWet();   // (only the stroke: on the graphics chip, where it shows the drawing)
        },
        end()
        {
            // The rest of the way to where the finger lifted (easing leaves the line a little behind it), and the last
            // stretch kept as it now is.
            let more = false;
            if (rawX !== null && eased.length > 3 && Math.hypot(rawX - ex, rawY - ey) >= 0.75) { eased.push(rawX, rawY, rawP); more = true; }
            const n = eased.length / 3;
            if (more && n >= 3) along(n - 3, pts);
            if (n >= 2) along(n - 2, pts);
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
export function dropperAt(v, at)
{
    const px = v.snapshot().getContext("2d").getImageData(Math.round(at.x * v.dpr), Math.round(at.y * v.dpr), 1, 1).data;   // (as it shows, the drawing on the graphics chip too)
    pen.color = "#" + [px[0], px[1], px[2]].map(x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
    pen.kind = pen.slots.brush;
    keepPen(); tools(v);
    // (the color taken: shown by the bar's color pulsing, nothing said)
    const ink = (v.host.parentNode || document).querySelector('.drawbar [data-act="ink"] i');
    if (ink && !calm) ink.animate([{ transform: "scale(1)" }, { transform: "scale(1.6)" }, { transform: "scale(1)" }], { duration: 360, easing: "cubic-bezier(.2,.9,.3,1)" });
}
// Fill: the area pressed (as far as the color there goes, of what the screen shows), painted in the color, onto the
// drawing being drawn on. Kept as a picture of what it filled, so it lands the same when saved.
export function fillAt(v, at)
{
    const W = v.canvas.width, H = v.canvas.height, sx = Math.round(at.x * v.dpr), sy = Math.round(at.y * v.dpr);
    if (sx < 0 || sy < 0 || sx >= W || sy >= H) return;
    const px = v.snapshot().getContext("2d").getImageData(0, 0, W, H).data, at0 = (sy * W + sx) * 4;   // (as it shows, the drawing on the graphics chip too)
    const r0 = px[at0], g0 = px[at0 + 1], b0 = px[at0 + 2], tol = 48;
    const like = i => Math.abs(px[i] - r0) + Math.abs(px[i + 1] - g0) + Math.abs(px[i + 2] - b0) <= tol;
    // (each pixel put on the stack once at most: marked as it is, so the stack is never more than the view's pixels)
    const inside = new Uint8Array(W * H), queued = new Uint8Array(W * H), todo = new Int32Array(W * H);
    let top = 0, x0 = sx, y0 = sy, x1 = sx, y1 = sy;
    const push = i => { if (!queued[i]) { queued[i] = 1; todo[top++] = i; } };
    push(sy * W + sx);
    while (top)
    {
        const i = todo[--top];
        if (!like(i * 4)) continue;
        inside[i] = 1;
        const x = i % W, y = (i / W) | 0;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (y > 0) push(i - W); if (y < H - 1) push(i + W);
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
    if (!drawTarget(true)) { toast("No drawing to select on: pick one in Hierarchy"); return null; }
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
export let selecting = null;   // a selection being drawn: { pts, box }
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
export function selectionWith(doing)
{
    if (!pen) return;
    for (const x of doing)
    {
        if (x.t === "unstroke") { const k = project.view.sketches.find(o => o.id === x.id), st = k && k.strokes.find(o => o.sid === x.sid); if (st && st.kind === "move") paintSel = { pts: st.pts.slice() }; }
        if (x.t === "stroke" && x.stroke.kind === "move") paintSel = { pts: x.stroke.pts.map((q, i) => q + (i % 2 ? x.stroke.dy : x.stroke.dx)) };
    }
}
// The selection's outline over the canvas, marching black and white so it shows on any paint.
export function drawSelection(v, ctx)
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
