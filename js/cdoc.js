// Canopy documents (.cdoc) and style libraries, as Canopy Board writes them (its Core/DocFile.cs, Kit's StyleLibrary).
// A .cdoc is plain JSON: its master pages and pages, each with its frames from the page's top left, every frame keeping
// the lines a .cnpy would have for it ("canopy"); its pictures are files beside it (photos/), its drawings folders of
// tiles (drawings/<id>/). Read here into the same project a .cnpy makes, to be looked at: opened to read only. A
// project's linked library (a copy of it in the .cnpy, else its .clib beside) gives tables their styles and documents
// the master pages they share.

import * as cnpy from "./cnpy.js";

// "a/b/c.cdoc" and "../d/e" as "a/d/e".
function beside(path, rel)
{
    const parts = path.split("/").slice(0, -1);
    for (const p of rel.replace(/\\/g, "/").split("/")) { if (p === "..") parts.pop(); else if (p && p !== ".") parts.push(p); }
    return parts.join("/");
}

const sheetLine = (s, at, size, master) =>
{
    const flags = master ? "A" : "G", margins = Array.isArray(s.margins) && s.margins.length === 4 ? s.margins.join(",") : "";
    const pages = master ? (s.basedOn ? "based=" + encodeURIComponent(s.basedOn) : "") : (s.master ? "master=" + encodeURIComponent(s.master) : "");
    return "board " + s.id + "|" + at.x + "|" + at.y + "|" + size.w + "|" + size.h + "|" + cnpy.escape(s.name || (master ? "Master Page" : "Page")) + "|" + flags + "|" + margins + "|" + pages;
};

// A frame's lines, moved from its page's top left onto the canvas, its words as the plain field has them.
function frameLines(f, dx, dy)
{
    const lines = String(f.canopy || "").split("\n");
    if (lines.length < 2) return null;
    lines[1] = cnpy.movedLine(lines[1], dx, dy);
    if (typeof f.text === "string" && lines[1].startsWith("type "))   // (a script changed the words: the plain field wins)
    {
        const p = lines[1].split("|");
        if (p.length > 17 && cnpy.unescape(p[17]) !== f.text) { p[17] = cnpy.escape(f.text); lines[1] = p.join("|"); }
    }
    return lines;
}
const pictureOf = f => { const l = String(f.canopy || "").split("\n")[1] || ""; return l.startsWith("image ") ? l.substring(6).split("|")[0] : null; };
function base64(s) { const b = atob(s), out = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i); return out; }

