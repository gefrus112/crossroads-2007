#!/usr/bin/env node
/**
 * Crossroads (2007) place generator
 * ---------------------------------
 * Generates `Crossroads.rbxlx` (open in Roblox Studio -> Publish) and
 * `assets/map.json` (used by the GitHub Pages 3D preview) from ONE model.
 *
 * Rules enforced by design:
 *   - Parts, wedges, cylinders and balls only. No meshes, no unions, no terrain.
 *   - Plastic + slate materials only. No PBR (no SurfaceAppearance, no neon).
 *   - Legacy lighting, classic sky512 skybox, 2pm, no shadows.
 *   - Everything anchored except Tool pickups.
 *
 * Run:  node tools/generate-place.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------------------------- *
 *  Classic BrickColor palette        *
 * ---------------------------------- */
const BC = {
  White:      { i: 1,    h: "#F2F3F3" },
  Grey:       { i: 194,  h: "#A3A2A5" },
  DarkGrey:   { i: 199,  h: "#635F62" },
  Black:      { i: 26,   h: "#1B2A35" },
  Red:        { i: 21,   h: "#C4281C" },
  ReallyRed:  { i: 1004, h: "#FF0000" },
  Blue:       { i: 23,   h: "#0D69AC" },
  Yellow:     { i: 24,   h: "#F5CD30" },
  Green:      { i: 141,  h: "#4B974B" },
  EarthGreen: { i: 124,  h: "#6E8756" },
  Orange:     { i: 106,  h: "#DA8541" },
  Brown:      { i: 105,  h: "#694028" },
  Tan:        { i: 5,    h: "#D7C599" },
  Cream:      { i: 226,  h: "#FDEA8D" },
};

const MAT = { Plastic: 256, Slate: 800 };
const SURF = { Smooth: 0, Studs: 3, Inlet: 4 };
const FACE = { Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 };

/* ---------------------------------- *
 *  Rotation matrices (row-major 3x3) *
 * ---------------------------------- */
const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const D2R = (d) => (d * Math.PI) / 180;
function mmul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      o[r * 3 + c] = s;
    }
  return o;
}
const ROTY = (d) => { const r = D2R(d), c = Math.cos(r), s = Math.sin(r); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
const ROTX = (d) => { const r = D2R(d), c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, -s, 0, s, c]; };
const ROTZ = (d) => { const r = D2R(d), c = Math.cos(r), s = Math.sin(r); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

/* ---------------------------------- *
 *  Scene records                     *
 * ---------------------------------- */
let refCounter = 0;
const newRef = () => `RBX${refCounter++}`;

function base(o) {
  return {
    cls: "Part",
    name: o.name || "Part",
    pos: o.pos,
    m: o.m || I3,
    size: o.size,
    color: o.color,
    mat: o.mat || "Plastic",
    studs: !!o.studs,
    trans: o.trans || 0,
    refl: o.refl || 0,
    shape: o.shape || "Block",
    anchored: o.anchored !== false,
    canCollide: o.canCollide !== false,
    kids: o.kids || [],
    ref: newRef(),
    sign: o.sign,        // [{text, size:[sx,sy], color, pos:[sx,sy]}] -> SurfaceGui
    signFace: o.signFace ?? "Front",
    decal: o.decal,      // {id, face}
    spawn: !!o.spawn,
    logo: !!o.logo,
    water: !!o.water,
    wedge: !!o.wedge,
  };
}

function part(o) { return base(o); }
function wedge(o) { const p = base(o); p.cls = "WedgePart"; p.wedge = true; return p; }
function cylinder(o) { const p = base(o); p.shape = "Cylinder"; return p; }
function ball(o) { const p = base(o); p.shape = "Ball"; return p; }
function model(name, kids, extra = {}) { return { cls: "Model", name, kids, ref: newRef(), ...extra }; }
function script(name, source) { return { cls: "Script", name, source, ref: newRef() }; }

/* ---------------------------------- *
 *  Assembly helpers                  *
 * ---------------------------------- */

/** Thin slab between two 3D points (length axis = local X). */
function slopeSlab({ name = "Slab", from, to, width, thick, color, mat, studs, trans }) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(-dz, dx);
  const pitch = Math.asin(dy / len);
  const m = mmul(ROTY((yaw * 180) / Math.PI), ROTZ((pitch * 180) / Math.PI));
  return part({
    name, color, mat, studs, trans,
    pos: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    size: [len, thick, width], m,
  });
}

/**
 * Wall with rectangular openings (door / windows).
 * axis "x": wall spans along X (1 thick in Z).  axis "z": spans along Z.
 * openings: [{a0,a1,y0,y1,glass}] in wall coordinates.
 */
function wall({ name = "Wall", axis, fixed, a0, a1, y0 = 0, h, color, mat = "Plastic", openings = [], glassTrans = 0.55 }) {
  const out = [];
  const sorted = [...openings].sort((p, q) => p.a0 - q.a0);
  const emit = (s0, s1, b0, b1, extra = {}) => {
    if (s0 >= s1 - 0.001 || b0 >= b1 - 0.001) return;
    const c = (s0 + s1) / 2, w = s1 - s0, cy = (b0 + b1) / 2, hh = b1 - b0;
    const rec = part({ name, color, mat, ...extra });
    rec.size = axis === "x" ? [w, hh, 1] : [1, hh, w];
    rec.pos = axis === "x" ? [c, cy, fixed] : [fixed, cy, c];
    out.push(rec);
  };
  let cursor = a0;
  for (const o of sorted) {
    emit(cursor, o.a0, y0, y0 + h);                 // pier before opening
    emit(o.a0, o.a1, o.y1, y0 + h);                 // lintel
    emit(o.a0, o.a1, y0, o.y0);                     // sill
    if (o.glass) {                                   // window glass
      const rec = part({
        name: "Glass", color: BC.White, trans: glassTrans, refl: 0.35, mat: "Plastic",
      });
      const gw = o.a1 - o.a0, gh = o.y1 - o.y0, gc = (o.a0 + o.a1) / 2, gcy = (o.y0 + o.y1) / 2;
      rec.size = axis === "x" ? [gw, gh, 0.35] : [0.35, gh, gw];
      rec.pos = axis === "x" ? [gc, gcy, fixed] : [fixed, gcy, gc];
      out.push(rec);
    }
    cursor = o.a1;
  }
  emit(cursor, a1, y0, y0 + h);                     // last pier
  return out;
}

/** Classic pine: brown cylinder trunk + stacked green discs (no cones in 2007). */
function pineTree(x, z, s = 1, baseY = 0) {
  const kids = [];
  kids.push(cylinder({
    name: "Trunk", color: BC.Brown, pos: [x, baseY + 3 * s, z],
    size: [6 * s, 1.8 * s, 1.8 * s], m: ROTZ(90),
  }));
  const leaves = [
    [9.4, 2.8, 7.6], [7.4, 2.5, 10.0], [5.2, 2.2, 12.1], [2.9, 1.8, 13.9],
  ];
  for (const [dia, h, cy] of leaves) {
    kids.push(cylinder({
      name: "Leaves", color: BC.EarthGreen, pos: [x, baseY + cy * s, z],
      size: [h * s, dia * s, dia * s], m: ROTZ(90),
    }));
  }
  return model("PineTree", kids);
}

