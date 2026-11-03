// Painting on the graphics chip (WebGL 2): while drawing, the drawing being drawn on is shown from a picture of it
// kept on the chip, over the rest of the canvas (drawn as ever, by render.js, on the canvas under this one), with what
// is above it laid over it (on a canvas of the page's, over this one). A stroke under way is added to a little at a time, on the chip, so it keeps up with the
// finger however much the drawing holds; a stroke finished is painted into the drawing's picture exactly as render.js
// would paint it. Its strokes are drawn as render.js draws them (Ink's pieces, the Flat's tip stamped along, the
// eraser, a fill's picture), so what shows here is what is saved. Null when the phone has no WebGL 2.

import * as render from "./render.js";

const VS_SHAPE = `#version 300 es
precision highp float;
in vec2 corner;              // 0..1 across the quad
in vec4 seg;                 // a capsule: its two ends (a stamp: its middle twice)
in vec2 rad;                 // its radius at each end (a stamp: its half width, half height)
uniform vec4 map;            // canvas units to the target's pixels: x * map.x + map.z, y * map.y + map.w
uniform vec2 size;           // the target's size in pixels
uniform float stamp;         // 1: a stamp of the Flat's tip
out vec2 at;                 // this point, in canvas units
out vec2 uv;
void main()
{
    float px = 1.5 / map.x;   // (room for the soft edge)
    vec2 lo, hi;
    if (stamp > 0.5) { lo = seg.xy - rad; hi = seg.xy + rad; }
    else { float r = max(rad.x, rad.y) + px; lo = min(seg.xy, seg.zw) - r; hi = max(seg.xy, seg.zw) + r; }
    at = mix(lo, hi, corner);
    uv = corner;
    vec2 p = vec2(at.x * map.x + map.z, at.y * map.y + map.w);
    gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0);
}`;
const FS_SHAPE = `#version 300 es
precision highp float;
in vec2 at;
in vec2 uv;
uniform vec4 map;
uniform vec4 color;          // as it is painted, its alpha 1
uniform float stamp;
uniform sampler2D tip;
flat in vec4 fseg;
flat in vec2 frad;
out vec4 frag;
void main()
{
    float a;
    if (stamp > 0.5) a = texture(tip, vec2(uv.x, 1.0 - uv.y)).a;
    else
    {
        vec2 pa = at - fseg.xy, ba = fseg.zw - fseg.xy;
        float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0);
        float r = mix(frad.x, frad.y, h);
        float d = length(pa - ba * h) - r;
        a = clamp(0.5 - d * map.x, 0.0, 1.0);
    }
    frag = vec4(color.rgb * a, a);
}`;
// (the capsule's ends handed on unchanged, for the pixel's distance from it)
const VS_SHAPE_FULL = VS_SHAPE.replace("out vec2 uv;", "out vec2 uv;\nflat out vec4 fseg;\nflat out vec2 frad;").replace("    uv = corner;", "    uv = corner;\n    fseg = seg; frad = rad;");

const VS_QUAD = `#version 300 es
precision highp float;
in vec2 corner;
uniform vec4 rect;           // where, in the target's pixels: x, y, w, h
uniform vec4 src;            // the part of the picture: u0, v0 (its top), u1, v1 (its bottom)
uniform vec2 size;
out vec2 uv;
void main()
{
    vec2 p = rect.xy + rect.zw * corner;
    uv = vec2(mix(src.x, src.z, corner.x), mix(src.y, src.w, corner.y));
    gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0);
}`;
const FS_QUAD = `#version 300 es
precision highp float;
in vec2 uv;
uniform sampler2D pic;
uniform float alpha;
out vec4 frag;
void main() { frag = texture(pic, uv) * alpha; }`;

