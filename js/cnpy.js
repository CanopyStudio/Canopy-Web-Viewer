// A Canopy Board project (.cnpy): a zip holding layers.txt, which describes every object a line or more each, and the
// pictures. Read here whole, to be drawn; changed only where the phone changes things: a list's entries and name, and
// lists and photos added (new lines at the end, new pictures in the zip). Every other line and file is written back
// exactly as it was read, so the desktop app merges the change in as one person's edit.

const ROWS_SINCE = 3;   // the layers.txt version from which entries have their own ids (older files open to read only)
const SEP = "\u001f";   // between the names of the groups an object is in

// Board's escaping of a field: backslash, new line and the bar that separates fields.
export function escape(s) { return (s || "").replace(/\\/g, "\\\\").replace(/\r/g, "").replace(/\n/g, "\\n").replace(/\|/g, "\\p"); }
export function unescape(s)
{
    let out = "";
    for (let i = 0; i < s.length; i++)
    {
        if (s[i] === "\\" && i + 1 < s.length) { i++; out += s[i] === "n" ? "\n" : s[i] === "p" ? "|" : s[i]; }
        else out += s[i];
    }
    return out;
}

// A new id, as the desktop app makes them: twelve hex digits.
export function newId()
{
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

const num = s => { const v = parseFloat(s); return isFinite(v) ? v : 0; };
const col = s => !s || s === "-" ? null : s;   // "#RRGGBB" or "#AARRGGBB", or none

// One entry: a task (T, with a check box), one with its check box hidden (N), a heading (H) or a divider (D).
function readRow(rest)
{
    const f = rest.split("|");
    return { id: f[0], kind: f[1][0], done: f[2] === "1", color: col(f[3]), text: unescape(f[4] || ""), link: f.length > 5 && f[5] !== "" ? f[5] : null };
}
function rowLine(r) { return "row " + r.id + "|" + r.kind + "|" + (r.done ? 1 : 0) + "|" + (r.color || "-") + "|" + escape(r.text) + (r.link ? "|" + r.link : ""); }

// An object's "meta" line: what every kind has (where it sits in groups, its flags, opacity, blend, turn, stroke style, slant).
function readMeta(rest)
{
    const m = rest.split("|");
    const style = m[9] || "rr";
    return {
        id: m[0], group: m[1] === "-" ? null : m[1], groupName: unescape(m[3] || ""), author: unescape(m[4] || ""),
        hidden: (m[5] || "").includes("H"), flipX: (m[5] || "").includes("X"), flipY: (m[5] || "").includes("Y"), clip: (m[5] || "").includes("M"),
        opacity: m.length > 6 ? num(m[6]) : 1, blend: m[7] || "normal", angle: num(m[8]), shear: num(m[10]),
        cap: "brs".indexOf(style[0]), join: "mrb".indexOf(style[1]),
        dash: (style.slice(2).split(/[@^~]/)[0] || null), arrowhead: style.includes("^"),
        head: style.includes("@") ? num(style.split("@")[1]) || 1 : 1,
        place: style.includes("~i") ? -1 : style.includes("~o") ? 1 : 0
    };
}

// The object a body line describes (its meta given), or null for lines that aren't one.
function readBody(key, rest, meta, ver)
{
    const f = rest.split("|");
    const o = { ...(meta || readMeta("x|-")) };
    if (key === "image" || key === "item")
    {
        Object.assign(o, { kind: "image", file: f[0], x: num(f[1]), y: num(f[2]), w: num(f[3]), h: num(f[4]), cx: num(f[5]), cy: num(f[6]), cw: num(f[7]), ch: num(f[8]), name: unescape(f[9] || "Image") });
    }
    else if (key === "list")
    {
        Object.assign(o, { kind: "list", x: num(f[0]), y: num(f[1]), w: num(f[2]) || 340, scale: num(f[3]) || 1, ink: col(f[4]), showDone: f[5] === "1", name: unescape(f[6] || ""), fill: f.length > 7 ? col(f[7]) : null, rows: [] });
    }
    else if (key === "type")
    {
        Object.assign(o, {
            kind: "type", x: num(f[0]), y: num(f[1]), w: num(f[2]), h: num(f[3]), size: num(f[4]) || 48, leading: num(f[5]), tracking: num(f[6]),
            fill: col(f[7]), stroke: col(f[8]), width: num(f[9]), font: unescape(f[10] || ""), weight: parseInt(f[11], 10) || 400, italic: f[12] === "1",
            align: parseInt(f[13], 10) || 0, textCase: parseInt(f[14], 10) || 0, fixed: f[15] === "1", name: unescape(f[16] || ""), text: unescape(f[17] || ""),
            tall: f[18] === "1", hscale: f.length > 22 ? num(f[22]) || 1 : 1
        });
    }
    else if (key === "shape")
    {
        const k = f[0];
        if (k === "R" || k === "O")
            Object.assign(o, { kind: k === "R" ? "rect" : "oval", x: num(f[1]), y: num(f[2]), w: num(f[3]), h: num(f[4]), scale: num(f[5]) || 1, corners: (f[8] || "0").split(",").map(num), name: unescape(f[9] || ""), fill: col(f[10]), stroke: col(f[11]), width: num(f[12]) });
        else
            Object.assign(o, { kind: k === "A" ? "arrow" : "line", ax: num(f[1]), ay: num(f[2]), bx: num(f[3]), by: num(f[4]), scale: num(f[5]) || 1, name: unescape(f[9] || ""), fill: col(f[10]), stroke: col(f[11]), width: num(f[12]) });
        if (f.length <= 12)
        {
            // (saved before shapes had a fill and an outline of their own: one colour, for one or the other)
            const ink = col(f[6]), filled = f[7] === "1" && (o.kind === "rect" || o.kind === "oval");
            o.fill = filled ? ink : null; o.stroke = filled ? null : ink; o.width = 3 * (o.scale || 1);
            if (f.length > 9) o.name = unescape(f[9]);
        }
        if (o.kind === "line" || o.kind === "arrow") { o.x = Math.min(o.ax, o.bx); o.y = Math.min(o.ay, o.by); o.w = Math.abs(o.bx - o.ax); o.h = Math.abs(o.by - o.ay); }
    }
    else if (key === "path")
    {
        const p = rest.split("|");
        const d = ver >= 7 ? p.slice(13).join("|") : p.slice(12).join("|");
        Object.assign(o, { kind: "path", x: num(p[0]), y: num(p[1]), w: num(p[2]), h: num(p[3]), bx: num(p[4]), by: num(p[5]), bw: num(p[6]), bh: num(p[7]), fill: col(p[8]), stroke: col(p[9]), width: num(p[10]), name: unescape(p[11] || ""), d });
        if (!isFinite(o.x) || o.w <= 0) { o.x = o.bx; o.y = o.by; o.w = o.bw; o.h = o.bh; }
    }
    else if (key === "paint")
    {
        Object.assign(o, { kind: "paint", file: f[0], x: num(f[1]), y: num(f[2]), w: num(f[3]), h: num(f[4]), pw: num(f[5]), ph: num(f[6]), name: unescape(f[7] || ""), frame: f.length > 11 ? { x: num(f[8]), y: num(f[9]), w: num(f[10]), h: num(f[11]) } : null });
    }
    else return null;
    return o;
}

// The project's text read: every object in drawing order (the lists with where their lines are), the boards, which
// groups are layers, hidden or faded, the canvas colour, and the version.
export function parse(text)
{
    const lines = text.split("\n");
    const items = [], lists = [], boards = [];
    const doc = { lines, items, lists, boards, palette: [], folders: new Set(), hides: new Set(), fades: new Map(), canvas: "#161717", boardColor: null, boardLook: 0, version: ROWS_SINCE };
    let meta = null, metaAt = -1, list = null, last = null;
    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i].replace(/\r$/, "");
        const sp = line.indexOf(" ");
        const key = sp < 0 ? line : line.substring(0, sp), rest = sp < 0 ? "" : line.substring(sp + 1);
        if (key === "row" && list) { list.rows.push(readRow(rest)); list.end = i + 1; continue; }
        if (last && (key === "grad" || key === "runs" || key === "fx"))
        {
            last[key] = rest;
            if (list && list.rows.length === 0) list.end = i + 1;   // (its own extra lines come before its entries)
            last.lastLine = i;
            continue;
        }
        list = null; last = null;
        if (key === "CanopyBoard" || key === "CanopyCreator") { const v = parseInt(rest, 10); if (v > doc.version) doc.version = v; }
        else if (key === "canvas") doc.canvas = rest.trim();
        else if (key === "palette") doc.palette = rest.split(" ").filter(c => /^#[0-9A-Fa-f]{6,8}$/.test(c));
        else if (key === "boards") { const f = rest.split(" "); doc.boardColor = col(f[0]); doc.boardLook = parseInt(f[1], 10) || 0; }
        else if (key === "folders") rest.split(" ").filter(Boolean).forEach(x => doc.folders.add(x));
        else if (key === "hides") rest.split(" ").filter(Boolean).forEach(x => doc.hides.add(x));
        else if (key === "fades") rest.split(" ").filter(Boolean).forEach(x => { const kv = x.split("="); if (kv.length === 2) doc.fades.set(kv[0], num(kv[1])); });
        else if (key === "board")
        {
            const f = rest.split("|");
            boards.push({ id: f[0], x: num(f[1]), y: num(f[2]), w: num(f[3]), h: num(f[4]), name: unescape(f[5] || "Board") });
        }
        else if (key === "meta") { meta = readMeta(rest); metaAt = i; continue; }
        else
        {
            const o = readBody(key, rest, meta, doc.version);
            if (o)
            {
                if (!meta) o.id = "line" + i;
                o.line = i; o.lastLine = i; o.metaLine = meta ? metaAt : -1;
                items.push(o);
                last = o;
                if (o.kind === "list") { list = o; o.end = i + 1; lists.push(o); }
            }
        }
        meta = null;
    }
    for (const l of lists) l.start = l.end - l.rows.length;
    doc.readOnly = doc.version < ROWS_SINCE;
    return doc;
}

