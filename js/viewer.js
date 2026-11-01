// A canvas to look around: one finger drags it, two pinch it, a double tap zooms in (or back out to fit), a tap
// says where on the canvas it was. Drawn by render.js, only when something changes.

import * as render from "./render.js";

export class Viewer
{
    // "host": the element it fills; "scene": () => what to draw; "get": pictures; "onTap": (x, y) on the canvas.
    constructor(host, scene, get, onTap)
    {
        this.host = host; this.scene = scene; this.get = get; this.onTap = onTap;
        this.canvas = document.createElement("canvas");
        this.canvas.className = "viewer";
        host.appendChild(this.canvas);
        this.ctx = this.canvas.getContext("2d");
        this.cam = { s: 1, tx: 0, ty: 0 };
        this.pointers = new Map();
        this.lastTap = 0;
        this.queued = false;
        this.movingUntil = 0;
        this.resize = () => this.fitCanvas();
        new ResizeObserver(this.resize).observe(host);
        this.fitCanvas();
        const c = this.canvas;
        c.addEventListener("pointerdown", e => this.down(e));
        c.addEventListener("pointermove", e => this.move(e));
        c.addEventListener("pointerup", e => this.up(e));
        c.addEventListener("pointercancel", e => this.up(e));
        c.addEventListener("wheel", e => this.wheel(e), { passive: false });
    }

    fitCanvas()
    {
        const dpr = Math.min(3, window.devicePixelRatio || 1);   // (its size as laid out, not as an opening animation shows it)
        this.w = Math.max(1, this.host.clientWidth); this.h = Math.max(1, this.host.clientHeight); this.dpr = dpr;
        this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
        this.canvas.style.width = this.w + "px"; this.canvas.style.height = this.h + "px";
        if (this.pending) { const a = this.pending; this.pending = null; this.fit(a, 0, false); }
        this.redraw();
    }