// A document opened: "path" its place, "bytes" the file, "fetch" a file's bytes by its path (null if it can't be had),
// "list" a folder's files by its path.
export async function openDocument(path, bytes, fetch, list)
{
    let doc;
    try { doc = JSON.parse(new TextDecoder().decode(bytes).replace(/^﻿/, "")); } catch (e) { throw new Error("This document couldn't be read."); }
    if (!doc || doc.format !== "canopy.document") throw new Error("This isn't a Canopy document.");
    if (doc.version > 1) throw new Error("This document was saved by a newer version of Canopy Board.");
    const size = { w: (doc.page && doc.page.size && doc.page.size[0]) || 612, h: (doc.page && doc.page.size && doc.page.size[1]) || 792 }, down = size.h + 128;
    const zip = new JSZip(), text = ["CanopyBoard 7"], wanted = [];
    const head = doc.canopy && typeof doc.canopy.head === "string" ? doc.canopy.head : "";
    text.push(...head.split("\n").filter(Boolean));
    if (doc.fields) for (const k of Object.keys(doc.fields)) text.push("field " + cnpy.escape(k) + "|" + cnpy.escape(String(doc.fields[k])));
    const place = (s, master, n) => { const at = s.canopy && Array.isArray(s.canopy.at) ? { x: s.canopy.at[0], y: s.canopy.at[1] } : { x: master ? -size.w - 384 : 0, y: n * down }; return at; };
    const sheets = [];
    (doc.masters || []).forEach((s, n) => sheets.push({ s, master: true, at: place(s, true, n) }));
    (doc.pages || []).forEach((s, n) => sheets.push({ s, master: false, at: place(s, false, n) }));
    for (const sh of sheets) text.push(sheetLine(sh.s, sh.at, size, sh.master));
    const frames = sheets.flatMap(sh => (sh.s.frames || []).map(f => ({ f, at: sh.at }))).concat((doc.pasteboard || []).map(f => ({ f, at: { x: 0, y: 0 } })));
    for (const { f, at } of frames)
    {
        const lines = frameLines(f, at.x, at.y);
        if (!lines) continue;
        text.push(...lines);
        if (typeof f.file === "string") wanted.push(f);
    }
    // Its pictures and drawings, from beside it (a frame's own copy where it keeps one).
    await Promise.all(wanted.map(async f =>
    {
        try
        {
            if (f.file.endsWith("/"))
            {
                const tiles = await list(beside(path, f.file));
                await Promise.all(tiles.map(async t => { const b = await fetch(t.path); if (b) zip.file(f.file.substring("drawings/".length) + t.name, b); }));
                return;
            }
            const name = pictureOf(f) || f.file.split("/").pop();
            const b = typeof f.data === "string" && /\.(ai|pdf)$/i.test(f.file) ? base64(f.data) : await fetch(beside(path, f.file)) || (typeof f.data === "string" ? base64(f.data) : null);
            if (b) zip.file(name, b);
        }
        catch (e) { }
    }));
    zip.file("layers.txt", text.join("\n") + "\n");
    const made = await cnpy.open(await zip.generateAsync({ type: "uint8array" }));
    made.readOnly = true;
    made.document = true;
    made.pageSize = size;
    if (doc.styles && typeof doc.styles === "object") useLibrary(made, doc.styles);
    else if (typeof doc.library === "string") { const b = await fetch(beside(path, doc.library)); if (b) try { useLibrary(made, JSON.parse(new TextDecoder().decode(b))); } catch (e) { } }
    return made;
}

// A project's linked library: the copy the .cnpy keeps (library.clib), else its file beside it.
export async function linkLibrary(doc, path, fetch)
{
    if (!doc.library && !doc.zip.file("library.clib")) return;
    try
    {
        let b = doc.zip.file("library.clib") ? await doc.zip.file("library.clib").async("uint8array") : null;
        if (!b && doc.library && !/^[A-Za-z]:|^\//.test(doc.library) && fetch) b = await fetch(beside(path, doc.library));
        if (b) useLibrary(doc, JSON.parse(new TextDecoder().decode(b).replace(/^﻿/, "")));
    }
    catch (e) { }
}

// A library's styles (for tables) and master pages (each a board of the page size at 0, 0, with its art).
function useLibrary(doc, lib)
{
    doc.styles = lib;
    const masters = Array.isArray(lib.masters) ? lib.masters : [];
    if (!masters.length) return;
    const page = doc.boards.find(b => b.page) || doc.boards.find(b => b.master);
    const size = doc.pageSize || (page ? { w: page.w, h: page.h } : { w: 612, h: 792 });
    doc.libraryMasters = new Map();
    for (const m of masters)
    {
        if (!m || !m.id || doc.boards.some(b => b.id === m.id)) continue;
        const text = ["CanopyBoard 7"];
        for (const f of m.frames || [])
        {
            const lines = frameLines(f, 0, 0);
            if (!lines) continue;
            text.push(...lines);
            const pic = pictureOf(f);
            if (pic && typeof f.data === "string" && !doc.zip.file(pic)) doc.zip.file(pic, base64(f.data));   // (its pictures among the project's)
        }
        const art = cnpy.parse(text.join("\n"));
        doc.libraryMasters.set(m.id, { board: { id: m.id, x: 0, y: 0, w: size.w, h: size.h, name: m.name || "Master Page", master: true, basedOn: m.basedOn || null }, items: art.items });
    }
}