// The layer an object is in (its outermost group, when that is one), with its name.
export function layerOf(doc, o) { if (!o.group) return null; const id = o.group.split("/")[0]; return doc.folders.has(id) ? { id, name: o.groupName.split(SEP)[0] } : null; }

// The layer new things go into: the one the topmost object is in.
export function topLayer(doc)
{
    for (let i = doc.items.length - 1; i >= 0; i--) { const l = layerOf(doc, doc.items[i]); if (l) return l; }
    return null;
}

// ---- writing ----

function metaLine(id, layer, author) { return "meta " + id + "|" + (layer ? layer.id : "-") + "|0|" + (layer ? escape(layer.name) : "") + "|" + escape(author || "") + "||1|normal|0|rr"; }
const n = v => String(Math.round(v * 1000) / 1000);

// The project's text with the lists' entries and names as "view" has them, and what was added after the rest.
export function write(doc, view)
{
    const lines = doc.lines.slice();
    const byId = new Map(view.lists.map(l => [l.id, l]));
    for (const was of doc.lists.slice().sort((a, b) => b.start - a.start))   // from the end, so earlier places stay put
    {
        if (view.deleted.has(was.id)) { const from = was.metaLine >= 0 ? was.metaLine : was.line; lines.splice(from, was.end - from); continue; }   // (its lines, all of them)
        const now = byId.get(was.id);
        if (!now) continue;
        lines.splice(was.start, was.end - was.start, ...now.rows.map(rowLine));
        if (now.name !== was.name || now.ink !== was.ink || now.fill !== was.fill || now.showDone !== was.showDone)
        {
            // Its own line, only its name, colours or showing what's done changed.
            const f = lines[was.line].substring(5).split("|");
            while (f.length < 7) f.push("");
            f[4] = now.ink || "-"; f[5] = now.showDone ? "1" : "0"; f[6] = escape(now.name);
            if (now.fill) f[7] = now.fill; else f.length = 7;
            lines[was.line] = "list " + f.join("|");
        }
    }
    // Added here: new lists and photos, on top of everything (the end of the file).
    let tail = lines.length;
    while (tail > 0 && lines[tail - 1].trim() === "") tail--;
    const added = [];
    for (const l of view.lists.filter(o => o.fresh))
        added.push(metaLine(l.id, l.layer, l.author), "list " + [n(l.x), n(l.y), n(l.w), 1, l.ink || "#DAFF00", l.showDone ? 1 : 0, escape(l.name)].concat(l.fill ? [l.fill] : []).join("|"), ...l.rows.map(rowLine));
    for (const p of view.photos)
        added.push(metaLine(p.id, p.layer, p.author), "image " + [p.file, n(p.x), n(p.y), n(p.w), n(p.h), 0, 0, p.pw, p.ph, escape(p.name)].join("|"));
    lines.splice(tail, 0, ...added);
    return lines.join("\n");
}

