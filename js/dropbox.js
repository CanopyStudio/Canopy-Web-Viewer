// Dropbox: signing in (the app's key only, no secret: the code sent back is proved with a one-time key made here), and
// the few calls the app makes: list a folder, read a file, and write one back only over the version it was read as.

const AUTH = "https://www.dropbox.com/oauth2/authorize", TOKEN = "https://api.dropboxapi.com/oauth2/token";
const API = "https://api.dropboxapi.com/2/", CONTENT = "https://content.dropboxapi.com/2/";
const KEPT = "canopy.dropbox";   // the sign-in, kept on this phone

function key() { return (window.CANOPY && window.CANOPY.dropboxAppKey) || ""; }
function back() { return location.origin + location.pathname; }   // where Dropbox sends the sign-in back (the app's address, as set in the App Console)
export function ready() { return key() !== ""; }

function kept() { try { return JSON.parse(localStorage.getItem(KEPT) || "null"); } catch (e) { return null; } }
function keep(v) { try { if (v) localStorage.setItem(KEPT, JSON.stringify(v)); else localStorage.removeItem(KEPT); } catch (e) { } }
export function signedIn() { return !!(kept() && kept().refresh); }
export function signOut() { keep(null); }

function base64url(bytes) { return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

// Off to Dropbox to sign in; it comes back to the app's address with a code (Finish).
export async function signIn()
{
    const v = new Uint8Array(48);
    crypto.getRandomValues(v);
    const verifier = base64url(v);
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    sessionStorage.setItem("canopy.verifier", verifier);
    const q = new URLSearchParams({ client_id: key(), response_type: "code", code_challenge: challenge, code_challenge_method: "S256", redirect_uri: back(), token_access_type: "offline" });
    location.href = AUTH + "?" + q;
}

// Back from Dropbox with a code: swapped for the sign-in kept here. Whether it was a sign-in coming back.
export async function finish()
{
    const q = new URLSearchParams(location.search);
    if (!q.has("code") && !q.has("error")) return false;
    history.replaceState(null, "", back());
    if (q.has("error")) throw new Error(q.get("error_description") || "Dropbox sign-in was canceled.");
    const verifier = sessionStorage.getItem("canopy.verifier");
    sessionStorage.removeItem("canopy.verifier");
    const got = await tokenCall({ code: q.get("code"), grant_type: "authorization_code", code_verifier: verifier, client_id: key(), redirect_uri: back() });
    keep({ refresh: got.refresh_token, access: got.access_token, until: Date.now() + (got.expires_in - 60) * 1000 });
    await findRoot();
    return true;
}

async function tokenCall(fields)
{
    const r = await fetch(TOKEN, { method: "POST", body: new URLSearchParams(fields) });
    if (!r.ok) throw new Error("Dropbox sign-in failed (" + r.status + ").");
    return await r.json();
}

// A current access token: the kept one, or a fresh one from the long-lived sign-in.
async function access()
{
    const k = kept();
    if (!k || !k.refresh) throw new SignedOut();
    if (k.access && Date.now() < k.until) return k.access;
    let got;
    try { got = await tokenCall({ grant_type: "refresh_token", refresh_token: k.refresh, client_id: key() }); }
    catch (e) { if (navigator.onLine) { keep(null); throw new SignedOut(); } throw e; }
    k.access = got.access_token;
    k.until = Date.now() + (got.expires_in - 60) * 1000;
    keep(k);
    return k.access;
}
export class SignedOut extends Error { constructor() { super("Signed out of Dropbox."); } }
export class Conflict extends Error { constructor() { super("The file changed since it was read."); } }

// A team's Dropbox: its shared folders sit above the person's own, so calls are made from the team's top.
async function findRoot()
{
    const me = await rpc("users/get_current_account", null);
    const k = kept();
    k.root = me.root_info && me.root_info.root_namespace_id !== me.root_info.home_namespace_id ? me.root_info.root_namespace_id : null;
    k.name = me.name ? me.name.display_name : "";
    keep(k);
}
export function who() { const k = kept(); return k ? k.name || "" : ""; }

// The headers every call carries. A header can only hold plain ASCII, so other letters in a path are written as \u codes.
async function headers(extra)
{
    const h = { Authorization: "Bearer " + await access(), ...extra };
    const k = kept();
    if (k && k.root) h["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: k.root });
    return h;
}
function arg(o) { return JSON.stringify(o).replace(/[\u007f-￿]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")); }

async function rpc(name, body)
{
    const r = await fetch(API + name, { method: "POST", headers: await headers(body === null ? {} : { "Content-Type": "application/json" }), body: body === null ? null : JSON.stringify(body) });
    if (r.status === 401) { keep(null); throw new SignedOut(); }
    if (!r.ok) throw new Error("Dropbox: " + (await r.text()).slice(0, 200));
    return await r.json();
}

// Pictures Dropbox can show a preview of (made by Dropbox, so even a phone's HEIC photos show).
export const PICTURE = /\.(jpe?g|png|gif|webp|heic|heif|tiff?|bmp)$/i;
// A folder's folders, .cnpy files and pictures ("" is the top), folders first, each by name.
export async function list(path)
{
    let page = await rpc("files/list_folder", { path, include_non_downloadable_files: false });
    const all = page.entries.slice();
    while (page.has_more) { page = await rpc("files/list_folder/continue", { cursor: page.cursor }); all.push(...page.entries); }
    return all
        .filter(e => e[".tag"] === "folder" || /\.cnpy$/i.test(e.name) || PICTURE.test(e.name))
        .map(e => ({ folder: e[".tag"] === "folder", picture: e[".tag"] !== "folder" && PICTURE.test(e.name), name: e.name, path: e.path_display, modified: e.server_modified }))
        .sort((a, b) => (b.folder - a.folder) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// Small previews of pictures, as Dropbox makes them (25 at a time): path → a data URL, for those it could make.
export async function thumbnails(paths, size)
{
    const out = new Map();
    for (let i = 0; i < paths.length; i += 25)
    {
        const r = await fetch(CONTENT + "files/get_thumbnail_batch", { method: "POST", headers: await headers({ "Content-Type": "application/json" }),
            body: JSON.stringify({ entries: paths.slice(i, i + 25).map(path => ({ path, format: "jpeg", size: size || "w256h256", mode: "fitone_bestfit" })) }) });
        if (r.status === 401) { keep(null); throw new SignedOut(); }
        if (!r.ok) continue;
        for (const e of (await r.json()).entries) if (e[".tag"] === "success") out.set(e.metadata.path_display, "data:image/jpeg;base64," + e.thumbnail);
    }
    return out;
}
// A picture big enough to look at (or put on a canvas), as Dropbox makes it: a JPEG at most 2048 across.
export async function preview(path)
{
    const r = await fetch(CONTENT + "files/get_thumbnail_v2", { method: "POST", headers: await headers({ "Dropbox-API-Arg": arg({ resource: { ".tag": "path", path }, format: "jpeg", size: "w2048h1536", mode: "fitone_bestfit" }) }) });
    if (r.status === 401) { keep(null); throw new SignedOut(); }
    if (!r.ok) throw new Error("Couldn't show that picture (" + r.status + ").");
    return await r.blob();
}

// A file's bytes and which version they are.
export async function read(path)
{
    const r = await fetch(CONTENT + "files/download", { method: "POST", headers: await headers({ "Dropbox-API-Arg": arg({ path }) }) });
    if (r.status === 401) { keep(null); throw new SignedOut(); }
    if (!r.ok) throw new Error(r.status === 409 ? "That file isn't there any more." : "Couldn't open it from Dropbox (" + r.status + ").");
    const meta = JSON.parse(r.headers.get("Dropbox-API-Result"));
    return { bytes: new Uint8Array(await r.arrayBuffer()), rev: meta.rev };
}

// Which version a file is now (to tell whether someone has saved it since).
export async function version(path) { return (await rpc("files/get_metadata", { path })).rev; }

// A file written back, only over the version "rev" (Conflict if it has changed since). Its new version.
export async function write(path, bytes, rev)
{
    const r = await fetch(CONTENT + "files/upload", {
        method: "POST",
        headers: await headers({ "Content-Type": "application/octet-stream", "Dropbox-API-Arg": arg({ path, mode: { ".tag": "update", update: rev }, autorename: false, mute: true, strict_conflict: true }) }),
        body: bytes
    });
    if (r.status === 401) { keep(null); throw new SignedOut(); }
    if (r.status === 409) { const t = await r.text(); if (t.includes("conflict")) throw new Conflict(); throw new Error("Dropbox: " + t.slice(0, 200)); }
    if (!r.ok) throw new Error("Couldn't save to Dropbox (" + r.status + ").");
    return (await r.json()).rev;
}

// A new file, only if there is none of that name there already.
export async function create(path, bytes)
{
    const r = await fetch(CONTENT + "files/upload", {
        method: "POST",
        headers: await headers({ "Content-Type": "application/octet-stream", "Dropbox-API-Arg": arg({ path, mode: "add", autorename: false, mute: true }) }),
        body: bytes
    });
    if (r.status === 401) { keep(null); throw new SignedOut(); }
    if (r.status === 409) throw new Error("There's already a project called " + path.split("/").pop().replace(/\.cnpy$/i, "") + " in this folder.");
    if (!r.ok) throw new Error("Couldn't create the project in Dropbox (" + r.status + ").");
    return (await r.json()).rev;
}
