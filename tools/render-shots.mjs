#!/usr/bin/env node
/**
 * Software renderer for assets/map.json -> PNG screenshots + top-down SVG map.
 * Pure Node, no dependencies beyond pngjs. Runs the same geometry the
 * web preview shows (which matches Crossroads.rbxlx 1:1).
 *
 * Run:  node tools/render-shots.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MAP = JSON.parse(readFileSync(join(ROOT, "assets", "map.json"), "utf8"));
const OUT = join(ROOT, "assets", "img");
mkdirSync(OUT, { recursive: true });

/* ---------- tiny vector math ---------- */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const LIGHT = norm([0.45, 0.85, 0.28]);

function hexRgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

/* ---------- primitive triangulation (unit space) ---------- */
function boxTris() {
  const v = [
    [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5],
    [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5],
  ];
  const quads = [
    [4, 5, 6, 7], [1, 0, 3, 2], [7, 6, 2, 3], [0, 1, 5, 4],
    [0, 4, 7, 3], [5, 1, 2, 6],
  ];
  const tris = [];
  for (const q of quads) {
    tris.push([v[q[0]], v[q[1]], v[q[2]]], [v[q[0]], v[q[2]], v[q[3]]]);
  }
  return tris;
}
function cylTris(n = 12) {
  const tris = [];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
    const y0 = Math.cos(a0) * 0.5, z0 = Math.sin(a0) * 0.5;
    const y1 = Math.cos(a1) * 0.5, z1 = Math.sin(a1) * 0.5;
    const A = [-0.5, y0, z0], B = [0.5, y0, z0], C = [0.5, y1, z1], D = [-0.5, y1, z1];
    tris.push([A, B, C], [A, C, D]);
    tris.push([[0.5, 0, 0], B, C]);
    tris.push([[-0.5, 0, 0], D, A]);
  }
  return tris;
}
function ballTris(lat = 5, lon = 8) {
  const tris = [];
  const P = (t, p) => [Math.sin(t) * Math.cos(p) * 0.5, Math.cos(t) * 0.5, Math.sin(t) * Math.sin(p) * 0.5];
  for (let i = 0; i < lat; i++) {
    const t0 = (i / lat) * Math.PI, t1 = ((i + 1) / lat) * Math.PI;
    for (let j = 0; j < lon; j++) {
      const p0 = (j / lon) * Math.PI * 2, p1 = ((j + 1) / lon) * Math.PI * 2;
      tris.push([P(t0, p0), P(t1, p0), P(t1, p1)]);
      tris.push([P(t0, p0), P(t1, p1), P(t0, p1)]);
    }
  }
  return tris;
}
function wedgeTris() {
  const v = new Float32Array([
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, 0.5,
    -0.5, -0.5, 0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, -0.5,
    -0.5, -0.5, 0.5, -0.5, 0.5, -0.5, -0.5, -0.5, -0.5,
    0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5,
  ]);
  const tris = [];
  for (let i = 0; i < v.length; i += 9) {
    tris.push([[v[i], v[i + 1], v[i + 2]], [v[i + 3], v[i + 4], v[i + 5]], [v[i + 6], v[i + 7], v[i + 8]]]);
  }
  return tris;
}
const GEO = { box: boxTris(), cyl: cylTris(), ball: ballTris(), wedge: wedgeTris() };

/* ---------- camera ---------- */
function makeCamera(eye, target, fovDeg, W, H) {
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 1, 0]));
  const up = cross(right, fwd);
  const focal = H / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return {
    eye, fwd, right, up, focal, W, H,
    toCam(v) {
      const d = sub(v, eye);
      return [dot(d, right), dot(d, up), dot(d, fwd)];
    },
    project(v) {
      const d = sub(v, eye);
      const z = dot(d, fwd);
      if (z < 0.5) return null;
      return [W / 2 + (dot(d, right) * focal) / z, H / 2 - (dot(d, up) * focal) / z, z];
    },
    projectCam(c) {
      return [W / 2 + (c[0] * focal) / c[2], H / 2 - (c[1] * focal) / c[2], c[2]];
    },
  };
}

/** Clip a camera-space polygon against the near plane z >= NEAR (fan-triangulate result). */
function clipNear(poly, near = 0.5) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ain = a[2] >= near, bin = b[2] >= near;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = (near - a[2]) / (b[2] - a[2]);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, near]);
    }
  }
  const tris = [];
  for (let i = 1; i + 1 < out.length; i++) tris.push([out[0], out[i], out[i + 1]]);
  return tris;
}