/** Traffic cone: stacked orange cylinders + white band on a black base. */
function trafficCone(x, z, groundY = 0.2) {
  const kids = [
    part({ name: "ConeBase", color: BC.Black, pos: [x, groundY + 0.15, z], size: [2.2, 0.3, 2.2] }),
    cylinder({ name: "C1", color: BC.Orange, pos: [x, groundY + 0.7, z], size: [0.9, 1.6, 1.6], m: ROTZ(90) }),
    cylinder({ name: "Band", color: BC.White, pos: [x, groundY + 1.3, z], size: [0.35, 1.2, 1.2], m: ROTZ(90) }),
    cylinder({ name: "C2", color: BC.Orange, pos: [x, groundY + 1.95, z], size: [1.0, 1.0, 1.0], m: ROTZ(90) }),
    cylinder({ name: "C3", color: BC.Orange, pos: [x, groundY + 2.75, z], size: [0.7, 0.45, 0.45], m: ROTZ(90) }),
  ];
  return model("TrafficCone", kids);
}

/** Wooden fence run: posts + 2 rails between a0..a1 along axis. */
function fenceRun({ axis, fixed, a0, a1, groundY = 0, color = BC.Brown }) {
  const kids = [];
  const span = 8;
  let n = Math.max(1, Math.round((a1 - a0) / span));
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    kids.push(part({
      name: "FencePost", color,
      pos: axis === "x" ? [a, groundY + 1.7, fixed] : [fixed, groundY + 1.7, a],
      size: [0.5, 3.4, 0.5],
    }));
  }
  for (let i = 0; i < n; i++) {
    const s0 = a0 + ((a1 - a0) * i) / n, s1 = a0 + ((a1 - a0) * (i + 1)) / n;
    const c = (s0 + s1) / 2, w = s1 - s0;
    for (const ry of [1.1, 2.45]) {
      kids.push(part({
        name: "FenceRail", color,
        pos: axis === "x" ? [c, groundY + ry, fixed] : [fixed, groundY + ry, c],
        size: axis === "x" ? [w + 0.4, 0.45, 0.5] : [0.5, 0.45, w + 0.4],
      }));
    }
  }
  return kids;
}

/* ---------------------------------- *
 *  THE MAP                           *
 * ---------------------------------- */
const mapKids = [];

/* ---------- Ground ---------- */
mapKids.push(part({
  name: "Baseplate", color: BC.Green, pos: [0, -0.5, 0],
  size: [512, 1, 512], studs: true,
}));

/* ---------- Roads ---------- */
const roads = [];
const RW = 8;            // road half width
const RT = 0.2;          // road thickness (top at 0.2)
roads.push(part({ name: "RoadEW", color: BC.Grey, pos: [0, RT / 2, 0], size: [512, RT, RW * 2] }));
roads.push(part({ name: "RoadN", color: BC.Grey, pos: [0, RT / 2, -136], size: [RW * 2, RT, 240] }));
roads.push(part({ name: "RoadS", color: BC.Grey, pos: [0, RT / 2, 136], size: [RW * 2, RT, 240] }));

// yellow edge lines
for (const seg of [{ c: -136 }, { c: 136 }]) {
  for (const e of [-7.3, 7.3]) {
    roads.push(part({ name: "YellowLine", color: BC.Yellow, pos: [e, RT + 0.04, seg.c], size: [0.7, 0.08, 240] }));
    roads.push(part({ name: "YellowLine", color: BC.Yellow, pos: [seg.c, RT + 0.04, e], size: [240, 0.08, 0.7] }));
  }
}
// white dashed center lines
for (let k = 0; ; k++) {
  const z = -252 + k * 12;
  if (z > 252) break;
  if (Math.abs(z) < 13) continue;
  roads.push(part({ name: "Dash", color: BC.White, pos: [0, RT + 0.04, z], size: [0.9, 0.08, 6] }));
  roads.push(part({ name: "Dash", color: BC.White, pos: [z, RT + 0.04, 0], size: [6, 0.08, 0.9] }));
}
mapKids.push(model("Roads", roads));

/* ---------- Spawn ---------- */
mapKids.push({
  cls: "SpawnLocation", name: "SpawnLocation",
  pos: [0, 0.7, 0], m: I3, size: [6, 1, 6], color: BC.White,
  mat: "Plastic", studs: false, trans: 0, refl: 0, shape: "Block",
  anchored: true, canCollide: true, ref: newRef(), spawn: true,
  kids: [{ cls: "Decal", name: "SpawnTexture", texture: "rbxassetid://12224170", face: FACE.Top, ref: newRef() }],
});

/* ---------- Welcome billboard ---------- */
{
  const bx = 18, bz = 34;
  const kids = [
    part({ name: "Post", color: BC.White, pos: [bx - 8, 3.5, bz], size: [0.8, 7, 0.8] }),
    part({ name: "Post", color: BC.White, pos: [bx + 8, 3.5, bz], size: [0.8, 7, 0.8] }),
    part({
      name: "Sign", color: BC.Blue, pos: [bx, 8.2, bz], size: [20, 8, 0.6],
      sign: [
        { text: "Welcome to ROBLOX!", size: [1, 0.55], pos: [0, 0], tsize: 1, color: "#FFFFFF" },
        { text: "* CROSSROADS *", size: [1, 0.33], pos: [0, 0.58], tsize: 1, color: "#FFE23D" },
      ],
    }),
  ];
  // classic logo square next to the board, decal on both faces
  kids.push(part({
    name: "LogoBoard", color: BC.White, pos: [bx - 16.5, 8.2, bz], size: [7, 7, 0.5], logo: true,
    kids: [
      { cls: "Decal", name: "ClassicLogo", texture: "rbxassetid://743461071", face: FACE.Front, ref: newRef() },
      { cls: "Decal", name: "ClassicLogoBack", texture: "rbxassetid://743461071", face: FACE.Back, ref: newRef() },
    ],
  }));
  kids.push(part({ name: "LogoPost", color: BC.White, pos: [bx - 16.5, 2.2, bz], size: [0.8, 4.4, 0.8] }));
  mapKids.push(model("WelcomeSign", kids));
}

/* ---------- Stone bridge over the EW road ---------- */
{
  const X0 = -88, kids = [];
  const deckY = 6.6;                    // deck center
  kids.push(part({ name: "Deck", color: BC.Grey, mat: "Slate", studs: true, pos: [X0, deckY, 0], size: [20, 1.2, 64] }));
  // approach ramps (rotated slabs, deterministic)
  kids.push(slopeSlab({ name: "RampN", color: BC.Grey, mat: "Slate", studs: true, from: [X0, 0.3, -59.5], to: [X0, deckY + 0.3, -31.5], width: 20, thick: 1 }));
  kids.push(slopeSlab({ name: "RampS", color: BC.Grey, mat: "Slate", studs: true, from: [X0, 0.3, 59.5], to: [X0, deckY + 0.3, 31.5], width: 20, thick: 1 }));
  // railings + end posts
  for (const e of [-9.7, 9.7]) {
    kids.push(part({ name: "Rail", color: BC.DarkGrey, mat: "Slate", pos: [X0 + e, deckY + 1.6, 0], size: [0.6, 2.0, 64] }));
    for (const z of [-31.5, 31.5]) {
      kids.push(part({ name: "RailPost", color: BC.DarkGrey, mat: "Slate", pos: [X0 + e, deckY + 1.4, z], size: [1, 2.8, 1] }));
    }
  }
  // stepped corbel arch underneath (spans the road below)
  for (let k = 0; k < 4; k++) {
    const off = 8.8 - k * 1.6;
    const y = 0.9 + k * 1.27;
    for (const side of [-1, 1]) {
      kids.push(part({
        name: "Arch", color: BC.DarkGrey, mat: "Slate",
        pos: [X0 + side * off, y, 0], size: [2.4, 1.3, 62],
      }));
    }
  }
  kids.push(part({ name: "Keystone", color: BC.DarkGrey, mat: "Slate", pos: [X0, 5.97, 0], size: [10.4, 1.3, 62] }));
  // piers at both ends
  for (const z of [-34, 34]) {
    for (const e of [-8.5, 8.5]) {
      kids.push(part({ name: "Pier", color: BC.DarkGrey, mat: "Slate", pos: [X0 + e, 3, z], size: [2.2, 6, 2.2] }));
    }
  }
  mapKids.push(model("StoneBridge", kids));
}

