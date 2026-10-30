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
        hidden: (m[5] || "").includes("H"), locked: (m[5] || "").includes("L"), flipX: (m[5] || "").includes("X"), flipY: (m[5] || "").includes("Y"), clip: (m[5] || "").includes("M"),
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
        // (every list the one size, as the desktop app now has them: its size as saved kept, to be put right as it's saved)
        Object.assign(o, { kind: "list", x: num(f[0]), y: num(f[1]), w: LIST_W, scale: 1, savedW: num(f[2]), savedScale: num(f[3]) || 1, ink: col(f[4]), showDone: f[5] === "1", name: unescape(f[6] || ""), fill: f.length > 7 ? col(f[7]) : null, rows: [] });
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
            // (saved before shapes had a fill and an outline of their own: one color, for one or the other)
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
        Object.assign(o, { kind: "path", x: num(p[0]), y: num(p[1]), w: num(p[2]), h: num(p[3]), bx: num(p[4]), by: num(p[5]), bw: num(p[6]), bh: num(p[7]), fill: col(p[8]), stroke: col(p[9]), width: num(p[10]), name: unescape(p[11] || ""), d, dynamic: ver >= 7 && p[12] && p[12] !== "-" ? p[12] : null });
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
// groups are layers, hidden or faded, the canvas color, and the version.
export function parse(text)
{
    const lines = text.split("\n");
    const items = [], lists = [], boards = [];
    const doc = { lines, items, lists, boards, palette: [], empties: [], boardsLine: -1, lastBoardLine: -1, listOrder: [], listOrderLine: -1, folders: new Set(), hides: new Set(), locks: new Set(), fades: new Map(), canvas: "#161717", boardColor: null, boardLook: 0, version: ROWS_SINCE };
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
        else if (key === "boards") { doc.boardsLine = i; const f = rest.split(" "); doc.boardColor = col(f[0]); doc.boardLook = parseInt(f[1], 10) || 0; }
        else if (key === "folders") rest.split(" ").filter(Boolean).forEach(x => doc.folders.add(x));
        else if (key === "hides") rest.split(" ").filter(Boolean).forEach(x => doc.hides.add(x));
        else if (key === "listorder") { doc.listOrderLine = i; doc.listOrder = rest.split(" ").filter(Boolean); }   // (the order the lists are shown in here)
        else if (key === "locks") { doc.locksLine = i; rest.split(" ").filter(Boolean).forEach(x => doc.locks.add(x)); }
        else if (key === "empty") { const f = rest.split(" "); if (f.length >= 2) doc.empties.push({ id: f[0], name: f.slice(2).join(" ") || "Layer" }); }
        else if (key === "fades") rest.split(" ").filter(Boolean).forEach(x => { const kv = x.split("="); if (kv.length === 2) doc.fades.set(kv[0], num(kv[1])); });
        else if (key === "board")
        {
            const f = rest.split("|");
            boards.push({ id: f[0], x: num(f[1]), y: num(f[2]), w: num(f[3]), h: num(f[4]), name: unescape(f[5] || "Board"), line: i });
            doc.lastBoardLine = i;
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

// The layer new things go into: the one the topmost object is in (or, with none in any, the first empty one).
export function topLayer(doc)
{
    for (let i = doc.items.length - 1; i >= 0; i--) { const l = layerOf(doc, doc.items[i]); if (l) return l; }
    return doc.empties.length ? { id: doc.empties[0].id, name: doc.empties[0].name } : null;
}
// Whether an object can't be moved: locked itself, or in a locked group or layer ("view": as the steps leave them).
export function locked(doc, o, view)
{
    const own = view && view.locks.has(o.id) ? view.locks.get(o.id) : !!o.locked;
    return own || lockers(doc, o, view).length > 0;
}
// The groups and layers it is in that are locked themselves.
export function lockers(doc, o, view) { return !o.group || doc.locks.size === 0 ? [] : o.group.split("/").filter(id => doc.locks.has(id) && !(view && view.unlocked.has(id))); }

// ---- moving and sizing: p' = p * k + (ox, oy), as a step leaves an object ----

// An object moved so (a copy, for drawing).
// A list's width: every list is this wide, at its own scale (1), growing only downward as it fills.
export const LIST_W = 384;
export function placed(o, t)
{
    const q = { ...o }, X = v => v * t.k + t.ox, Y = v => v * t.k + t.oy;
    delete q._path; delete q._layout;
    if (o.kind === "line" || o.kind === "arrow") { q.ax = X(o.ax); q.ay = Y(o.ay); q.bx = X(o.bx); q.by = Y(o.by); }
    q.x = X(o.x); q.y = Y(o.y);
    if (o.kind === "list") return q;   // (a list is moved, never sized)
    q.w = o.w * t.k; q.h = o.h * t.k;
    if (o.kind === "type") { q.size = o.size * t.k; if (o.leading > 0) q.leading = o.leading * t.k; }
    return q;
}
// Its body line, moved so (only the numbers that place it changed).
function placedLine(line, o, t)
{
    const sp = line.indexOf(" "), key = line.substring(0, sp), f = line.substring(sp + 1).split("|");
    const X = v => n(num(v) * t.k + t.ox), Y = v => n(num(v) * t.k + t.oy), K = v => n(num(v) * t.k);
    const at = key === "image" || key === "item" || key === "paint" || key === "shape" ? 1 : 0;
    f[at] = X(f[at]); f[at + 1] = Y(f[at + 1]);
    if (key === "list") return key + " " + f.join("|");   // (moved only)
    if (key === "shape" && (f[0] === "L" || f[0] === "A")) { f[3] = X(f[3]); f[4] = Y(f[4]); }
    else { f[at + 2] = K(f[at + 2]); f[at + 3] = K(f[at + 3]); }
    if (key === "type") { f[4] = K(f[4]); if (num(f[5]) > 0) f[5] = K(f[5]); }
    return key + " " + f.join("|");
}
export function compose(t, s)   // t then s
{
    return { k: t.k * s.k, ox: t.ox * s.k + s.ox, oy: t.oy * s.k + s.oy };
}

// ---- writing ----

function metaLine(id, layer, author, lock) { return "meta " + id + "|" + (layer ? layer.id : "-") + "|0|" + (layer ? escape(layer.name) : "") + "|" + escape(author || "") + "|" + (lock ? "L" : "") + "|1|normal|0|rr"; }
const n = v => String(Math.round(v * 1000) / 1000);

// The project's text as "view" has it: the lists' entries, names and colors; objects moved, sized or deleted; boards
// added (after the others); and lists and photos added (after everything, on top).
export function write(doc, view)
{
    const lines = doc.lines.slice();
    const byId = new Map(view.lists.map(l => [l.id, l]));
    const cuts = [];   // lines taken out or put in: { from, to, put }, done last, from the end, so earlier places stay put
    for (const o of doc.items)
    {
        if (view.removed.has(o.id) || view.deleted.has(o.id)) { cuts.push({ from: o.metaLine >= 0 ? o.metaLine : o.line, to: o.kind === "list" ? o.end : o.lastLine + 1, put: [] }); continue; }   // (its lines, all of them)
        if (view.locks.has(o.id) && o.metaLine >= 0 && view.locks.get(o.id) !== !!o.locked)
        {
            // Locked or unlocked here: its flags, "L" put in or taken out.
            const m = lines[o.metaLine].substring(5).split("|");
            while (m.length < 6) m.push("");
            m[5] = view.locks.get(o.id) ? m[5] + "L" : m[5].replace(/L/g, "");
            lines[o.metaLine] = "meta " + m.join("|");
        }
        if (o.kind !== "list") { const t = view.moved.get(o.id); if (t) lines[o.line] = placedLine(lines[o.line], o, t); continue; }
        const now = byId.get(o.id);
        if (!now) continue;
        cuts.push({ from: o.start, to: o.end, put: now.rows.map(rowLine) });
        if (now.name !== o.name || now.ink !== o.ink || now.fill !== o.fill || now.showDone !== o.showDone || now.x !== o.x || now.y !== o.y || o.savedW !== LIST_W || o.savedScale !== 1)
        {
            // Its own line: its place, size, name, colors and showing what's done as they are now.
            const f = lines[o.line].substring(5).split("|");
            while (f.length < 7) f.push("");
            f[0] = n(now.x); f[1] = n(now.y); f[2] = n(now.w); f[3] = n(now.scale || 1);
            f[4] = now.ink || "-"; f[5] = now.showDone ? "1" : "0"; f[6] = escape(now.name);
            if (now.fill) f[7] = now.fill; else f.length = 7;
            lines[o.line] = "list " + f.join("|");
        }
    }
    if (view.unlocked.size || view.relocked.size)
    {
        // Groups and layers unlocked here (out of the "locks" line), or locked again (back in it); the line gone when
        // none are left, and made when there was none.
        const left = [...new Set([...doc.locks].filter(id => !view.unlocked.has(id)).concat([...view.relocked]))].sort();
        if (doc.locksLine >= 0) cuts.push({ from: doc.locksLine, to: doc.locksLine + 1, put: left.length ? ["locks " + left.join(" ")] : [] });
        else if (left.length) { const at = doc.boardsLine >= 0 ? doc.boardsLine : 1; cuts.push({ from: at, to: at, put: ["locks " + left.join(" ")] }); }
    }
    for (const b of doc.boards) if (view.goneBoards.has(b.id)) cuts.push({ from: b.line, to: b.line + 1, put: [] });
    if (view.order)
    {
        // The lists' order, set here: its line made anew (or made, before the boards' line).
        const line = view.order.length ? ["listorder " + view.order.join(" ")] : [];
        if (doc.listOrderLine >= 0) cuts.push({ from: doc.listOrderLine, to: doc.listOrderLine + 1, put: line });
        else if (line.length) { const at = doc.boardsLine >= 0 ? doc.boardsLine : 1; cuts.push({ from: at, to: at, put: line }); }
    }
    if (view.boards.length)
    {
        const at = doc.lastBoardLine >= 0 ? doc.lastBoardLine + 1 : doc.boardsLine >= 0 ? doc.boardsLine + 1 : 1;
        cuts.push({ from: at, to: at, put: view.boards.map(b => "board " + b.id + "|" + [n(b.x), n(b.y), n(b.w), n(b.h), escape(b.name)].join("|")) });
    }
    cuts.sort((a, b) => (b.from - a.from) || (b.to - a.to));
    for (const c of cuts) lines.splice(c.from, c.to - c.from, ...c.put);
    // Added here: new lists and photos, on top of everything (the end of the file).
    let tail = lines.length;
    while (tail > 0 && lines[tail - 1].trim() === "") tail--;
    const added = [];
    for (const l of view.lists.filter(o => o.fresh))
        added.push(metaLine(l.id, l.layer, l.author, l.locked), "list " + [n(l.x), n(l.y), n(l.w), n(l.scale || 1), l.ink || "#DAFF00", l.showDone ? 1 : 0, escape(l.name)].concat(l.fill ? [l.fill] : []).join("|"), ...l.rows.map(rowLine));
    for (const p of view.photos)
        added.push(metaLine(p.id, p.layer, p.author, p.locked), "image " + [p.file, n(p.x), n(p.y), n(p.w), n(p.h), 0, 0, p.pw, p.ph, escape(p.name)].join("|"));
    for (const r of view.restored) added.push(...(r.by ? r.lines.map((l, i) => i === r.body ? placedLine(l, r.item, r.by) : l) : r.lines));   // (deleted, saved, and then brought back)
    lines.splice(tail, 0, ...added);
    return lines.join("\n");
}

// A new, empty project, as the desktop app starts one: its colors, grid and one empty layer to put things in.
export function blank()
{
    const layer = newId();
    return ["CanopyBoard 7", "blend #EF5EB8 #DAFF00 50", "palette", "count 6", "canvas #161717", "grid 64 4", "boards - 0", "folders " + layer, "empty " + layer + " - Layer 1", ""].join("\n");
}
export async function blankFile()
{
    const zip = new JSZip();
    zip.file("layers.txt", blank(), { compression: "DEFLATE" });
    return await zip.generateAsync({ type: "uint8array" });
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
    doc.zip.file("layers.txt", (doc.bom ? "\uFEFF" : "") + text, { compression: "DEFLATE" });
    for (const p of view.photos) if (!doc.zip.file(p.file) && pictures.has(p.file)) doc.zip.file(p.file, pictures.get(p.file), { compression: "STORE" });
    for (const r of view.restored) if (r.item.kind === "image" && !doc.zip.file(r.item.file) && pictures.has(r.item.file)) doc.zip.file(r.item.file, pictures.get(r.item.file), { compression: "STORE" });   // (pasted from another project)
    return await doc.zip.generateAsync({ type: "uint8array" });
}

// ---- changes ----

// What has been done here, kept as steps so they can be done again on top of a newer copy of the file (someone saved
// in the meantime): their project as it now is, ours on top. The lists (with new ones), and the photos added.
export function apply(doc, steps)
{
    const lists = doc.lists.map(l => ({ ...l, rows: l.rows.map(r => ({ ...r })) }));
    const photos = [], deleted = new Set(), removed = new Set(), moved = new Map(), boards = [], locks = new Map(), unlocked = new Set();
    const relocked = new Set(), goneBoards = new Set(), restored = [];
    let order = null;   // the lists' order, once set here
    const items = new Map(doc.items.map(o => [o.id, o]));
    const ids = new Set(doc.items.map(o => o.id));   // (already in the file: a save that went through, its answer lost)
    // Where an entry goes: after the one named, at the top for none (null), at the end if that one has gone.
    const place = (rows, after) => { if (after === null) return 0; const k = rows.findIndex(r => r.id === after); return k < 0 ? rows.length : k + 1; };
    for (const s of steps)
    {
        if (s.t === "place" || s.t === "delobj")
        {
            // Objects moved and sized (a shift, then a scale about a point), or deleted: whichever kind, wherever made.
            for (const id of s.ids)
            {
                const l = lists.find(o => o.id === id), p = photos.find(o => o.id === id), r = restored.find(o => o.id === id);
                if (s.t === "delobj") { if (l) { lists.splice(lists.indexOf(l), 1); if (!l.fresh) deleted.add(id); } else if (p) photos.splice(photos.indexOf(p), 1); else if (r) restored.splice(restored.indexOf(r), 1); else if (items.has(id)) removed.add(id); continue; }
                if (l) Object.assign(l, placed(l, s.by));
                else if (r) r.by = r.by ? compose(r.by, s.by) : s.by;
                else if (p) { const q = placed({ ...p, kind: "image" }, s.by); Object.assign(p, { x: q.x, y: q.y, w: q.w, h: q.h }); }
                else if (items.has(id)) moved.set(id, moved.has(id) ? compose(moved.get(id), s.by) : s.by);
            }
            continue;
        }
        if (s.t === "lock")
        {
            for (const id of s.ids) { const l = lists.find(o => o.id === id && o.fresh), p = photos.find(o => o.id === id); if (l) l.locked = s.on; else if (p) p.locked = s.on; else locks.set(id, s.on); }
            for (const g of s.groups || []) { unlocked.add(g); relocked.delete(g); }
            for (const g of s.relock || []) { if (unlocked.has(g)) unlocked.delete(g); else relocked.add(g); }
            continue;
        }
        if (s.t === "order") { order = s.ids.slice(); continue; }
        if (s.t === "newboard") { if (goneBoards.has(s.board.id)) goneBoards.delete(s.board.id); else if (!doc.boards.some(b => b.id === s.board.id) && !boards.some(b => b.id === s.board.id)) boards.push({ ...s.board }); continue; }
        if (s.t === "delboard") { const k = boards.findIndex(b => b.id === s.id); if (k >= 0) boards.splice(k, 1); else if (doc.boards.some(b => b.id === s.id)) goneBoards.add(s.id); continue; }
        if (s.t === "restore")
        {
            // Deleted objects brought back (as they were when deleted): taken off what was deleted, or, gone from the
            // file since, added again.
            for (const th of s.things)
            {
                const id = th.id;
                if (lists.some(o => o.id === id) || photos.some(o => o.id === id) || restored.some(o => o.id === id)) continue;
                if (removed.has(id)) removed.delete(id);
                else if (th.list && deleted.has(id)) { deleted.delete(id); lists.push({ ...th.list, rows: th.list.rows.map(r => ({ ...r })), fresh: false }); }
                else if (ids.has(id)) continue;
                else if (th.list) lists.push({ ...th.list, rows: th.list.rows.map(r => ({ ...r })), fresh: true });
                else if (th.photo) photos.push({ ...th.photo });
                else if (th.lines) { const one = parse(["CanopyBoard " + doc.version].concat(th.lines).join("\n")).items[0]; if (one) restored.push({ id, lines: th.lines, body: one.line - 1, item: { ...one, id }, by: null }); }
            }
            continue;
        }
        if (s.t === "newlist") { if (!ids.has(s.list)) lists.push({ id: s.list, kind: "list", fresh: true, x: s.x, y: s.y, w: LIST_W, scale: 1, ink: "#DAFF00", fill: null, showDone: true, name: s.name, rows: [], layer: s.layer, author: s.author, group: s.layer ? s.layer.id : null, groupName: s.layer ? s.layer.name : "" }); continue; }
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
    return { lists, photos, deleted, removed, moved, boards, locks, unlocked, relocked, goneBoards, restored, order };
}

// ---- undoing: what a step would be undone by, worked out from the project as it is before the step ----

// An object as it is now, kept to be brought back if it is deleted (a list or photo as it is; the file's own lines for
// anything else, moved as it has been).
function keep(doc, view, id)
{
    const l = view.lists.find(o => o.id === id);
    if (l) return { id, list: { ...l, rows: l.rows.map(r => ({ ...r })) } };
    const p = view.photos.find(o => o.id === id);
    if (p) return { id, photo: { ...p } };
    const r = view.restored.find(o => o.id === id);
    if (r) return { id, lines: r.by ? r.lines.map((x, i) => i === r.body ? placedLine(x, r.item, r.by) : x) : r.lines.slice() };
    const o = doc.items.find(x => x.id === id);
    if (!o) return null;
    const from = o.metaLine >= 0 ? o.metaLine : o.line, lines = doc.lines.slice(from, o.lastLine + 1);
    const t = view.moved.get(id);
    if (t) lines[o.line - from] = placedLine(lines[o.line - from], o, t);
    return { id, lines };
}
// ---- copied and pasted: objects as "keep" has them (to be brought back by a "restore" step, so undone alike) ----

export function copyOut(doc, view, ids) { return ids.map(id => keep(doc, view, id)).filter(Boolean); }
// The picture or drawing a copied object's pixels are in (a picture's file, a drawing's folder), or null.
export function fileOf(th)
{
    if (th.photo) return { file: th.photo.file, kind: "image" };
    const body = th.lines ? th.lines.find(l => l.startsWith("image ") || l.startsWith("paint ")) : null;
    return body ? { file: body.substring(body.indexOf(" ") + 1).split("|")[0], kind: body.startsWith("image ") ? "image" : "paint" } : null;
}
// The copies made new, to go into "doc": each its own id, and new groups for the groups they were in (alike for all of
// them, so a group copied stays one group); moved by "by"; kept in their layer where "doc" (the file pasted into) has
// it, else put in "layer" (or in none, with no layers there); "from" is the file they were copied from. None locked.
export function copyIn(things, from, doc, by, layer)
{
    const fresh = new Map(), anew = id => { if (!fresh.has(id)) fresh.set(id, newId()); return fresh.get(id); };
    const isLayer = (d, id) => d.folders.has(id) || d.empties.some(e => e.id === id);
    const regroup = (group, groupName) =>
    {
        let ids = group ? group.split("/") : [], names = (groupName || "").split(SEP).slice(0, ids.length);
        while (names.length < ids.length) names.push("");
        let lay = null;
        if (ids.length && isLayer(from, ids[0])) { if (isLayer(doc, ids[0])) lay = { id: ids[0], name: names[0] }; ids = ids.slice(1); names = names.slice(1); }
        lay = lay || layer;
        ids = ids.map(anew);
        if (lay) { ids.unshift(lay.id); names.unshift(lay.name); }
        return { group: ids.length ? ids.join("/") : null, groupName: names.join(SEP), layer: lay };
    };
    return things.map(th =>
    {
        const id = newId();
        if (th.list)
        {
            // (a new list is written in the group its "layer" names: here, the whole of where it goes)
            const l = th.list, g = regroup(l.group, l.groupName), at = g.group ? { id: g.group, name: g.groupName } : null;
            return { id, list: { ...l, id, x: l.x * by.k + by.ox, y: l.y * by.k + by.oy, rows: l.rows.map(r => ({ ...r, id: newId() })), layer: at, group: g.group, groupName: g.groupName, locked: false, fresh: true } };
        }
        if (th.photo)
        {
            const p = th.photo, lay = regroup(p.layer ? p.layer.id : null, p.layer ? p.layer.name : "").layer;
            return { id, photo: { ...p, id, x: p.x * by.k + by.ox, y: p.y * by.k + by.oy, w: p.w * by.k, h: p.h * by.k, layer: lay, locked: false } };
        }
        const one = parse(["CanopyBoard " + doc.version].concat(th.lines).join("\n")).items[0];
        if (!one || !th.lines[0].startsWith("meta ")) return null;
        const lines = th.lines.slice(), body = one.line - 1, m = lines[0].substring(5).split("|"), g = regroup(one.group, one.groupName);
        m[0] = id; m[1] = g.group || "-"; m[3] = escape(g.groupName); m[5] = (m[5] || "").replace("L", "");
        lines[0] = "meta " + m.join("|");
        lines[body] = placedLine(lines[body], one, by);
        return { id, lines };
    }).filter(Boolean);
}

// The steps that undo "s" (in order), or none.
export function inverse(doc, view, s)
{
    const list = s.list, l = list ? view.lists.find(o => o.id === list) : null;
    const old = (from, fields) => Object.fromEntries(Object.keys(fields).map(k => [k, from[k] === undefined ? null : from[k]]));
    switch (s.t)
    {
        case "set": { const r = l && l.rows.find(o => o.id === s.id); return r ? [{ t: "set", list, id: s.id, fields: old(r, s.fields) }] : []; }
        case "add": return [{ t: "del", list, id: s.row.id }];
        case "del": { const k = l ? l.rows.findIndex(o => o.id === s.id) : -1; return k < 0 ? [] : [{ t: "add", list, row: { ...l.rows[k] }, after: k > 0 ? l.rows[k - 1].id : null }]; }
        case "move": { const k = l ? l.rows.findIndex(o => o.id === s.id) : -1; return k < 0 ? [] : [{ t: "move", list, id: s.id, after: k > 0 ? l.rows[k - 1].id : null }]; }
        case "name": return l ? [{ t: "name", list, name: l.name }] : [];
        case "listset": return l ? [{ t: "listset", list, fields: old(l, s.fields) }] : [];
        case "newlist": return [{ t: "delobj", list: null, ids: [s.list] }];
        case "dellist": { const th = keep(doc, view, list); return th ? [{ t: "restore", list: null, things: [th] }] : []; }
        case "photo": return [{ t: "delobj", list: null, ids: [s.id] }];
        case "delobj": { const things = s.ids.map(id => keep(doc, view, id)).filter(Boolean); return things.length ? [{ t: "restore", list: null, things }] : []; }
        case "restore": return [{ t: "delobj", list: null, ids: s.things.map(th => th.id) }];
        case "place": return [{ t: "place", list: null, ids: s.ids, by: { k: 1 / s.by.k, ox: -s.by.ox / s.by.k, oy: -s.by.oy / s.by.k } }];
        case "newboard": return [{ t: "delboard", list: null, id: s.board.id }];
        case "order": return [{ t: "order", list: null, ids: (view.order || doc.listOrder).slice() }];
        case "delboard": { const b = doc.boards.concat(view.boards).find(o => o.id === s.id); return b ? [{ t: "newboard", list: null, board: { id: b.id, x: b.x, y: b.y, w: b.w, h: b.h, name: b.name } }] : []; }
        case "lock":
        {
            // Each back as it was (locked or not), and the groups unlocked with it locked again (or the other way).
            const was = id => { const a = view.lists.find(o => o.id === id && o.fresh) || view.photos.find(o => o.id === id); if (a) return !!a.locked; if (view.locks.has(id)) return view.locks.get(id); const o = doc.items.find(x => x.id === id); return !!(o && o.locked); };
            const on = s.ids.filter(was), off = s.ids.filter(id => !was(id)), out = [];
            if (on.length) out.push({ t: "lock", list: null, ids: on, on: true });
            if (off.length) out.push({ t: "lock", list: null, ids: off, on: false });
            if (!out.length) out.push({ t: "lock", list: null, ids: [], on: false });
            out[0].relock = s.groups || []; out[0].groups = s.relock || [];
            return out;
        }
    }
    return [];
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
