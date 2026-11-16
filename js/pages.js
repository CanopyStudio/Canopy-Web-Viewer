// A document's pages, as Canopy Board shows them (its Core/DocPages.cs): each page board drawn over its master page's
// art (and the art of the masters that one is based on, the first underneath), with {page}, {pages} and the document's
// fields ({product}...) filled in its type. A master is a master page board on the canvas, or one from the linked
// library (doc.libraryMasters, read with the library: files.js). A master's slot, a layer named {name}, isn't drawn.

import { placed } from "./cnpy.js";
import { overs, fillFields } from "./formulas.js";

const slot = o => o.kind !== "type" && o.kind !== "table" && /^\{[A-Za-z][\w -]*\}$/.test((o.name || "").trim());
const middleIn = (o, b) => { const x = o.x + o.w / 2, y = o.y + o.h / 2; return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h; };

let madeFor = null, made = [];
export function furniture(doc, items, boards)
{
    const pages = boards.filter(b => b.page);
    if (!pages.some(p => p.masterId)) return [];
    const own = new Map(boards.filter(b => b.master).map(b => [b.id, b]));
    const lib = doc.libraryMasters || new Map();
    const master = id => own.get(id) || (lib.has(id) ? lib.get(id).board : null);
    const art = m => own.has(m.id) ? items.filter(o => middleIn(o, m)) : lib.has(m.id) ? lib.get(m.id).items : [];
    const chain = p => { const all = []; for (let m = master(p.masterId); m && !all.includes(m); m = master(m.basedOn)) all.unshift(m); return all; };
    // (made again only when the pages, their masters' art or the fields change)
    const key = pages.map(p => p.id + p.x + "," + p.y + p.masterId).join(";") + "|" + [...own.values(), ...[...lib.values()].map(l => l.board)].map(m => m.id + m.x + "," + m.y + m.basedOn + art(m).map(o => o.id + o.x + "," + o.y + o.w + o.h + (o.text || "") + o.hidden).join()).join(";") + "|" + [...doc.fields].join();
    if (key === madeFor) return made;
    madeFor = key;
    made = [];
    pages.forEach((p, i) =>
    {
        for (const m of chain(p))
            for (const o of art(m))
            {
                if (o.hidden || slot(o) || o.kind === "list") continue;
                const q = { ...placed(o, { k: 1, ox: p.x - m.x, oy: p.y - m.y }), id: o.id + "@" + p.id, group: null, groupName: "", clip: false };
                if (o.kind === "table") { q.grid = o.grid; }
                if (o.kind === "type" && (o.text || "").indexOf("{") >= 0)
                {
                    const r = fillFields(o.text || "", overs(o.runs, (o.text || "").length), i + 1, pages.length, doc.fields);
                    q.text = r.text; q._per = r.per; q.runs = null;
                }
                made.push(q);
            }
    });
    return made;
}