/* ---------- Red brick two-story house (NW quadrant) ---------- */
{
  const HX = -145, HZ = -150, HW = 28, HD = 22;
  const x0 = HX - HW / 2, x1 = HX + HW / 2;
  const z0 = HZ - HD / 2, z1 = HZ + HD / 2;
  const kids = [];
  const red = BC.Red;

  // --- story 1 walls (y 0..8)
  kids.push(...wall({ axis: "z", fixed: x1, a0: z0, a1: z1, h: 8, color: red, openings: [
    { a0: -152, a1: -148, y0: 0, y1: 6 },                        // door (front, +X)
    { a0: -158, a1: -154, y0: 3, y1: 6.5, glass: true },
    { a0: -146, a1: -142, y0: 3, y1: 6.5, glass: true },
  ] }));
  kids.push(...wall({ axis: "z", fixed: x0, a0: z0, a1: z1, h: 8, color: red, openings: [
    { a0: -152, a1: -148, y0: 3, y1: 6.5, glass: true },
  ] }));
  for (const z of [z0, z1]) {
    kids.push(...wall({ axis: "x", fixed: z, a0: x0, a1: x1, h: 8, color: red, openings: [
      { a0: -148, a1: -142, y0: 3, y1: 6.5, glass: true },
    ] }));
  }
  // door + knob
  kids.push(part({ name: "Door", color: BC.Brown, pos: [x1, 3, HZ], size: [0.5, 5.9, 3.8] }));
  kids.push(ball({ name: "Knob", color: BC.Yellow, pos: [x1 + 0.3, 3, HZ - 1.3], size: [0.45, 0.45, 0.45] }));

  // --- second floor slab (with spiral-stair hole at back-left)
  const fy = 8.25;
  kids.push(part({ name: "Floor2", color: BC.Cream, pos: [HX, fy, -142], size: [28, 0.5, 6] }));
  kids.push(part({ name: "Floor2", color: BC.Cream, pos: [HX, fy, -149.5], size: [28, 0.5, 9] }));
  kids.push(part({ name: "Floor2", color: BC.Cream, pos: [-141, fy, -157.5], size: [20, 0.5, 7] }));
  kids.push(part({ name: "Floor2", color: BC.Cream, pos: [-158, fy, -157.5], size: [2, 0.5, 7] }));

  // spiral staircase (pole + 8 rotating steps)
  const px = -154, pz = -157;
  kids.push(cylinder({ name: "Pole", color: BC.DarkGrey, pos: [px, 4.25, pz], size: [8.5, 0.7, 0.7], m: ROTZ(90) }));
  for (let i = 0; i < 8; i++) {
    const a = i * 45, r = 1.75;
    kids.push(part({
      name: "Step", color: BC.Cream,
      pos: [px + r * Math.cos(D2R(a)), 1 + i * 1.0, pz + r * Math.sin(D2R(a))],
      size: [3.4, 0.4, 3.4], m: ROTY(-a),
    }));
  }

  // --- story 2 walls (y 8..16)
  kids.push(...wall({ axis: "z", fixed: x1, a0: z0, a1: z1, y0: 8, h: 8, color: red, openings: [
    { a0: -156, a1: -152, y0: 11, y1: 14.5, glass: true },
    { a0: -148, a1: -144, y0: 11, y1: 14.5, glass: true },
  ] }));
  kids.push(...wall({ axis: "z", fixed: x0, a0: z0, a1: z1, y0: 8, h: 8, color: red, openings: [
    { a0: -156, a1: -152, y0: 11, y1: 14.5, glass: true },
    { a0: -148, a1: -144, y0: 11, y1: 14.5, glass: true },
  ] }));
  for (const z of [z0, z1]) {
    kids.push(...wall({ axis: "x", fixed: z, a0: x0, a1: x1, y0: 8, h: 8, color: red, openings: [
      { a0: -148, a1: -142, y0: 11, y1: 14.5, glass: true },
    ] }));
  }

  // --- stepped gable ends + gable roof slabs (deterministic, no wedges needed)
  const gableW = [20.4, 15.8, 11.2, 6.6, 2.0];
  for (const z of [z0, z1]) {
    gableW.forEach((w, k) => {
      kids.push(part({ name: "Gable", color: red, pos: [HX, 16.55 + k * 1.1, z], size: [w, 1.1, 1] }));
    });
  }
  kids.push(slopeSlab({ name: "RoofS", color: BC.DarkGrey, from: [HX, 22.3, HZ], to: [HX, 16.2, z1 + 1.2], width: 29.6, thick: 0.7, studs: true }));
  kids.push(slopeSlab({ name: "RoofN", color: BC.DarkGrey, from: [HX, 22.3, HZ], to: [HX, 16.2, z0 - 1.2], width: 29.6, thick: 0.7, studs: true }));
  kids.push(part({ name: "Ridge", color: BC.DarkGrey, pos: [HX, 22.6, HZ], size: [29.6, 0.8, 1.6], studs: true }));
  kids.push(part({ name: "Chimney", color: red, pos: [-150, 24, HZ], size: [2.2, 7, 2.2] }));

  // --- porch
  kids.push(part({ name: "Porch", color: BC.Grey, pos: [x1 + 3, 0.2, HZ], size: [6, 0.4, 8] }));
  for (const z of [HZ - 3.6, HZ + 3.6]) {
    kids.push(part({ name: "PorchPost", color: BC.White, pos: [x1 + 5.7, 4.3, z], size: [0.6, 8.6, 0.6] }));
  }
  kids.push(part({ name: "PorchRoof", color: BC.DarkGrey, pos: [x1 + 3, 8.6, HZ], size: [6.5, 0.5, 8.6] }));

  // --- furniture
  kids.push(part({ name: "TableTop", color: BC.Brown, pos: [-140, 2.75, -155], size: [5, 0.5, 3] }));
  for (const [lx, lz] of [[-142, -156.2], [-138, -156.2], [-142, -153.8], [-138, -153.8]]) {
    kids.push(part({ name: "TableLeg", color: BC.Brown, pos: [lx, 1.25, lz], size: [0.5, 2.5, 0.5] }));
  }
  for (const cz of [-146, -149]) {
    kids.push(part({ name: "ChairSeat", color: BC.Brown, pos: [-141, 1.55, cz], size: [2.2, 0.4, 2.2] }));
    kids.push(part({ name: "ChairBack", color: BC.Brown, pos: [-142.1, 2.8, cz], size: [0.4, 2.9, 2.2] }));
  }

  // --- mailbox out front
  kids.push(part({ name: "MailPost", color: BC.DarkGrey, pos: [-126, 1.25, -143], size: [0.4, 2.5, 0.4] }));
  kids.push(part({ name: "Mailbox", color: BC.Blue, pos: [-126, 3.1, -143], size: [1.7, 1.4, 1.2] }));
  kids.push(part({ name: "MailFlag", color: BC.Red, pos: [-126, 4.0, -142.4], size: [0.2, 1.1, 0.35] }));

  mapKids.push(model("BrickHouse", kids));
}