// The project file opened: its zip and its layers.txt read.
export async function open(bytes)
{
    const zip = await JSZip.loadAsync(bytes);
    const main = zip.file("layers.txt");
    if (!main) throw new Error("This isn't a Canopy Board project, or it was saved by a very old version.");
    let text = await main.async("string");
    const bom = text.charCodeAt(0) === 0xFEFF;
    if (bom) text = text.substring(1);
    const doc = parse(text);
    doc.zip = zip;
    doc.bom = bom;
    return doc;
}

// The project file again, as "view" has it ("pictures": the added photos' files, by name); every other file untouched.
export async function save(doc, view, pictures)
{
    const text = write(doc, view);
    doc.zip.file("layers.txt", (doc.bom ? "﻿" : "") + text, { compression: "DEFLATE" });
    for (const p of view.photos) if (!doc.zip.file(p.file) && pictures.has(p.file)) doc.zip.file(p.file, pictures.get(p.file), { compression: "STORE" });
    return await doc.zip.generateAsync({ type: "uint8array" });
}

// ---- changes ----

// What has been done here, kept as steps so they can be done again on top of a newer copy of the file (someone saved
// in the meantime): their project as it now is, ours on top. The lists (with new ones), and the photos added.
export function apply(doc, steps)
{
    const lists = doc.lists.map(l => ({ ...l, rows: l.rows.map(r => ({ ...r })) }));
    const photos = [], deleted = new Set();
    const ids = new Set(doc.items.map(o => o.id));   // (already in the file: a save that went through, its answer lost)
    // Where an entry goes: after the one named, at the top for none (null), at the end if that one has gone.
    const place = (rows, after) => { if (after === null) return 0; const k = rows.findIndex(r => r.id === after); return k < 0 ? rows.length : k + 1; };
    for (const s of steps)
    {
        if (s.t === "newlist") { if (!ids.has(s.list)) lists.push({ id: s.list, kind: "list", fresh: true, x: s.x, y: s.y, w: 340, scale: 1, ink: "#DAFF00", fill: null, showDone: true, name: s.name, rows: [], layer: s.layer, author: s.author, group: s.layer ? s.layer.id : null, groupName: s.layer ? s.layer.name : "" }); continue; }
        if (s.t === "photo") { if (!ids.has(s.id)) photos.push({ ...s.photo, id: s.id }); continue; }
        const l = lists.find(o => o.id === s.list);
        if (!l) continue;
        if (s.t === "name") { l.name = s.name; continue; }
        if (s.t === "listset") { Object.assign(l, s.fields); continue; }
        if (s.t === "dellist") { lists.splice(lists.indexOf(l), 1); if (!l.fresh) deleted.add(l.id); continue; }
        const at = s.id ? l.rows.findIndex(r => r.id === s.id) : -1;
        if (s.t === "set" && at >= 0) Object.assign(l.rows[at], s.fields);
        else if (s.t === "add" && !l.rows.some(r => r.id === s.row.id)) l.rows.splice(place(l.rows, s.after), 0, { ...s.row });
        else if (s.t === "del" && at >= 0) l.rows.splice(at, 1);
        else if (s.t === "move" && at >= 0) { const [r] = l.rows.splice(at, 1); l.rows.splice(place(l.rows, s.after), 0, r); }
    }
    return { lists, photos, deleted };
}

// An entry's words with the marks the desktop app reads (**bold**, *italic*) as safe HTML.
export function rich(text)
{
    const safe = (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return safe
        .replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, "<b>$1</b>")
        .replace(/\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*/g, "<i>$1</i>")
        .replace(/\n/g, "<br>");
}
// And as plain words (the marks taken out).
export function plain(text) { return (text || "").replace(/\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/g, "$1").replace(/\*(?=[^\s*])([^*]+?)(?<=[^\s*])\*/g, "$1"); }
