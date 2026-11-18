// Sums in type, as Canopy Board works them out (its Core/Formulas.cs): {=...} in a type object shows the number worked
// out from the type objects picked into it ("@" and the picked one's id), each holding only a number ($1,350.00, 24.0,
// 15%) or a formula of its own; + - * / and brackets, SUM(a, b, ...) and PRODUCT(a, b, ...), and numbers typed in. The
// answer takes the look of what went in: a currency sign if one had it (then thousands commas and its decimals), as
// many decimals as the most precise. Also each letter's own look (a type object's runs), kept in step as words change.

const NUMBER_ONLY = /^\s*-?\s*[$€£¥]?\s*-?(\d[\d,]*(\.\d+)?|\.\d+)\s*%?\s*$/;
const FORMULA_ONLY = /^\s*\{=[^}]*\}\s*$/;
const NUMBER = /(-)?\s*([$€£¥])?\s*(-)?(\d[\d,]*(?:\.\d+)?|\.\d+)\s*(%)?/;

export function has(text) { return !!text && text.indexOf("{=") >= 0; }

// ---- each letter's own look (Board's TypeLayer.OversOf): "start,length,key=value,...;..." ----

export function overs(runs, n)
{
    const per = new Array(n).fill(null);
    if (!runs) return per;
    for (const run of runs.split(";"))
    {
        const f = run.split(",");
        const start = parseInt(f[0], 10), len = parseInt(f[1], 10);
        if (f.length < 3 || !isFinite(start) || !isFinite(len)) continue;
        const o = {};
        for (let i = 2; i < f.length; i++)
        {
            const eq = f[i].indexOf("=");
            if (eq < 1) continue;
            const k = f[i].substring(0, eq), v = f[i].substring(eq + 1);
            if (k === "f") o.font = decodeURIComponent(v);
            else if (k === "w") o.weight = parseInt(v, 10);
            else if (k === "i") o.italic = v === "1";
            else if (k === "s") o.size = parseFloat(v);
            else if (k === "t") o.tracking = parseFloat(v);
            else if (k === "d") o.deco = parseInt(v, 10);
            else if (k === "c") o.fill = v.length === 9 ? "#" + v.substring(1) : v;   // (#AARRGGBB, as the rest of the file has colors)
        }
        for (let i = Math.max(0, start); i < Math.min(n, start + len); i++) per[i] = o;
    }
    return per;
}

// ---- {page}, {pages} and the document's fields, in a master page's type (Board's DocPages.Fill) ----

export function fillFields(text, per, page, pages, fields)
{
    if (!text || text.indexOf("{") < 0) return { text, per };
    per = per.slice();
    const all = new Map([["{page}", String(page)], ["{pages}", String(pages)]]);
    for (const [k, v] of fields) if (k !== "page" && k !== "pages") all.set("{" + k + "}", v || "");
    for (const [key, value] of all)
        for (let at = text.indexOf(key); at >= 0; at = text.indexOf(key, at + value.length))
        {
            const o = at < per.length ? per[at] : null;
            text = text.substring(0, at) + value + text.substring(at + key.length);
            per.splice(at, Math.min(key.length, per.length - at), ...new Array(value.length).fill(o));
        }
    return { text, per };
}

// ---- the sums ----

// Its words with each {=...} worked out ("find": an object by its id), its letters' looks kept in step (each answer as
// the formula's first letter was).
export function shown(text, per, id, find) { return work(text, per, id, find, new Set()); }

function work(text, per, id, find, going)
{
    if (!has(text)) return { text, per };
    per = per ? per.slice() : null;
    going.add(id);
    for (let at = text.indexOf("{="); at >= 0; at = text.indexOf("{=", at))
    {
        const end = text.indexOf("}", at);
        if (end < 0) break;
        const answer = sum(text.substring(at + 2, end), find, going);
        if (per)
        {
            const o = at < per.length ? per[at] : null;
            per.splice(at, Math.min(end + 1 - at, per.length - at), ...new Array(answer.length).fill(o));
        }
        text = text.substring(0, at) + answer + text.substring(end + 1);
        at += answer.length;
    }
    going.delete(id);
    return { text, per };
}

class Wrong extends Error { }

function valueOf(o, find, going)
{
    const t = o.text || "";
    if (FORMULA_ONLY.test(t))
    {
        if (going.has(o.id)) throw new Wrong("#CYCLE!");
        const s = work(t, null, o.id, find, going).text.trim();
        if (s.startsWith("#")) throw new Wrong(s);   // (what went wrong there, passed on)
        return read(s);
    }
    if (!NUMBER_ONLY.test(t)) throw new Wrong("#VALUE!");
    return read(t);
}