/* ---------- Tan/beige shop building (NE quadrant) ---------- */
{
  const SX = 140, SZ = -140, SW = 30, SD = 24, SH = 9;
  const x0 = SX - SW / 2, x1 = SX + SW / 2, z0 = SZ - SD / 2, z1 = SZ + SD / 2;
  const kids = [];
  const tan = BC.Tan;

  kids.push(...wall({ axis: "z", fixed: x0, a0: z0, a1: z1, h: SH, color: tan, openings: [
    { a0: SZ - 2, a1: SZ + 2, y0: 0, y1: 6 },                    // door (faces -X toward spawn)
    { a0: SZ - 9, a1: SZ - 5, y0: 3, y1: 7, glass: true },
    { a0: SZ + 5, a1: SZ + 9, y0: 3, y1: 7, glass: true },
  ] }));
  kids.push(...wall({ axis: "z", fixed: x1, a0: z0, a1: z1, h: SH, color: tan, openings: [
    { a0: SZ - 7, a1: SZ - 3, y0: 3, y1: 7, glass: true },
    { a0: SZ + 3, a1: SZ + 7, y0: 3, y1: 7, glass: true },
  ] }));
  for (const z of [z0, z1]) {
    kids.push(...wall({ axis: "x", fixed: z, a0: x0, a1: x1, h: SH, color: tan, openings: [
      { a0: SX - 7, a1: SX - 3, y0: 3, y1: 7, glass: true },
      { a0: SX + 3, a1: SX + 7, y0: 3, y1: 7, glass: true },
    ] }));
  }
  kids.push(part({ name: "ShopDoor", color: BC.Brown, pos: [x0, 3, SZ], size: [0.5, 5.9, 3.8] }));
  kids.push(part({ name: "ShopStep", color: BC.Grey, pos: [x0 - 1.2, 0.25, SZ], size: [2.4, 0.5, 5] }));

  // flat roof + parapet
  kids.push(part({ name: "Roof", color: tan, studs: true, pos: [SX, SH + 0.5, SZ], size: [SW + 1, 1, SD + 1] }));
  for (const z of [z0, z1]) {
    kids.push(part({ name: "Parapet", color: tan, pos: [SX, SH + 1.6, z], size: [SW + 1, 1.4, 0.8] }));
  }
  for (const x of [x0, x1]) {
    kids.push(part({ name: "Parapet", color: tan, pos: [x, SH + 1.6, SZ], size: [0.8, 1.4, SD + 1] }));
  }

  // roof sign (faces the road)
  kids.push(part({ name: "SignPost", color: BC.DarkGrey, pos: [SX, SH + 2.5, SZ - 5], size: [0.5, 3, 0.5] }));
  kids.push(part({ name: "SignPost", color: BC.DarkGrey, pos: [SX, SH + 2.5, SZ + 5], size: [0.5, 3, 0.5] }));
  kids.push(part({
    name: "ShopSign", color: BC.White, pos: [SX, SH + 4.6, SZ], size: [0.6, 4, 14],
    signFace: "Left",
    sign: [{ text: "CROSSROADS SHOP", size: [1, 1], pos: [0, 0], tsize: 1, color: "#1F4FD1" }],
  }));

  // interior: counter + crates
  kids.push(part({ name: "Counter", color: BC.Grey, pos: [SX + 7, 1.75, SZ], size: [2.2, 3.5, 14] }));
  kids.push(part({ name: "Crate", color: BC.Orange, pos: [SX - 9, 1, SZ - 7], size: [2, 2, 2] }));
  kids.push(part({ name: "Crate", color: BC.Orange, pos: [SX - 9, 3, SZ - 7], size: [2, 2, 2] }));
  kids.push(part({ name: "Crate", color: BC.Orange, pos: [SX - 9, 1, SZ + 7], size: [2, 2, 2] }));

  mapKids.push(model("CornerShop", kids));
}

/* ---------- Lake with island (SW quadrant) ---------- */
{
  const PX = -140, PZ = 150;
  const kids = [];
  kids.push(cylinder({
    name: "Water", color: BC.Blue, trans: 0.4, water: true,
    pos: [PX, 0.05, PZ], size: [0.7, 46, 46], m: ROTZ(90), canCollide: true,
  }));
  // rim rocks
  for (let k = 0; k < 12; k++) {
    const a = k * 30;
    const r = 25.3;
    const rx = PX + r * Math.cos(D2R(a)), rz = PZ + r * Math.sin(D2R(a));
    kids.push(part({
      name: "Rim", color: BC.DarkGrey, mat: "Slate",
      pos: [rx, 0.6, rz], size: [3.6, 1.7, 3.2], m: ROTY(a + (k % 3) * 25),
    }));
  }
  // stepping stones
  for (const [sx, sz] of [[PX + 16, PZ - 14], [PX + 8, PZ - 7]]) {
    kids.push(cylinder({ name: "Stone", color: BC.Grey, mat: "Slate", pos: [sx, 0.15, sz], size: [0.5, 3.2, 3.2], m: ROTZ(90) }));
  }
  // little island + sand + tree
  kids.push(cylinder({ name: "Island", color: BC.Tan, pos: [PX, 0.3, PZ], size: [0.9, 9, 9], m: ROTZ(90) }));
  kids.push(pineTree(PX, PZ, 0.7, 0.75).kids[0]); // trunk only compact tree on island
  const mini = pineTree(PX, PZ, 0.7, 0.75);
  kids.push(...mini.kids.slice(1));
  mapKids.push(model("Lake", kids));
}

/* ---------- Watchtower (SE quadrant) ---------- */
{
  const TX = 150, TZ = 160, kids = [];
  for (const [ex, ez] of [[-5.5, -5.5], [5.5, -5.5], [-5.5, 5.5], [5.5, 5.5]]) {
    kids.push(part({ name: "Post", color: BC.DarkGrey, pos: [TX + ex, 20, TZ + ez], size: [1, 40, 1] }));
  }
  for (const lvl of [10.5, 20.5, 30.5]) {
    kids.push(part({ name: "Deck", color: BC.Grey, studs: true, pos: [TX, lvl, TZ], size: [12, 1, 12] }));
    for (const e of [-5.7, 5.7]) {
      kids.push(part({ name: "RailX", color: BC.DarkGrey, pos: [TX + e, lvl + 1.2, TZ], size: [0.4, 1.4, 11.4] }));
      kids.push(part({ name: "RailZ", color: BC.DarkGrey, pos: [TX, lvl + 1.2, TZ + e], size: [11.4, 1.4, 0.4] }));
    }
  }
  // top deck slightly smaller so the truss is reachable
  kids.push(part({ name: "DeckTop", color: BC.Grey, studs: true, pos: [TX, 40.5, TZ], size: [10, 1, 10] }));
  for (const e of [-4.7, 4.7]) {
    kids.push(part({ name: "RailX", color: BC.DarkGrey, pos: [TX + e, 41.7, TZ], size: [0.4, 1.4, 9.4] }));
    kids.push(part({ name: "RailZ", color: BC.DarkGrey, pos: [TX, 41.7, TZ + e], size: [9.4, 1.4, 0.4] }));
  }
  // truss ladder up the south wall (climbable - the classic shortcut to the top)
  kids.push({ cls: "TrussPart", name: "Ladder", color: BC.Grey, pos: [TX, 20, TZ + 7.1], m: I3, size: [2, 40, 2], mat: "Plastic", studs: false, trans: 0, refl: 0, anchored: true, canCollide: true, kids: [], ref: newRef() });
  // flag
  kids.push(cylinder({ name: "FlagPole", color: BC.White, pos: [TX - 4, 45, TZ - 4], size: [9, 0.5, 0.5], m: ROTZ(90) }));
  kids.push(part({ name: "Flag", color: BC.Red, pos: [TX - 1.6, 47.8, TZ - 4], size: [4.4, 2.6, 0.3] }));
  mapKids.push(model("Watchtower", kids));
}