// The view: the drawing's picture, the stroke under way (and its last piece) over it as render.js lays one on, all as
// the drawing's own opacity has it.
const VS_VIEW = `#version 300 es
precision highp float;
in vec2 corner;
void main() { gl_Position = vec4(corner * 2.0 - 1.0, 0.0, 1.0); }`;
const FS_VIEW = `#version 300 es
precision highp float;
uniform sampler2D layer, wet, tail;
uniform vec2 size;           // the view, in pixels
uniform vec4 back;           // the view's pixels to canvas units: x * back.x + back.z, y * back.y + back.w
uniform vec4 place;          // the drawing's picture: where it starts (canvas units), its pixels to a unit, and its size
uniform vec2 lsize;
uniform float wetOn, erase, op, fade;
out vec4 frag;
void main()
{
    vec2 px = vec2(gl_FragCoord.x, size.y - gl_FragCoord.y);
    vec2 c = vec2(px.x * back.x + back.z, px.y * back.y + back.w);
    vec2 l = (c - place.xy) * place.z;
    vec4 L = vec4(0.0);
    if (l.x >= 0.0 && l.y >= 0.0 && l.x <= lsize.x && l.y <= lsize.y) L = texture(layer, vec2(l.x / lsize.x, 1.0 - l.y / lsize.y));
    vec4 C = L;
    if (wetOn > 0.5)
    {
        vec2 v = vec2(px.x / size.x, 1.0 - px.y / size.y);
        vec4 S = max(texture(wet, v), texture(tail, v));
        C = erase > 0.5 ? L * (1.0 - S.a * op) : S * op + L * (1.0 - S.a * op);
    }
    frag = C * fade;
}`;