    moving() { this.movingUntil = performance.now() + 140; }
    redraw()
    {
        if (this.queued) return;
        this.queued = true;
        requestAnimationFrame(() =>
        {
            this.queued = false;
            const sc = this.scene();
            if (!sc || !this.canvas.isConnected) return;   // (gone since it was asked for)
            // (moving: pictures scaled quickly; drawn well again once it stops)
            const fast = performance.now() < this.movingUntil;
            const t0 = performance.now();
            render.draw(this.ctx, sc, this.cam, this.w, this.h, this.dpr, this.get, () => this.redraw(), { fast });
            render.stats.draws.push({ at: t0, ms: performance.now() - t0 }); if (render.stats.draws.length > 60) render.stats.draws.shift();
            clearTimeout(this.sharpen);
            if (fast) this.sharpen = setTimeout(() => this.redraw(), 160);
            if (this.overlay) { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); this.ctx.globalAlpha = 1; this.ctx.globalCompositeOperation = "source-over"; this.overlay(this.ctx); }   // (what is picked, over it all)
        });
    }

    // An area of the canvas filling the view (with "pad" of the view around it), eased there when "glide".
    fit(area, pad, glide)
    {
        if (this.w < 2) { this.pending = area; return; }
        pad = pad === undefined ? 0.06 : pad;
        const s = Math.min(this.w * (1 - pad * 2) / Math.max(1, area.w), this.h * (1 - pad * 2) / Math.max(1, area.h));
        const to = { s, tx: this.w / 2 - (area.x + area.w / 2) * s, ty: this.h / 2 - (area.y + area.h / 2) * s };
        glide ? this.glide(to) : (this.cam = to, this.redraw());
    }
    glide(to)
    {
        const from = { ...this.cam }, t0 = performance.now(), d = matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 320;
        const step = now =>
        {
            const u = Math.min(1, (now - t0) / d), k = 1 - Math.pow(1 - u, 3);
            // (zoomed by its log, so the scale changes evenly)
            const s = Math.exp(Math.log(from.s) + (Math.log(to.s) - Math.log(from.s)) * k);
            const fx = (this.w / 2 - from.tx) / from.s, fy = (this.h / 2 - from.ty) / from.s, gx = (this.w / 2 - to.tx) / to.s, gy = (this.h / 2 - to.ty) / to.s;
            const cx = fx + (gx - fx) * k, cy = fy + (gy - fy) * k;
            this.cam = { s, tx: this.w / 2 - cx * s, ty: this.h / 2 - cy * s };
            this.moving(); this.redraw();
            if (u < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    }
    // The middle of the view on the canvas, and how much of the canvas it shows.
    middle() { return { x: (this.w / 2 - this.cam.tx) / this.cam.s, y: (this.h / 2 - this.cam.ty) / this.cam.s, w: this.w / this.cam.s, h: this.h / this.cam.s }; }
    toCanvas(x, y) { return { x: (x - this.cam.tx) / this.cam.s, y: (y - this.cam.ty) / this.cam.s }; }
    toScreen(x, y) { return { x: x * this.cam.s + this.cam.tx, y: y * this.cam.s + this.cam.ty }; }

    zoomAt(px, py, k)
    {
        const s = Math.max(0.01, Math.min(64, this.cam.s * k));
        k = s / this.cam.s;
        this.cam = { s, tx: px - (px - this.cam.tx) * k, ty: py - (py - this.cam.ty) * k };
        this.moving(); this.redraw();
    }

    at(e) { const r = this.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    down(e)
    {
        this.canvas.setPointerCapture(e.pointerId);
        this.pointers.set(e.pointerId, this.at(e));
        this.moved = 0;
        this.downAt = performance.now();
        // One finger on something picked (or a handle of it): it is dragged, not the canvas ("grab" says what to do).
        if (this.pointers.size === 1 && this.grab) this.held = this.grab(this.pointers.get(e.pointerId), e);
        if (this.pointers.size === 2) { if (this.held) { if (this.held.cancel) this.held.cancel(); else this.held.end(); this.held = null; } this.pinch = this.spread(); }   // (a stroke begun is taken back: two fingers pan)
    }
    spread()
    {
        const [a, b] = [...this.pointers.values()];
        return { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
    move(e)
    {
        if (!this.pointers.has(e.pointerId)) return;
        const was = this.pointers.get(e.pointerId), now = this.at(e);
        this.pointers.set(e.pointerId, now);
        if (this.pointers.size === 1 && this.held) { this.moved += Math.abs(now.x - was.x) + Math.abs(now.y - was.y); this.held.move(now, was, e); }
        else if (this.pointers.size === 1)
        {
            this.cam.tx += now.x - was.x; this.cam.ty += now.y - was.y;
            this.moved += Math.abs(now.x - was.x) + Math.abs(now.y - was.y);
            this.moving(); this.redraw();
        }
        else if (this.pointers.size === 2 && this.pinch)
        {
            const p = this.spread();
            this.cam.tx += p.x - this.pinch.x; this.cam.ty += p.y - this.pinch.y;
            if (this.pinch.d > 0) this.zoomAt(p.x, p.y, p.d / this.pinch.d);
            this.pinch = p;
            this.moved += 100;
        }
    }
    up(e)
    {
        if (!this.pointers.has(e.pointerId)) return;
        const p = this.pointers.get(e.pointerId);
        this.pointers.delete(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.held && this.pointers.size === 0) { const h = this.held; this.held = null; h.end(); if (this.moved > 10) return; }
        if (this.pointers.size > 0 || this.moved > 10 || performance.now() - this.downAt > 400) return;
        const now = performance.now();
        if (now - this.lastTap < 300)
        {
            // A double tap: in closer there; already close, back out to everything.
            this.lastTap = 0;
            clearTimeout(this.tapTimer);
            if (this.cam.s > 4 && this.onFitAll) return this.onFitAll();
            const s = this.cam.s * 2.2, k = s / this.cam.s;
            return this.glide({ s, tx: p.x - (p.x - this.cam.tx) * k, ty: p.y - (p.y - this.cam.ty) * k });
        }
        this.lastTap = now;
        const c = this.toCanvas(p.x, p.y);
        this.tapTimer = setTimeout(() => { if (this.onTap) this.onTap(c.x, c.y); }, 260);   // (not a double tap)
    }
    wheel(e)
    {
        e.preventDefault();
        const p = this.at(e);
        if (e.ctrlKey || e.metaKey) this.zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.01));
        else { this.cam.tx -= e.deltaX; this.cam.ty -= e.deltaY; this.moving(); this.redraw(); }
    }
}

// A board (or any area) drawn once into a small canvas, for the boards' grid.
export function thumbnail(canvas, sc, area, get, background)
{
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    const s = Math.min(w / area.w, h / area.h);
    const cam = { s, tx: (w - area.w * s) / 2 - area.x * s, ty: (h - area.h * s) / 2 - area.y * s };
    render.draw(canvas.getContext("2d"), sc, cam, w, h, dpr, get, () => { }, { names: false, background });
}