/* ---------- Trampoline near spawn ---------- */
{
  const kids = [];
  for (const [ex, ez] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) {
    kids.push(part({ name: "Leg", color: BC.DarkGrey, pos: [28 + ex, 1, -34 + ez], size: [0.8, 2, 0.8] }));
  }
  kids.push(part({ name: "FrameN", color: BC.Blue, pos: [28, 2.25, -38.1], size: [10, 0.5, 0.8] }));
  kids.push(part({ name: "FrameS", color: BC.Blue, pos: [28, 2.25, -29.9], size: [10, 0.5, 0.8] }));
  kids.push(part({ name: "FrameE", color: BC.Blue, pos: [32.1, 2.25, -34], size: [0.8, 0.5, 10] }));
  kids.push(part({ name: "FrameW", color: BC.Blue, pos: [23.9, 2.25, -34], size: [0.8, 0.5, 10] }));
  kids.push(part({
    name: "Mat", color: BC.Black, pos: [28, 2.2, -34], size: [8.4, 0.4, 8.4],
    kids: [script("Bounce", `-- Classic trampoline bounce
local mat = script.Parent
local cooldown = {}
mat.Touched:Connect(function(hit)
	local char = hit.Parent
	if not char then return end
	local humanoid = char:FindFirstChild("Humanoid")
	local root = char:FindFirstChild("HumanoidRootPart")
	if not (humanoid and root) then return end
	local now = tick()
	if cooldown[humanoid] and now - cooldown[humanoid] < 0.4 then return end
	cooldown[humanoid] = now
	root.Velocity = Vector3.new(root.Velocity.X, 120, root.Velocity.Z)
end)`)],
  }));
  mapKids.push(model("Trampoline", kids));
}

/* ---------- Scenery: hills, trees, rocks ---------- */
{
  const kids = [];
  // big grassy slopes around the edges (rotated slabs with studded tops)
  kids.push(slopeSlab({ name: "HillN", color: BC.Green, studs: true, from: [-60, 14.5, -253], to: [-60, 0.5, -212], width: 120, thick: 2 }));
  kids.push(slopeSlab({ name: "HillNE", color: BC.Green, studs: true, from: [150, 11, -253], to: [150, 0.5, -221], width: 100, thick: 2 }));
  kids.push(slopeSlab({ name: "HillW", color: BC.Green, studs: true, from: [-253, 12, -50], to: [-212, 0.5, -50], width: 110, thick: 2 }));
  kids.push(slopeSlab({ name: "HillS", color: BC.Green, studs: true, from: [60, 13, 253], to: [60, 0.5, 214], width: 130, thick: 2 }));
  kids.push(slopeSlab({ name: "HillE", color: BC.Green, studs: true, from: [253, 10, -110], to: [221, 0.5, -110], width: 90, thick: 2 }));

  // pine trees
  const trees = [
    [-60, -180, 1.2], [-40, -120, 1], [-120, -60, 0.9], [-210, -60, 1], [-180, -30, 1.1],
    [-60, -210, 1], [60, -190, 1], [180, -60, 1.1], [200, -170, 1.2], [210, 40, 1],
    [190, 190, 1.1], [60, 210, 1], [165, 178, 0.9], [-40, 205, 1], [-200, 180, 1],
    [-65, 135, 0.9], [30, 120, 1],
  ];
  for (const [tx, tz, s] of trees) kids.push(pineTree(tx, tz, s));

  // scattered slate rocks
  const rocks = [
    [-230, -100, 5, "ball"], [-240, 60, 4, "ball"], [-100, 240, 6, "ball"], [240, 120, 4, "ball"],
    [100, -240, 5, "ball"], [-40, -240, 4, "box"], [240, -200, 6, "ball"], [-240, 220, 5, "box"],
    [180, 240, 4, "ball"], [230, 30, 3.5, "box"],
  ];
  for (const [rx, rz, r, kind] of rocks) {
    if (kind === "ball") {
      kids.push(ball({ name: "Rock", color: BC.DarkGrey, mat: "Slate", pos: [rx, r * 0.28, rz], size: [r, r, r] }));
    } else {
      kids.push(part({ name: "Rock", color: BC.DarkGrey, mat: "Slate", pos: [rx, r * 0.25, rz], size: [r * 1.3, r * 0.9, r], m: ROTY(rx % 60) }));
    }
  }
  mapKids.push(model("Scenery", kids));
}

/* ---------- Flip-safe decorative wedges (skate ramps) ---------- */
{
  const kids = [];
  // NOTE: these are pure decoration, so they look right no matter which way
  // the wedge slope faces; critical slopes above use rotated slabs instead.
  kids.push(wedge({ name: "Ramp1", color: BC.Grey, pos: [46, 2, -46], size: [10, 4, 10], m: ROTY(0) }));
  kids.push(wedge({ name: "Ramp2", color: BC.Grey, pos: [168, 2, 146], size: [10, 4, 10], m: ROTY(180) }));
  mapKids.push(model("SkateRamps", kids));
}

/* ---------- Fences, cones, other props ---------- */
{
  const kids = [];
  kids.push(...fenceRun({ axis: "x", fixed: -8.9, a0: 24, a1: 88, groundY: 0 }));
  kids.push(...fenceRun({ axis: "z", fixed: 8.9, a0: 24, a1: 56, groundY: 0 }));
  kids.push(...fenceRun({ axis: "x", fixed: -128, a0: -160, a1: -116, groundY: 0 }));  // house yard
  kids.push(...fenceRun({ axis: "z", fixed: -112, a0: 126, a1: 142, groundY: 0 }));    // pond shore

  kids.push(trafficCone(-96, -3), trafficCone(-100.5, 2), trafficCone(-104, -1));
  mapKids.push(model("Props", kids));
}