export function painter(canvas)
{
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: false });
    if (!gl) return null;
    const P = { failed: false };
    canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); P.failed = true; });
    const most = Math.min(8192, gl.getParameter(gl.MAX_TEXTURE_SIZE));

    function program(vs, fs)
    {
        const make = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
        const pr = gl.createProgram();
        gl.attachShader(pr, make(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, make(gl.FRAGMENT_SHADER, fs));
        gl.linkProgram(pr);
        if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
        const u = {};
        const n = gl.getProgramParameter(pr, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(pr, i).name; u[name] = gl.getUniformLocation(pr, name); }
        return { pr, u, a: name => gl.getAttribLocation(pr, name) };
    }
    let shape, quad, view;
    try { shape = program(VS_SHAPE_FULL, FS_SHAPE); quad = program(VS_QUAD, FS_QUAD); view = program(VS_VIEW, FS_VIEW); }
    catch (e) { console.warn("WebGL painting unavailable:", e.message); return null; }

    // A quad's corners, and a buffer for the shapes (capsules and stamps: 6 numbers each).
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    const shapes = gl.createBuffer();
    const vaoShape = gl.createVertexArray(), vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(vaoShape);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners); gl.enableVertexAttribArray(shape.a("corner")); gl.vertexAttribPointer(shape.a("corner"), 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, shapes);
    gl.enableVertexAttribArray(shape.a("seg")); gl.vertexAttribPointer(shape.a("seg"), 4, gl.FLOAT, false, 24, 0); gl.vertexAttribDivisor(shape.a("seg"), 1);
    gl.enableVertexAttribArray(shape.a("rad")); gl.vertexAttribPointer(shape.a("rad"), 2, gl.FLOAT, false, 24, 16); gl.vertexAttribDivisor(shape.a("rad"), 1);
    gl.bindVertexArray(vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    for (const pr of [quad, view]) { const at = pr.a("corner"); gl.enableVertexAttribArray(at); gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0); }
    gl.bindVertexArray(null);

    // ---- pictures on the chip ----
    const target = (w, h) =>
    {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        const fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return { tex, fbo, w, h };
    };
    const drop = t => { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); } };
    const into = (t, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fbo : null); gl.viewport(0, 0, w, h); };
    const clear = () => { gl.disable(gl.SCISSOR_TEST); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); };
    // A picture (a tile, a fill) taken onto the chip: its top row at the top (as the shapes
    // are drawn), its colors premultiplied.
    const upload = (src, tex) =>
    {
        tex = tex || gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
        return tex;
    };
    // An ImageBitmap (or image) through a small canvas of the page's, so it comes onto the chip premultiplied.
    const via = document.createElement("canvas");
    const uploadImage = (img, tex) =>
    {
        via.width = img.width; via.height = img.height;
        const g = via.getContext("2d");
        g.clearRect(0, 0, via.width, via.height); g.drawImage(img, 0, 0);
        return upload(via, tex);
    };
    // The Flat's tip, as render.js outlines it: a picture of it, drawn once.
    let tipTex = null;
    const tip = () =>
    {
        if (tipTex) return tipTex;
        const W = 256, H = Math.round(256 * render.FLAT.aspect), c = document.createElement("canvas");
        c.width = W; c.height = H;
        const g = c.getContext("2d"), t = render.tipOutline();
        g.fillStyle = "#fff"; g.beginPath(); g.moveTo(W / 2 + t[0] * W, H / 2 + t[1] * H);
        for (let k = 2; k < t.length; k += 2) g.lineTo(W / 2 + t[k] * W, H / 2 + t[k + 1] * H);
        g.closePath(); g.fill();
        return tipTex = upload(c);
    };

    // ---- shapes: a stroke as capsules (Ink, the eraser) or stamps (the Flat) ----
    const rgbOf = c => [1, 3, 5].map(k => parseInt((c || "#000000").slice(k, k + 2), 16) / 255);
    // Ink's pieces "from" to "to" (render.js, inkPieces): each curve cut into short straight capsules, its width as
    // the piece's, onto "out" (x0, y0, x1, y1, r, r per capsule). "px": a pixel, in canvas units.
    function inkShapes(st, p, from, to, px, out, upto)
    {
        const n = upto === undefined ? p.length / 3 : upto, x = i => p[i * 3], y = i => p[i * 3 + 1], w = i => st.size * Math.max(0.1, p[i * 3 + 2]);
        if (n === 1) { if (from <= 1) out.push(x(0), y(0), x(0), y(0), w(0) / 2, w(0) / 2); return; }
        if (n === 2) { if (from <= 1) { const r = (w(0) + w(1)) / 4; out.push(x(0), y(0), x(1), y(1), r, r); } return; }
        for (let i = Math.max(1, from); i < Math.min(to, n); i++)
        {
            const ax = i === 1 ? x(0) : (x(i - 2) + x(i - 1)) / 2, ay = i === 1 ? y(0) : (y(i - 2) + y(i - 1)) / 2;
            const last = i === n - 1, bx = last ? x(i) : (x(i - 1) + x(i)) / 2, by = last ? y(i) : (y(i - 1) + y(i)) / 2;
            const cx = x(i - 1), cy = y(i - 1);
            const r = (i === 1 ? (w(0) + w(1)) / 2 : (w(i - 2) + w(i - 1) * 2 + w(i)) / 4) / 2;
            const len = Math.hypot(cx - ax, cy - ay) + Math.hypot(bx - cx, by - cy), k = Math.max(1, Math.min(64, Math.ceil(len / (px * 3))));
            let qx = ax, qy = ay;
            for (let j = 1; j <= k; j++)
            {
                const t = j / k, u = 1 - t, nx = u * u * ax + 2 * u * t * cx + t * t * bx, ny = u * u * ay + 2 * u * t * cy + t * t * by;
                out.push(qx, qy, nx, ny, r, r);
                qx = nx; qy = ny;
            }
        }
    }
    // The Flat's stamps along points "from" to "to", carrying on "c": what is left over.
    function flatShapes(st, from, to, c, out)
    {
        return render.flatStamps((x, y, w) => out.push(x, y, x, y, w / 2, w / 2 * render.FLAT.aspect), st, from, to, c);
    }
    // Shapes drawn into what is bound, as "map" places canvas units, each kept as strong as the strongest over it (so
    // a stroke is one even layer of paint, as render.js draws one).
    let floats = new Float32Array(6 * 1024);   // (the shapes' numbers, sent from one array used again: none made each frame)
    function drawShapes(list, color, map, w, h, stamps)
    {
        if (!list.length) return;
        gl.useProgram(shape.pr);
        gl.bindVertexArray(vaoShape);
        gl.bindBuffer(gl.ARRAY_BUFFER, shapes);
        if (floats.length < list.length) floats = new Float32Array(Math.max(list.length, floats.length * 2));
        floats.set(list);
        gl.bufferData(gl.ARRAY_BUFFER, floats, gl.STREAM_DRAW, 0, list.length);
        gl.uniform4f(shape.u.map, map[0], map[1], map[2], map[3]);
        gl.uniform2f(shape.u.size, w, h);
        const [r, g, b] = rgbOf(color);
        gl.uniform4f(shape.u.color, r, g, b, 1);
        gl.uniform1f(shape.u.stamp, stamps ? 1 : 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tip()); gl.uniform1i(shape.u.tip, 0);   // (always: never the picture being drawn into)
        gl.enable(gl.BLEND); gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, list.length / 6);
        gl.blendEquation(gl.FUNC_ADD);
        gl.bindVertexArray(null);
    }
    // A picture laid into what is bound: "rect" in its pixels, "src" the part of the picture (u0, vTop, u1, vBottom),
    // as paint ("over"), or rubbing out what is there ("out").
    function drawQuad(tex, rect, src, w, h, alpha, how)
    {
        gl.useProgram(quad.pr);
        gl.bindVertexArray(vaoQuad);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(quad.u.pic, 0);
        gl.uniform4f(quad.u.rect, rect[0], rect[1], rect[2], rect[3]);
        gl.uniform4f(quad.u.src, src[0], src[1], src[2], src[3]);
        gl.uniform2f(quad.u.size, w, h);
        gl.uniform1f(quad.u.alpha, alpha);
        gl.enable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD);
        if (how === "out") gl.blendFunc(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA); else if (how === "copy") gl.disable(gl.BLEND); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }

    // ---- the drawing's picture ----
    let L = null;   // { id, t (its texture), x, y (where it starts, canvas units), k (its pixels to a unit), n (strokes in it), last, loaded, fills, most, part }
    let scratch = null;   // a stroke painted alone before it is laid in (so it is one even layer, at its opacity)
    const tiles = new Map();   // tile pictures on the chip, by file
    const tileTex = (file, got) => { let t = tiles.get(file); if (t && t.img === got.img) return t.tex; if (t) gl.deleteTexture(t.tex); t = { img: got.img, tex: uploadImage(got.img) }; tiles.set(file, t); if (tiles.size > 96) { const [f, o] = tiles.entries().next().value; gl.deleteTexture(o.tex); tiles.delete(f); } return t.tex; };
    const fillTex = new Map();
    const strokeBox = st =>
    {
        if (st.kind === "fill") return { x: st.x, y: st.y, w: st.w, h: st.h };
        const r = st.size / 2 + 2, p = st.pts;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (let i = 0; i < p.length; i += 3) { x0 = Math.min(x0, p[i] - r); y0 = Math.min(y0, p[i + 1] - r); x1 = Math.max(x1, p[i] + r); y1 = Math.max(y1, p[i + 1] + r); }
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    };
    // One stroke painted into the drawing's picture, as render.js paints it.
    function paintStroke(st)
    {
        const k = L.k;
        if (st.kind !== "fill" && !(st.pts && st.pts.length)) return true;   // (no points: nothing to paint)
        if (st.kind === "fill")
        {
            const img = render.fillImage(st);
            if (!img.complete || !img.naturalWidth) return false;
            let t = fillTex.get(st.sid);
            if (!t) { t = uploadImage(img); fillTex.set(st.sid, t); }
            into(L.t, L.t.w, L.t.h);
            drawQuad(t, [(st.x - L.x) * k, (st.y - L.y) * k, st.w * k, st.h * k], [0, 1, 1, 0], L.t.w, L.t.h, 1, "over");
            return true;
        }
        // Alone first, over the part of the picture it reaches, then laid in.
        const b = strokeBox(st);
        const x0 = Math.max(0, Math.floor((b.x - L.x) * k)), y0 = Math.max(0, Math.floor((b.y - L.y) * k));
        const x1 = Math.min(L.t.w, Math.ceil((b.x + b.w - L.x) * k)), y1 = Math.min(L.t.h, Math.ceil((b.y + b.h - L.y) * k));
        const bw = x1 - x0, bh = y1 - y0;
        if (bw <= 0 || bh <= 0) return true;
        if (!scratch || scratch.w < bw || scratch.h < bh) { drop(scratch); scratch = target(Math.min(most, Math.max(bw, scratch ? scratch.w : 0, 512)), Math.min(most, Math.max(bh, scratch ? scratch.h : 0, 512))); }
        into(scratch, bw, bh); clear();
        const map = [k, k, -L.x * k - x0, -L.y * k - y0], list = [];
        if (st.kind === "flat") flatShapes(st, 0, st.pts.length / 3, 0, list);
        else inkShapes(st, st.pts, 1, st.pts.length / 3, 1 / k, list);
        drawShapes(list, st.kind === "erase" ? "#000000" : st.color, map, bw, bh, st.kind === "flat");
        into(L.t, L.t.w, L.t.h);
        const alpha = st.opacity === undefined ? 1 : st.opacity;
        drawQuad(scratch.tex, [x0, y0, bw, bh], [0, bh / scratch.h, bw / scratch.w, 0], L.t.w, L.t.h, alpha, st.kind === "erase" ? "out" : "over");
        return true;
    }
    // The drawing's picture made to match: made anew over the part of the canvas it needs (its pixels, then its
    // strokes), or just its new strokes painted in. "upto": its strokes counted (one under way left off).
    function sync(o, b, doc, get, need, view, upto, moving)
    {
        const strokes = (o.strokes || []).slice(0, upto);
        const loaded = o.kind === "paint" ? render.tilesOf(doc, o.file).filter(t => get(t.file)).length : 0;
        const fills = strokes.filter(st => st.kind === "fill" && render.fillImage(st).complete).length;
        const inside = st => { const e = strokeBox(st); return e.x >= L.x && e.y >= L.y && e.x + e.w <= L.x + L.t.w / L.k && e.y + e.h <= L.y + L.t.h / L.k; };
        const same = L && L.id === o.id && L.file === o.file && L.loaded === loaded && L.fills === fills && L.n <= strokes.length && (L.n === 0 || (strokes[L.n - 1] && render.strokeKey(strokes[L.n - 1]) === L.last)) && strokes.slice(L.n).every(inside);
        const seen = L && L.part ? view.x >= L.x && view.y >= L.y && view.x + view.w <= L.x + L.t.w / L.k && view.y + view.h <= L.y + L.t.h / L.k : true;
        const sharp = L && (moving || (L.k >= Math.min(need, L.most) * 0.99 && L.k <= need * 2.5));
        if (same && sharp && seen)
        {
            for (let i = L.n; i < strokes.length; i++) paintStroke(strokes[i]);
            L.n = strokes.length; L.last = strokes.length ? render.strokeKey(strokes[strokes.length - 1]) : "";
            return;
        }
        // Made anew: over all it reaches and some room (strokes made next fit on it too) where that fits on the chip
        // as sharp as it is shown; else over what is in view, and some room round it.
        const r0 = o.reach || b, pad = Math.max(r0.w, r0.h) * 0.35 + 200 / need;
        let r = { x: r0.x - pad, y: r0.y - pad, w: r0.w + 2 * pad, h: r0.h + 2 * pad }, part = false;
        const fit = rr => Math.min(most / Math.max(rr.w, rr.h), Math.sqrt(16e6 / (rr.w * rr.h)));
        let cap = fit(r);
        if (cap < need)
        {
            const m = Math.max(view.w, view.h) * 0.5, v = { x: view.x - m, y: view.y - m, w: view.w + 2 * m, h: view.h + 2 * m };
            const x0 = Math.max(r.x, v.x), y0 = Math.max(r.y, v.y), x1 = Math.min(r.x + r.w, v.x + v.w), y1 = Math.min(r.y + r.h, v.y + v.h);
            if (x1 > x0 && y1 > y0) { r = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; part = true; cap = fit(r); }
        }
        const k = Math.min(cap, need * 1.25);
        const W = Math.max(1, Math.min(most, Math.ceil(r.w * k))), H = Math.max(1, Math.min(most, Math.ceil(r.h * k)));
        if (!L || L.t.w !== W || L.t.h !== H) { if (L) drop(L.t); L = { t: target(W, H) }; }
        Object.assign(L, { id: o.id, file: o.file, x: r.x, y: r.y, k, most: cap, part, loaded, fills });
        into(L.t, W, H); clear();
        if (o.kind === "paint")
        {
            // Its pixels (render.js, paintTiles): its frame filling its box.
            const T = 256, tl = render.tilesOf(doc, o.file);
            let a = o.frame && o.frame.w > 0 ? o.frame : null;
            if (!a && tl.length) { const cs = tl.map(t => t.c), rs = tl.map(t => t.r); a = { x: Math.min(...cs) * T, y: Math.min(...rs) * T, w: (Math.max(...cs) - Math.min(...cs) + 1) * T, h: (Math.max(...rs) - Math.min(...rs) + 1) * T }; }
            if (a) for (const t of tl)
            {
                const got = get(t.file);
                if (!got) continue;
                const sx = b.w / a.w, sy = b.h / a.h, cx = b.x + (t.c * T - a.x) * sx, cy = b.y + (t.r * T - a.y) * sy;
                drawQuad(tileTex(t.file, got), [(cx - L.x) * k, (cy - L.y) * k, T * sx * k, T * sy * k], [0, 1, 1, 0], W, H, 1, "over");
            }
        }
        for (const st of strokes) paintStroke(st);
        L.n = strokes.length; L.last = strokes.length ? render.strokeKey(strokes[strokes.length - 1]) : "";
    }

    // ---- the stroke under way, on the view's pixels ----
    let wet = null, tail = null;
    let going = null;   // { sid, key (the view it was begun in), upto (points or pieces settled), carry }
    function wetFrame(st, map, w, h)
    {
        if (!wet || wet.w !== w || wet.h !== h) { drop(wet); drop(tail); wet = target(w, h); tail = target(w, h); going = null; }
        const key = map.join();
        if (!going || going.sid !== st.sid || going.key !== key) { into(wet, w, h); clear(); going = { sid: st.sid, key, upto: 0, carry: 0 }; }
        // (settled: its points but those still to come right ("ahead": the last stretch, and any guessed), kept; the
        // rest drawn afresh each time)
        const p = st.pts, n = p.length / 3, all = n - (p.ahead || 0), color = st.kind === "erase" ? "#000000" : st.color, px = 1 / map[0];
        into(wet, w, h);
        if (st.kind === "flat")
        {
            if (all > going.upto) { const list = []; going.carry = flatShapes(st, going.upto, all, going.carry, list); drawShapes(list, color, map, w, h, true); going.upto = all; }
            into(tail, w, h); clear();
            if (n > all) { const list = []; flatShapes(st, all, n, going.carry, list); drawShapes(list, color, map, w, h, true); }
        }
        else
        {
            if (all >= 3 && all - 1 > going.upto) { const list = []; inkShapes(st, p, Math.max(1, going.upto), all - 1, px, list, all); drawShapes(list, color, map, w, h, false); going.upto = all - 1; }
            into(tail, w, h); clear();
            const list = []; inkShapes(st, p, Math.max(1, going.upto), n, px, list, n); drawShapes(list, color, map, w, h, false);
        }
    }

    // The view: "o" the drawing (as the scene has it), "cam", "dpr", "w" and "h" the view's size; "wetStroke" the
    // stroke under way on it, if any; "fade" its opacity; "moving": the view moving (it is kept as sharp as it was).
    P.show = (o, b, doc, get, cam, dpr, w, h, wetStroke, fade, moving) =>
    {
        const Wv = Math.round(w * dpr), Hv = Math.round(h * dpr);
        if (canvas.width !== Wv || canvas.height !== Hv) { canvas.width = Wv; canvas.height = Hv; }
        const need = cam.s * dpr, seen = { x: -cam.tx / cam.s, y: -cam.ty / cam.s, w: w / cam.s, h: h / cam.s };
        const strokes = o.strokes || [], wi = wetStroke ? strokes.indexOf(wetStroke) : -1, live = wi >= 0 && wi === strokes.length - 1;
        sync(o, b, doc, get, need, seen, live ? wi : strokes.length, moving);
        const map = [need, need, cam.tx * dpr, cam.ty * dpr];
        if (live && (wetStroke.kind === "pen" || wetStroke.kind === "flat" || wetStroke.kind === "erase")) wetFrame(wetStroke, map, Wv, Hv);
        else going = null;
        into(null, Wv, Hv); clear();
        draw(Wv, Hv, map, live && going, wetStroke, fade);
    };
    function draw(Wv, Hv, map, wetOn, st, fade)
    {
        const v = view;
        gl.useProgram(v.pr);
        gl.bindVertexArray(vaoQuad);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.t.tex); gl.uniform1i(v.u.layer, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, wetOn ? wet.tex : L.t.tex); gl.uniform1i(v.u.wet, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, wetOn ? tail.tex : L.t.tex); gl.uniform1i(v.u.tail, 2);
        gl.uniform2f(v.u.size, Wv, Hv);
        gl.uniform4f(v.u.back, 1 / map[0], 1 / map[1], -map[2] / map[0], -map[3] / map[1]);
        gl.uniform4f(v.u.place, L.x, L.y, L.k, 0);
        gl.uniform2f(v.u.lsize, L.t.w, L.t.h);
        gl.uniform1f(v.u.wetOn, wetOn ? 1 : 0);
        gl.uniform1f(v.u.erase, wetOn && st.kind === "erase" ? 1 : 0);
        gl.uniform1f(v.u.op, wetOn ? (st.opacity === undefined ? 1 : st.opacity) : 1);
        gl.uniform1f(v.u.fade, fade);
        gl.disable(gl.BLEND);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.bindVertexArray(null);
    }
    // Put away: its pictures let go (but the program kept, for the next time).
    P.forget = () => { drop(L ? L.t : null); L = null; drop(wet); drop(tail); wet = tail = null; going = null; drop(scratch); scratch = null; for (const t of tiles.values()) gl.deleteTexture(t.tex); tiles.clear(); for (const t of fillTex.values()) gl.deleteTexture(t); fillTex.clear(); };
    // Let go of for good: the chip's context too (a phone keeps only a few).
    P.dispose = () => { P.forget(); try { const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); } catch (e) { } };
    return P;
}
