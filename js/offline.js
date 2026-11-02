// Kept on this phone (its own storage, IndexedDB): copies of the projects chosen to be kept for when there is no
// connection (the file as it was last read or saved, and which version of it that was), and each project's changes
// not yet saved. Dropbox keeps the projects themselves; these are only copies, made again as they are saved.

const DB = "canopy-offline";
let opened = null;
function db()
{
    return opened || (opened = new Promise((ok, no) =>
    {
        const r = indexedDB.open(DB, 1);
        r.onupgradeneeded = () => { r.result.createObjectStore("projects"); r.result.createObjectStore("steps"); };
        r.onsuccess = () => { const d = r.result; d.onclose = () => { opened = null; }; d.onversionchange = () => { d.close(); opened = null; }; ok(d); };
        r.onerror = () => { opened = null; no(r.error); };
    }));
}
// One request, its answer once its transaction has finished (a write is only done once that has), or null. A phone
// can drop the connection to its storage (put away a while): opened again, and tried once more.
async function ask(storeName, how, ...args)
{
    for (let tries = 0; tries < 2; tries++)
    {
        try
        {
            const d = await db();
            return await new Promise((ok, no) =>
            {
                const t = d.transaction(storeName, how === "get" || how === "getAll" || how === "getAllKeys" ? "readonly" : "readwrite");
                const r = t.objectStore(storeName)[how](...args);
                t.oncomplete = () => ok(r.result === undefined ? null : r.result);
                t.onabort = t.onerror = () => no(t.error || r.error || new Error("not kept"));
            });
        }
        catch (e) { opened = null; if (tries === 1) throw e; }
    }
}
const quietly = async (...a) => { try { return await ask(...a); } catch (e) { return null; } };

// ---- projects kept for when there is no connection ----

// A project kept (or its copy made again): its bytes, the version they are, and when.
export async function keep(path, bytes, rev)
{
    await ask("projects", "put", { path, bytes, rev, at: Date.now() }, path);   // (not kept: said so, by its failing)
    kept.add(path);
    // (asked once: that the phone keep this page's storage, rather than clear it when it is short of room)
    try { if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch (e) { }
}
export async function copy(path) { return await quietly("projects", "get", path); }
export async function drop(path) { await quietly("projects", "delete", path); kept.delete(path); }
// The projects kept: their paths, sizes and when each copy was made.
export async function all()
{
    const list = (await quietly("projects", "getAll")) || [];
    kept = new Set(list.map(p => p.path));
    return list.map(p => ({ path: p.path, size: p.bytes ? p.bytes.byteLength : 0, at: p.at }));
}
// Whether a project is kept (known once "all" has been asked, at the start; kept up to date after).
export let kept = new Set();
export function has(path) { return kept.has(path); }

// ---- changes not yet saved ----

export async function steps(path)
{
    const got = await quietly("steps", "get", path);
    if (got) return got;
    // (kept where they were before 0.7.19: moved here)
    try
    {
        const old = localStorage.getItem("canopy.steps." + path);
        if (old) { const s = JSON.parse(old); await ask("steps", "put", s, path); localStorage.removeItem("canopy.steps." + path); return s; }
    }
    catch (e) { }
    return null;
}
// The changes not yet saved, kept (none: let go). False if they couldn't be (the phone's storage full, say).
export async function keepSteps(path, list)
{
    try { if (list && list.length) await ask("steps", "put", list, path); else await ask("steps", "delete", path); return true; }
    catch (e) { return false; }
}
// The projects with changes waiting (for the files page to say so).
export async function waiting() { return new Set((await quietly("steps", "getAllKeys")) || []); }