/* ---------- Explosive barrels ---------- */
const barrelCFrame = [[160, -128], [-70, 14], [-150, 172]];
{
  const kids = [];
  for (const [bx, bz] of barrelCFrame) {
    kids.push(cylinder({
      name: "Barrel", color: BC.ReallyRed, pos: [bx, 1.5, bz],
      size: [3, 2.6, 2.6], m: ROTZ(90), barrel: true,
    }));
  }
  kids.push(script("BarrelBoom", `-- Classic red explosive barrels: hit them fast and they blow
local barrels = script.Parent
local Debris = game:GetService("Debris")

local function makeExplosion(pos)
	local explosion = Instance.new("Explosion")
	explosion.Position = pos
	explosion.BlastRadius = 8
	explosion.BlastPressure = 500000
	explosion.DestroyJointRadiusPercent = 1
	explosion.Parent = workspace
end

local function arm(barrel)
	local template = barrel:Clone()
	local exploded = false
	local function boom()
		if exploded then return end
		exploded = true
		makeExplosion(barrel.Position)
		barrel.Transparency = 1
		barrel.CanCollide = false
		task.delay(30, function()
			local copy = template:Clone()
			copy.Parent = barrels
			arm(copy)
			barrel:Destroy()
		end)
	end
	barrel.Touched:Connect(function(hit)
		if exploded then return end
		if hit.Name == "Rocket" or hit.AssemblyLinearVelocity.Magnitude > 28 then
			boom()
		end
	end)
	workspace.DescendantAdded:Connect(function(obj)
		if obj:IsA("Explosion") and not exploded then
			if (obj.Position - barrel.Position).Magnitude < 9 then
				task.delay(0.15, boom) -- chain reaction
			end
		end
	end)
end

for _, barrel in pairs(barrels:GetChildren()) do
	if barrel:IsA("BasePart") and barrel.Name == "Barrel" then
		arm(barrel)
	end
end`));
  mapKids.push(model("Barrels", kids));
}

/* ---------------------------------- *
 *  Tools (classic sword + rockets)   *
 * ---------------------------------- */
function weld(a, b) {
  return { cls: "WeldConstraint", name: "WeldConstraint", ref: newRef(), partA: a, partB: b };
}

function swordTool() {
  const handle = part({ name: "Handle", color: BC.DarkGrey, pos: [0, 0.9, 0], size: [0.8, 1.6, 0.8], anchored: false });
  const guard = part({ name: "Guard", color: BC.Yellow, pos: [0, 1.85, 0], size: [2, 0.35, 0.7], anchored: false });
  const blade = part({ name: "Blade", color: BC.Grey, pos: [0, 3.7, 0], size: [1.1, 3.6, 0.35], anchored: false });
  const tool = {
    cls: "Tool", name: "Sword", ref: newRef(),
    kids: [
      handle, guard, blade,
      weld(handle, guard), weld(guard, blade),
      script("SwordScript", SWORD_LUA),
    ],
  };
  return { tool, handle };
}

function rocketLauncherTool() {
  const tube = cylinder({ name: "Handle", color: BC.DarkGrey, pos: [0, 0.9, 0], size: [4.2, 1.1, 1.1], anchored: false });
  const nozzle = cylinder({ name: "Nozzle", color: BC.Grey, pos: [-1.9, 0.9, 0], size: [0.7, 1.5, 1.5], anchored: false });
  const tip = cylinder({ name: "Tip", color: BC.ReallyRed, pos: [1.95, 0.9, 0], size: [0.6, 1.3, 1.3], anchored: false });
  const grip = part({ name: "Grip", color: BC.Brown, pos: [0.7, 0.1, 0], size: [0.5, 0.9, 0.5], anchored: false });
  const tool = {
    cls: "Tool", name: "Rocket Launcher", ref: newRef(),
    kids: [
      tube, nozzle, tip, grip,
      weld(tube, nozzle), weld(tube, tip), weld(tube, grip),
      script("RocketScript", ROCKET_LUA),
    ],
  };
  return { tool, handle: tube };
}

const SWORD_LUA = `-- Classic Linked Sword (2007 style)
local Tool = script.Parent
local Blade = Tool:WaitForChild("Blade")
local Handle = Tool:WaitForChild("Handle")

local SLASH_DAMAGE = 14
local LUNGE_DAMAGE = 30

local swinging = false
local lastSwing = 0
local recentHits = {}

local function getPlayer()
	return game:GetService("Players"):GetPlayerFromCharacter(Tool.Parent)
end

local function tag(humanoid, player)
	local creator = Instance.new("ObjectValue")
	creator.Name = "creator"
	creator.Value = player
	game:GetService("Debris"):AddItem(creator, 2)
	creator.Parent = humanoid
end

local function onActivated()
	if swinging then return end
	swinging = true
	lastSwing = tick()

	local sound = Instance.new("Sound")
	sound.SoundId = "rbxasset://sounds/swordslash.wav"
	sound.Parent = Handle
	sound:Play()
	game:GetService("Debris"):AddItem(sound, 2)

	local root = Tool.Parent and Tool.Parent:FindFirstChild("HumanoidRootPart")
	if root then
		local push = Instance.new("BodyVelocity")
		push.Velocity = root.CFrame.LookVector * 50
		push.MaxForce = Vector3.new(40000, 0, 40000)
		push.Parent = root
		game:GetService("Debris"):AddItem(push, 0.25)
	end

	wait(0.6)
	swinging = false
end

local function onTouched(hit)
	local humanoid = hit.Parent and hit.Parent:FindFirstChild("Humanoid")
	if not humanoid then return end
	if hit.Parent == Tool.Parent then return end
	if humanoid.Health <= 0 then return end

	local now = tick()
	if recentHits[humanoid] and now - recentHits[humanoid] < 0.5 then return end
	recentHits[humanoid] = now

	local damage = SLASH_DAMAGE
	if swinging and now - lastSwing < 0.35 then
		damage = LUNGE_DAMAGE
	end
	local player = getPlayer()
	if player then tag(humanoid, player) end
	humanoid:TakeDamage(damage)
end

local function onEquipped()
	local sound = Instance.new("Sound")
	sound.SoundId = "rbxasset://sounds/unsheath.wav"
	sound.Parent = Handle
	sound:Play()
	game:GetService("Debris"):AddItem(sound, 2)
end

Tool.Activated:Connect(onActivated)
Tool.Equipped:Connect(onEquipped)
Blade.Touched:Connect(onTouched)
Handle.Touched:Connect(onTouched)`;

const ROCKET_LUA = `-- Classic Rocket Launcher (2007 style)
local Tool = script.Parent
local Handle = Tool:WaitForChild("Handle")

local RELOAD_TIME = 7
local ROCKET_SPEED = 60
local loaded = true

local function getRoot()
	local char = Tool.Parent
	if not char then return nil end
	return char:FindFirstChild("HumanoidRootPart") or char:FindFirstChild("Torso")
end

local function explode(rocket)
	local explosion = Instance.new("Explosion")
	explosion.Position = rocket.Position
	explosion.BlastRadius = 8
	explosion.BlastPressure = 500000
	explosion.DestroyJointRadiusPercent = 1
	explosion.Parent = workspace
	rocket:Destroy()
end

local function fireRocket()
	local root = getRoot()
	if not root then return end

	local dir = root.CFrame.LookVector
	local pos = root.Position + dir * 5 + Vector3.new(0, 1.5, 0)

	local rocket = Instance.new("Part")
	rocket.Name = "Rocket"
	rocket.Size = Vector3.new(1, 1, 3.4)
	rocket.BrickColor = BrickColor.new("Dark stone grey")
	rocket.CFrame = CFrame.new(pos, pos + dir)
	rocket.Parent = workspace

	local tip = Instance.new("Part")
	tip.Name = "Tip"
	tip.Shape = Enum.PartType.Ball
	tip.Size = Vector3.new(1.3, 1.3, 1.3)
	tip.BrickColor = BrickColor.new("Really red")
	tip.CFrame = rocket.CFrame * CFrame.new(0, 0, -1.9)
	tip.Parent = rocket

	local weldC = Instance.new("WeldConstraint")
	weldC.Part0 = rocket
	weldC.Part1 = tip
	weldC.Parent = rocket

	local vel = Instance.new("BodyVelocity")
	vel.Velocity = dir * ROCKET_SPEED
	vel.MaxForce = Vector3.new(math.huge, math.huge, math.huge)
	vel.Parent = rocket

	local gyro = Instance.new("BodyGyro")
	gyro.CFrame = rocket.CFrame
	gyro.MaxTorque = Vector3.new(math.huge, math.huge, math.huge)
	gyro.Parent = rocket

	game:GetService("Debris"):AddItem(rocket, 10)

	local done = false
	local function onTouched(hit)
		if done then return end
		if hit:IsDescendantOf(Tool.Parent) then return end
		done = true
		explode(rocket)
	end
	rocket.Touched:Connect(onTouched)
	tip.Touched:Connect(onTouched)
end

local function onActivated()
	if not loaded then return end
	loaded = false

	local sound = Instance.new("Sound")
	sound.SoundId = "rbxasset://sounds/Rocket shot.wav"
	sound.Parent = Handle
	sound:Play()
	game:GetService("Debris"):AddItem(sound, 2)

	fireRocket()
	wait(RELOAD_TIME)
	loaded = true
end

Tool.Activated:Connect(onActivated)`;