function sum(formula, find, going)
{
    try
    {
        const p = new Reader(formula, id =>
        {
            const o = find(id);
            if (!o || o.kind !== "type") throw new Wrong("#REF!");
            return valueOf(o, find, going);
        });
        const v = p.sum();
        p.space();
        if (p.at < formula.length) throw new Wrong("#ERROR!");
        return show(v);
    }
    catch (e) { if (e instanceof Wrong) return e.message; throw e; }
}

function read(words)
{
    const m = NUMBER.exec(words || "");
    if (!m) return { n: 0, cur: null, dec: 0, comma: false };
    const digits = m[4], dot = digits.indexOf("."), pct = !!m[5];
    const n = parseFloat(digits.replace(/,/g, "")) * (m[1] || m[3] ? -1 : 1);
    return { n: pct ? n / 100 : n, cur: m[2] || null, dec: pct ? 0 : dot < 0 ? 0 : digits.length - dot - 1, comma: digits.indexOf(",") >= 0 };
}

// Rounded as Board rounds: a half to the even neighbor.
function roundEven(v, d)
{
    const m = Math.pow(10, d), x = v * m, r = Math.round(x);
    return (Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r) / m;
}

function show(v)
{
    if (!isFinite(v.n)) return "#ERROR!";
    const money = v.cur !== null, places = money || v.dec > 0 ? Math.min(v.dec, 6) : 2;
    const n = roundEven(v.n, places);
    let s = Math.abs(n).toFixed(places);
    if (!money && v.dec === 0) s = s.replace(/\.?0+$/, "");   // (a plain number: to two places only when it needs them)
    if (money || v.comma) { const [whole, part] = s.split("."); s = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (part !== undefined ? "." + part : ""); }
    return (n < 0 ? "-" : "") + (v.cur || "") + s;
}

const join = (a, b, n) => ({ n, cur: a.cur || b.cur, dec: Math.max(a.dec, b.dec), comma: a.comma || b.comma });

class Reader
{
    constructor(text, find) { this.text = text; this.at = 0; this.find = find; }
    space() { while (this.at < this.text.length && /\s/.test(this.text[this.at])) this.at++; }
    take(...any) { this.space(); if (this.at < this.text.length && any.includes(this.text[this.at])) { this.at++; return true; } return false; }
    sum()
    {
        let v = this.product();
        for (;;)
        {
            if (this.take("+")) { const b = this.product(); v = join(v, b, v.n + b.n); }
            else if (this.take("-", "−")) { const b = this.product(); v = join(v, b, v.n - b.n); }
            else return v;
        }
    }
    product()
    {
        let v = this.signed();
        for (;;)
        {
            if (this.take("*", "×", "x")) { const b = this.signed(); v = join(v, b, v.n * b.n); }
            else if (this.take("/", "÷")) { const b = this.signed(); if (b.n === 0) throw new Wrong("#DIV/0!"); v = join(v, b, v.n / b.n); }
            else return v;
        }
    }
    signed()
    {
        if (this.take("-", "−")) { const v = this.signed(); return { ...v, n: -v.n }; }
        this.take("+");
        return this.one();
    }
    one()
    {
        this.space();
        if (this.at >= this.text.length) throw new Wrong("#ERROR!");
        if (this.take("(")) { const v = this.sum(); if (!this.take(")")) throw new Wrong("#ERROR!"); return v; }
        const rest = this.text.substring(this.at);
        let m = /^@([0-9a-f]{12})/.exec(rest);
        if (m) { this.at += m[0].length; return this.find(m[1]); }
        m = /^[$€£¥]?(\d[\d,]*(\.\d+)?|\.\d+)%?/.exec(rest);   // a number typed in
        if (m) { this.at += m[0].length; return read(m[0]); }
        const f = /^([A-Za-z]+)\s*\(/.exec(rest);   // SUM( ... ) or PRODUCT( ... )
        if (f)
        {
            const fn = f[1].toUpperCase();
            if (fn !== "SUM" && fn !== "PRODUCT") throw new Wrong("#NAME?");
            this.at += f[0].length;
            let v = { n: fn === "SUM" ? 0 : 1, cur: null, dec: 0, comma: false };
            if (!this.take(")"))
            {
                do { const b = this.sum(); v = join(v, b, fn === "SUM" ? v.n + b.n : v.n * b.n); } while (this.take(",", ";"));
                if (!this.take(")")) throw new Wrong("#ERROR!");
            }
            return v;
        }
        throw new Wrong("#NAME?");
    }
}