/* ---------- rasterizer ---------- */
function render(eye, target, fov, W, H, file, opts = {}) {
  const cam = makeCamera(eye, target, fov, W, H);
  const img = Buffer.alloc(W * H * 4);

  // sky gradient
  for (let y = 0; y < H; y++) {
    const t = y / H;
    const r = 60 + 120 * t, g = 140 + 70 * t, b = 208 + 30 * t;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = 255;
    }
  }
  const put = (x, y, r, g, b, a = 1) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o = (y * W + x) * 4;
    if (a >= 1) { img[o] = r; img[o + 1] = g; img[o + 2] = b; }
    else {
      img[o] = img[o] * (1 - a) + r * a;
      img[o + 1] = img[o + 1] * (1 - a) + g * a;
      img[o + 2] = img[o + 2] * (1 - a) + b * a;
    }
    img[o + 3] = 255;
  };
  const disc = (cx, cy, rad, r, g, b, a = 1) => {
    const R = Math.max(1, rad | 0);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++)
        if (x * x + y * y <= R * R) put(cx + x, cy + y, r, g, b, a);
  };

  // sun + lazy clouds
  const sunP = cam.project([eye[0] + LIGHT[0] * 800, eye[1] + LIGHT[1] * 800, eye[2] + LIGHT[2] * 800]);
  if (sunP) disc(sunP[0], sunP[1], 46, 255, 244, 190, 0.95);
  const clouds = [[-450, 230, -350], [300, 260, -500], [520, 210, 300], [-380, 250, 450], [40, 300, -620], [-620, 200, 60]];
  for (const c of clouds) {
    const p = cam.project(c);
    if (!p) continue;
    for (const [ox, oy, rr] of [[-42, 6, 26], [0, -8, 34], [44, 4, 24], [10, 12, 22]]) {
      disc(p[0] + ox, p[1] + oy, rr, 255, 255, 255, 0.92);
    }
  }

  // collect triangles
  const tris = [];
  const applyM = (m, p, s, v) => {
    const x = v[0] * s[0], y = v[1] * s[1], z = v[2] * s[2];
    return [
      m[0] * x + m[1] * y + m[2] * z + p[0],
      m[3] * x + m[4] * y + m[5] * z + p[1],
      m[6] * x + m[7] * y + m[8] * z + p[2],
    ];
  };
  const studPts = [];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const ROTZ90 = [0, -1, 0, 1, 0, 0, 0, 0, 1];
  for (let pr of MAP.prims) {
    if (pr.k === "spawn") pr = { ...pr, k: "cyl", m: ROTZ90 };
    const geo = GEO[pr.k];
    if (!geo) continue;
    const m = pr.m || I3;
    const rgb = hexRgb(pr.c);
    if (pr.slate) { rgb[0] *= 0.9; rgb[1] *= 0.9; rgb[2] *= 0.9; }
    const alpha = pr.tr ? 1 - pr.tr : 1;
    for (const t of geo) {
      const w = t.map((v) => applyM(m, pr.p, pr.s, v));
      const n = norm(cross(sub(w[1], w[0]), sub(w[2], w[0])));
      const bright = 0.6 + 0.4 * Math.abs(dot(n, LIGHT));
      const cw = w.map((p3) => cam.toCam(p3));
      if (cw.every((c) => c[2] < 0.5)) continue;
      const clipped = clipNear(cw);
      for (const ct of clipped) {
        const pts = ct.map((c) => cam.projectCam(c));
        const z = (ct[0][2] + ct[1][2] + ct[2][2]) / 3;
        tris.push({ pts, zs: [ct[0][2], ct[1][2], ct[2][2]], z, rgb, bright, alpha });
      }
    }
    // stud dots for studded tops
    if (pr.studs) {
      const [sx, , sz] = pr.s;
      for (let i = -sx / 2 + 0.5; i < sx / 2; i += 1) {
        for (let k = -sz / 2 + 0.5; k < sz / 2; k += 1) {
          studPts.push({ w: applyM(m, pr.p, pr.s, [i / sx, 0.5, k / sz]), rgb });
        }
      }
    }
  }
  const zbuf = new Float32Array(W * H).fill(Infinity);
  const ztest = (x, y, z, bias = 0) => z < zbuf[y * W + x] - bias;
  const zwrite = (x, y, z) => { zbuf[y * W + x] = z; };

  const fillTri = ({ pts, zs, rgb, bright, alpha }, writeZ) => {
    const [p0, p1, p2] = pts;
    const minX = Math.max(0, Math.floor(Math.min(p0[0], p1[0], p2[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(p0[0], p1[0], p2[0])));
    const minY = Math.max(0, Math.floor(Math.min(p0[1], p1[1], p2[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(p0[1], p1[1], p2[1])));
    const d = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]);
    if (Math.abs(d) < 1e-6) return;
    const r = rgb[0] * bright, g = rgb[1] * bright, b = rgb[2] * bright;
    const iz0 = 1 / zs[0], iz1 = 1 / zs[1], iz2 = 1 / zs[2];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const w0 = ((p1[0] - x) * (p2[1] - y) - (p2[0] - x) * (p1[1] - y)) / d;
        const w1 = ((p2[0] - x) * (p0[1] - y) - (p0[0] - x) * (p2[1] - y)) / d;
        const w2 = 1 - w0 - w1;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const z = 1 / (w0 * iz0 + w1 * iz1 + w2 * iz2);
        if (!ztest(x, y, z, 0.02)) continue;
        if (writeZ) zwrite(x, y, z);
        put(x, y, r, g, b, alpha);
      }
    }
  };

  // opaque pass (writes depth), then transparent pass back-to-front
  for (const t of tris.filter((t) => t.alpha >= 1)) fillTri(t, true);
  tris.sort((a, b) => b.z - a.z);
  for (const t of tris.filter((t) => t.alpha < 1)) fillTri(t, false);

  // stud dots (depth-tested against the scene)
  let drawn = 0;
  for (const { w, rgb } of studPts) {
    const p = cam.project(w);
    if (!p) continue;
    const rad = (cam.focal * 0.34) / p[2];
    if (rad < 1.1 || rad > 9) continue;
    if (drawn++ > 90000) break;
    if (!ztest(Math.round(p[0]), Math.round(p[1]), p[2], 0.5)) continue;
    disc(p[0], p[1], rad, rgb[0] * 1.06, rgb[1] * 1.06, rgb[2] * 1.06, 0.55);
    disc(p[0], p[1], rad * 0.62, rgb[0] * 0.8, rgb[1] * 0.8, rgb[2] * 0.8, 0.4);
  }

  const png = new PNG({ width: W, height: H });
  img.copy(png.data);
  writeFileSync(join(OUT, file), PNG.sync.write(png));
  console.log("rendered", file);
}