/* Tool pads: pedestals + auto-respawn watcher */
{
  const pads = [];
  const spots = [
    { kind: "sword", pos: [153, 41, 163] },   // tower roof
    { kind: "sword", pos: [-127, 0.4, -144] },// house porch
    { kind: "rocket", pos: [-88, 7.2, 6] },   // bridge deck
    { kind: "rocket", pos: [-140, 0.75, 153] } // lake island
  ];
  for (const s of spots) {
    const { tool, handle } = s.kind === "sword" ? swordTool() : rocketLauncherTool();
    const pad = cylinder({
      name: "Pad", color: BC.DarkGrey,
      pos: [s.pos[0], s.pos[1] + 0.1, s.pos[2]], size: [0.25, 3, 3], m: ROTZ(90),
    });
    pads.push(pad);
    // stand the tool just above the pad
    const dy = s.kind === "sword" ? 1.0 : 1.3;
    tool.kids.forEach((k) => {
      if (k.pos) k.pos = [k.pos[0] + s.pos[0], k.pos[1] + s.pos[1] + dy + 0.15, k.pos[2] + s.pos[2]];
    });
    pads.push(tool);
  }
  pads.push(script("RespawnTools", `-- Picked-up tools respawn at their pad after a while (classic style)
local pads = script.Parent
local RESPAWN_TIME = 25

local function watch(tool)
	local home = tool.Handle and tool.Handle.CFrame
	local template = tool:Clone()
	tool.AncestryChanged:Connect(function(_, parent)
		if not parent then return end
		if not parent:IsDescendantOf(pads) then
			task.delay(RESPAWN_TIME, function()
				local copy = template:Clone()
				if copy:FindFirstChild("Handle") and home then
					copy.Handle.CFrame = home
				end
				copy.Parent = pads
				watch(copy)
			end)
		end
	end)
end

for _, child in pairs(pads:GetChildren()) do
	if child:IsA("Tool") then
		watch(child)
	end
end`));
  mapKids.push(model("ToolPads", pads));
}

/* ---------------------------------- *
 *  Lua: leaderboard + respawn        *
 * ---------------------------------- */
const LEADERBOARD_LUA = `-- Classic-style leaderboard and 5 second respawns
local Players = game:GetService("Players")
Players.RespawnTime = 5
Players.CharacterAutoLoads = true

local function onDied(player, humanoid)
	player.leaderstats.Wipeouts.Value = player.leaderstats.Wipeouts.Value + 1
	local tag = humanoid:FindFirstChild("creator")
	if tag and tag.Value and tag.Value:IsA("Player") then
		local stats = tag.Value:FindFirstChild("leaderstats")
		if stats then
			stats.KOs.Value = stats.KOs.Value + 1
		end
	end
end

local function onCharacter(player, char)
	local humanoid = char:WaitForChild("Humanoid", 10)
	if humanoid then
		humanoid.Died:Connect(function()
			onDied(player, humanoid)
		end)
	end
end

Players.PlayerAdded:Connect(function(player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local kos = Instance.new("IntValue")
	kos.Name = "KOs"
	kos.Parent = leaderstats

	local wipeouts = Instance.new("IntValue")
	wipeouts.Name = "Wipeouts"
	wipeouts.Parent = leaderstats

	leaderstats.Parent = player

	player.CharacterAdded:Connect(function(char)
		onCharacter(player, char)
	end)
end)`;

/* ---------------------------------- *
 *  rbxlx writer                      *
 * ---------------------------------- */
function xesc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function cdata(s) {
  if (s.includes("]]>") ) throw new Error("Lua source contains ]]> - rework the script text");
  return `<![CDATA[${s}]]>`;
}
const F = (n) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(5)));

function propStrings(rec) {
  const p = [];
  p.push(`<string name="Name">${xesc(rec.name)}</string>`);
  if (rec.cls === "Script") {
    p.push(`<ProtectedString name="Source">${cdata(rec.source)}</ProtectedString>`);
    return p;
  }
  if (rec.cls === "Model" || rec.cls === "Tool") return p;
  if (rec.cls === "Decal") {
    p.push(`<Content name="Texture"><url>${xesc(rec.texture)}</url></Content>`);
    p.push(`<token name="Face">${rec.face}</token>`);
    return p;
  }
  if (rec.cls === "WeldConstraint") {
    p.push(`<Ref name="Part0">${rec.partA.ref}</Ref>`);
    p.push(`<Ref name="Part1">${rec.partB.ref}</Ref>`);
    return p;
  }
  // BasePart-ish records
  if (rec.size) {
    p.push(`<bool name="Anchored">${rec.anchored}</bool>`);
    p.push(`<bool name="CanCollide">${rec.canCollide}</bool>`);
    p.push(`<int name="BrickColor">${rec.color.i}</int>`);
    const m = rec.m;
    p.push(
      `<CoordinateFrame name="CFrame">` +
      `<X>${F(rec.pos[0])}</X><Y>${F(rec.pos[1])}</Y><Z>${F(rec.pos[2])}</Z>` +
      `<R00>${F(m[0])}</R00><R01>${F(m[1])}</R01><R02>${F(m[2])}</R02>` +
      `<R10>${F(m[3])}</R10><R11>${F(m[4])}</R11><R12>${F(m[5])}</R12>` +
      `<R20>${F(m[6])}</R20><R21>${F(m[7])}</R21><R22>${F(m[8])}</R22>` +
      `</CoordinateFrame>`
    );
    p.push(`<token name="Material">${MAT[rec.mat]}</token>`);
    if (rec.shape && rec.shape !== "Block") {
      p.push(`<token name="shape">${rec.shape === "Ball" ? 0 : 2}</token>`);
    }
    p.push(`<Vector3 name="size"><X>${F(rec.size[0])}</X><Y>${F(rec.size[1])}</Y><Z>${F(rec.size[2])}</Z></Vector3>`);
    if (rec.studs) {
      p.push(`<token name="TopSurface">${SURF.Studs}</token>`);
      p.push(`<token name="BottomSurface">${SURF.Inlet}</token>`);
    } else {
      p.push(`<token name="TopSurface">${SURF.Smooth}</token>`);
      p.push(`<token name="BottomSurface">${SURF.Smooth}</token>`);
    }
    if (rec.trans) p.push(`<float name="Transparency">${F(rec.trans)}</float>`);
    if (rec.refl) p.push(`<float name="Reflectance">${F(rec.refl)}</float>`);
    if (rec.cls === "SpawnLocation") {
      p.push(`<bool name="Neutral">true</bool>`);
      p.push(`<int name="TeamColor">1</int>`);
      p.push(`<int name="Duration">10</int>`);
      p.push(`<bool name="AllowTeamChangeOnTouch">false</bool>`);
    }
  }
  if (rec.sign) {
    // emitted as child items below; nothing here
  }
  return p;
}

