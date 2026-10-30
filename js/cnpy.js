// A Canopy Board project (.cnpy): a zip holding layers.txt, which describes every object a line or more each, and the
// pictures. Only the entries of lists (their "row" lines) are ever changed here: every other line and every other file
// is written back exactly as it was read, so the desktop app merges the change in as one person's edit to a list.

const ROWS_SINCE = 3;   // the layers.txt version from which entries have their own ids (older files open to read only)

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

// A new entry's id, as the desktop app makes them: twelve hex digits.
export function newId()
{
    const b = new Uint8Array(6);
    crypto.getRandomValues(b);
    return Array.from(b, x => x.toString(16).padStart(2, "0")).join("");
}

// One entry: a task (T, with a check box), one with its check box hidden (N), a heading (H) or a divider (D).
function readRow(rest)
{
    const f = rest.split("|");
    return { id: f[0], kind: f[1][0], done: f[2] === "1", color: f[3] === "-" ? null : f[3], text: unescape(f[4] || ""), link: f.length > 5 && f[5] !== "" ? f[5] : null };
}
function rowLine(r) { return "row " + r.id + "|" + r.kind + "|" + (r.done ? 1 : 0) + "|" + (r.color || "-") + "|" + escape(r.text) + (r.link ? "|" + r.link : ""); }

// The project's text read into its lists (with where their entries' lines are), its canvas colour and its version.
export function parse(text)
{
    const lines = text.split("\n");
    const lists = [];
    let version = ROWS_SINCE, meta = null, list = null;
    for (let i = 0; i < lines.length; i++)
    {
        const line = lines[i].replace(/\r$/, "");
        const sp = line.indexOf(" ");
        const key = sp < 0 ? line : line.substring(0, sp), rest = sp < 0 ? "" : line.substring(sp + 1);
        if (key === "CanopyBoard" || key === "CanopyCreator") { const v = parseInt(rest, 10); if (v > version) version = v; continue; }
        if (key === "row" && list) { list.rows.push(readRow(rest)); list.end = i + 1; continue; }
        if (list && (key === "grad" || key === "runs" || key === "fx")) { if (list.rows.length === 0) list.end = i + 1; continue; }   // its own extra lines, before its entries
        list = null;
        if (key === "meta") { meta = rest.split("|"); continue; }
        if (key === "list")
        {
            const f = rest.split("|");
            const layer = meta && meta[1] !== "-" ? unescape(meta[3] || "").split("\u001f")[0] : "";
            list = {
                id: meta ? meta[0] : "list" + i,
                x: parseFloat(f[0]), y: parseFloat(f[1]),
                ink: f[4] === "-" ? null : f[4],
                showDone: f[5] === "1",
                name: unescape(f[6] || ""),
                fill: f.length > 7 && f[7] !== "-" ? f[7] : null,
                layer,
                rows: [],
                end: i + 1   // where its entries' lines end (just after its own line, until it has some)
            };
            lists.push(list);
        }
        meta = null;
    }
    for (const l of lists) l.start = l.end - l.rows.length;
    return { lines, lists, version, readOnly: version < ROWS_SINCE };
}

// The project's text with each list's entries as "lists" now has them (by list id; lists left out are as they were).
export function write(doc, lists)
{
    const lines = doc.lines.slice();
    const byId = new Map(lists.map(l => [l.id, l]));
    for (const was of doc.lists.slice().sort((a, b) => b.start - a.start))   // from the end, so earlier places stay put
    {
        const now = byId.get(was.id);
        if (!now) continue;
        lines.splice(was.start, was.end - was.start, ...now.rows.map(rowLine));
    }
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

// The project file again, its lists' entries as "lists" has them; every other file in it untouched.
export async function save(doc, lists)
{
    const text = write(doc, lists);
    doc.zip.file("layers.txt", (doc.bom ? "﻿" : "") + text, { compression: "DEFLATE" });
    return await doc.zip.generateAsync({ type: "uint8array" });
}

// ---- changes ----

// What has been done to the lists here, kept as steps so they can be done again on top of a newer copy of the file
// (someone saved in the meantime): their entries as they now are, ours on top.
export function apply(lists, steps)
{
    const out = lists.map(l => ({ ...l, rows: l.rows.map(r => ({ ...r })) }));
    // Where an entry goes: after the one named, at the top for none (null), at the end if that one has gone.
    const place = (rows, after) => { if (after === null) return 0; const k = rows.findIndex(r => r.id === after); return k < 0 ? rows.length : k + 1; };
    for (const s of steps)
    {
        const l = out.find(o => o.id === s.list);
        if (!l) continue;
        const at = s.id ? l.rows.findIndex(r => r.id === s.id) : -1;
        if (s.t === "set" && at >= 0) Object.assign(l.rows[at], s.fields);
        else if (s.t === "add" && !l.rows.some(r => r.id === s.row.id)) l.rows.splice(place(l.rows, s.after), 0, { ...s.row });
        else if (s.t === "del" && at >= 0) l.rows.splice(at, 1);
        else if (s.t === "move" && at >= 0) { const [r] = l.rows.splice(at, 1); l.rows.splice(place(l.rows, s.after), 0, r); }
    }
    return out;
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