/* ---------- top-down SVG map ---------- */
function topdownSvg() {
  const S = 1000, half = 256;
  const px = (v) => ((v + half) / (half * 2)) * S;
  const parts = [];
  parts.push(`<rect width="${S}" height="${S}" fill="#4B974B"/>`);
  for (const pr of MAP.prims) {
    if (pr.k === "spawn") continue;
    const [sx, sy, sz] = pr.s;
    if (sy > 60) continue; // skip very tall tower posts
    const x = px(pr.p[0] - sx / 2), y = px(pr.p[2] - sz / 2);
    const w = (sx / 512) * S, h = (sz / 512) * S;
    const fill = pr.c;
    if (pr.k === "cyl") {
      const r = Math.max(2, ((Math.max(sy, sz) / 2) / 512) * S);
      parts.push(`<circle cx="${px(pr.p[0]).toFixed(1)}" cy="${px(pr.p[2]).toFixed(1)}" r="${r.toFixed(1)}" fill="${fill}" fill-opacity="${pr.tr ? 0.6 : 1}"/>`);
    } else if (w > 1.5 && h > 1.5) {
      parts.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" fill-opacity="${pr.tr ? 0.6 : 1}"/>`);
    }
  }
  const labels = [
    ["Welcome Sign", 18, 34], ["Stone Bridge", -88, 0], ["Brick House", -145, -150],
    ["Corner Shop", 140, -140], ["Lake", -140, 150], ["Watchtower", 150, 160],
    ["Trampoline", 28, -34], ["Spawn", 0, 0],
  ];
  for (const [t, x, z] of labels) {
    parts.push(`<circle cx="${px(x)}" cy="${px(z)}" r="7" fill="#F5CD30" stroke="#1B2A35" stroke-width="2"/>`);
    parts.push(`<text x="${px(x) + 12}" y="${px(z) + 5}" font-family="Arial" font-weight="bold" font-size="20" fill="#1B2A35" stroke="#fff" stroke-width="3" paint-order="stroke">${t}</text>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}">${parts.join("\n")}</svg>`;
  writeFileSync(join(OUT, "map-topdown.svg"), svg);
  console.log("wrote map-topdown.svg");
}

/* ---------- the shots ---------- */
render([10, 5.5, 44], [-6, 2, -10], 62, 1280, 800, "shot-spawn.png");
render([-26, 4.5, 0], [-88, 4, 0], 62, 1280, 800, "shot-bridge.png");
render([-104, 13, -116], [-145, 8, -150], 62, 1280, 800, "shot-house.png");
render([-102, 20, 192], [-140, 2, 150], 62, 1280, 800, "shot-lake.png");
render([188, 32, 202], [150, 22, 160], 62, 1280, 800, "shot-tower.png");
render([236, 178, 236], [0, 0, 0], 58, 1280, 800, "shot-overview.png");
topdownSvg();