function signItems(rec) {
  if (!rec.sign) return [];
  const gui = {
    cls: "SurfaceGui", name: "SignGui", ref: newRef(), rawProps: [
      `<token name="Face">${FACE[rec.signFace]}</token>`,
    ],
    kids: rec.sign.map((line, i) => ({
      cls: "TextLabel", name: `Line${i + 1}`, ref: newRef(), rawProps: [
        `<float name="BackgroundTransparency">1</float>`,
        `<string name="Text">${xesc(line.text)}</string>`,
        `<Color3 name="TextColor3"><R>${hexR(line.color)}</R><G>${hexG(line.color)}</G><B>${hexB(line.color)}</B></Color3>`,
        `<bool name="TextScaled">true</bool>`,
        `<token name="Font">2</token>`, // ArialBold
        `<UDim2 name="Size"><XS>${line.size[0]}</XS><XO>0</XO><YS>${line.size[1]}</YS><YO>0</YO></UDim2>`,
        `<UDim2 name="Position"><XS>${line.pos[0]}</XS><XO>0</XO><YS>${line.pos[1]}</YS><YO>0</YO></UDim2>`,
      ], kids: [],
    })),
  };
  return [gui];
}
const hexC = (h, a, b) => (parseInt(h.slice(a, b), 16) / 255).toFixed(4);
const hexR = (h) => hexC(h, 1, 3), hexG = (h) => hexC(h, 3, 5), hexB = (h) => hexC(h, 5, 7);

function emitItem(rec, depth) {
  const pad = "\t".repeat(depth);
  const props = rec.rawProps ? [...(rec.rawNameFirst === false ? [] : [`<string name="Name">${xesc(rec.name)}</string>`]), ...rec.rawProps] : propStrings(rec);
  const allKids = [...(rec.kids || []), ...signItems(rec)];
  let xml = `${pad}<Item class="${rec.cls}" referent="${rec.ref}">\n${pad}\t<Properties>\n`;
  xml += props.map((l) => `${pad}\t\t${l}\n`).join("");
  xml += `${pad}\t</Properties>\n`;
  for (const k of allKids) xml += emitItem(k, depth + 1);
  xml += `${pad}</Item>\n`;
  return xml;
}

/* Lighting tree */
const skyUrl = (f) => `<Content name="${f}"><url>rbxasset://textures/sky/${f === "SkyboxUp" ? "sky512_up.tex" : f === "SkyboxDn" ? "sky512_dn.tex" : f === "SkyboxFt" ? "sky512_ft.tex" : f === "SkyboxBk" ? "sky512_bk.tex" : f === "SkyboxLf" ? "sky512_lf.tex" : "sky512_rt.tex"}</url></Content>`;
const lightingItem = {
  cls: "Lighting", name: "Lighting", ref: newRef(), rawProps: [
    `<Color3 name="Ambient"><R>0.5</R><G>0.5</G><B>0.5</B></Color3>`,
    `<double name="Brightness">1</double>`,
    `<double name="ClockTime">14</double>`,
    `<double name="GeographicLatitude">41.733</double>`,
    `<bool name="GlobalShadows">false</bool>`,
    `<Color3 name="OutdoorAmbient"><R>0.5</R><G>0.5</G><B>0.5</B></Color3>`,
    `<string name="TimeOfDay">14:00:00</string>`,
    `<token name="Technology">0</token>`, // Legacy
  ],
  kids: [{
    cls: "Sky", name: "Sky", ref: newRef(), rawProps: [
      skyUrl("SkyboxBk"), skyUrl("SkyboxDn"), skyUrl("SkyboxFt"),
      skyUrl("SkyboxLf"), skyUrl("SkyboxRt"), skyUrl("SkyboxUp"),
    ], kids: [],
  }],
};

const workspaceItem = {
  cls: "Workspace", name: "Workspace", ref: newRef(), rawProps: [
    `<bool name="FilteringEnabled">true</bool>`,
    `<bool name="StreamingEnabled">false</bool>`,
  ],
  kids: [
    { cls: "Terrain", name: "Terrain", ref: newRef(), rawProps: [`<bool name="Anchored">true</bool>`], kids: [] },
    ...mapKids,
  ],
};

const serverScriptService = {
  cls: "ServerScriptService", name: "ServerScriptService", ref: newRef(), rawProps: [],
  kids: [script("Leaderboard", LEADERBOARD_LUA)],
};

/* Full document */
const doc =
  `<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n` +
  `<External>null</External>\n<External>nil</External>\n` +
  emitItem(workspaceItem, 0) +
  emitItem(lightingItem, 0) +
  emitItem(serverScriptService, 0) +
  `</roblox>\n`;

/* ---------------------------------- *
 *  map.json for the web preview      *
 * ---------------------------------- */
function collectPrims(rec, out) {
  if (rec.size && rec.cls !== "SpawnLocation") {
    out.push({
      k: rec.wedge ? "wedge" : rec.shape === "Cylinder" ? "cyl" : rec.shape === "Ball" ? "ball" : "box",
      p: rec.pos.map((v) => +v.toFixed(4)),
      s: rec.size,
      m: rec.m === I3 ? undefined : rec.m.map((v) => +v.toFixed(5)),
      c: rec.color.h,
      tr: rec.trans || 0,
      studs: rec.studs || undefined,
      water: rec.water || undefined,
      slate: rec.mat === "Slate" || undefined,
      sign: rec.sign,
      signFace: rec.sign ? rec.signFace : undefined,
      logo: rec.logo || undefined,
    });
  }
  if (rec.spawn) {
    out.push({ k: "spawn", p: rec.pos, s: rec.size, c: BC.White.h });
  }
  for (const k of rec.kids || []) collectPrims(k, out);
}
const prims = [];
collectPrims({ kids: mapKids }, prims);

const mapJson = JSON.stringify({
  name: "Crossroads",
  spawn: [0, 2.5, 5],
  prims,
});

/* ---------------------------------- *
 *  Write files + report              *
 * ---------------------------------- */
mkdirSync(join(ROOT, "assets"), { recursive: true });
writeFileSync(join(ROOT, "Crossroads.rbxlx"), doc);
writeFileSync(join(ROOT, "assets", "map.json"), mapJson);

let partCount = 0, scriptCount = 0;
(function count(rec) {
  if (rec.size) partCount++;
  if (rec.cls === "Script") scriptCount++;
  for (const k of rec.kids || []) count(k);
})({ kids: mapKids });

console.log(`Wrote Crossroads.rbxlx  (${(doc.length / 1024).toFixed(1)} KB)`);
console.log(`Wrote assets/map.json   (${(mapJson.length / 1024).toFixed(1)} KB, ${prims.length} primitives)`);
console.log(`Parts: ${partCount}   Scripts: ${scriptCount}`);
