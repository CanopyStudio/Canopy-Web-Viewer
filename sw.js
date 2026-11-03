// The viewer's own files kept on the phone, so it opens with no connection: each fetched afresh while there is one
// (and the copy kept made new), the kept copy used when there isn't (or the connection is too slow to wait for).
// Dropbox's calls aren't the viewer's own, and go by as they are.

const CACHE = "canopy-web-viewer";
const FILES = ["./", "index.html", "app.css", "config.js", "manifest.webmanifest", "vendor/jszip.min.js",
    "js/app.js", "js/files.js", "js/lists.js", "js/drawing.js", "js/hierarchy.js", "js/saving.js", "js/cnpy.js", "js/render.js", "js/viewer.js", "js/gl.js", "js/offline.js", "js/dropbox.js", "js/icons.js", "js/look.js", "js/tone.js", "js/version.js",
    "icons/icon-180.png", "icons/icon-192.png", "icons/favicon.png",
    "fonts/IBMPlexSans-Regular.ttf", "fonts/IBMPlexSans-Medium.ttf", "fonts/IBMPlexSans-SemiBold.ttf"];

self.addEventListener("install", e =>
{
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(new Request(f, { cache: "reload" })).catch(() => { })))));
});
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e =>
{
    const req = e.request, url = new URL(req.url);
    if (req.method !== "GET" || url.origin !== self.location.origin) return;
    e.respondWith((async () =>
    {
        const c = await caches.open(CACHE);
        // (kept by its plain name: one asked for with a query, as the version check is, not kept again each time)
        const fresh = fetch(req).then(r => { if (r.ok && !url.search) c.put(req, r.clone()).catch(() => { }); return r; });
        fresh.catch(() => { });   // (no connection: answered from what is kept, below)
        const kept = await c.match(req, { ignoreSearch: true });
        if (!kept) return fresh;
        // (a slow connection: the kept copy after a few seconds, the fresh one still kept for next time)
        const late = new Promise(ok => setTimeout(() => ok(kept), 4000));
        try { return await Promise.race([fresh, late]); } catch (x) { return kept; }
    })());
});
