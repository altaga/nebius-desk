// Millie animation engine v2.2 for three-vrm (Nebius Desk). Procedural + layered, every bone is driven through
// second-order dynamics (critically/under-damped springs) -> no pops, natural overshoot and follow-through.
// Layers (all additive, run together): idle (breath, weight shift, sway, eye wander) + gesture clip + pointing + talking + look-at.
// v2.2: kawaii reactions  m.react('shy')  (face parts + per-reaction body language, eased), and a procedural LEG layer with
// planted feet (2-bone leg IK after the bone dynamics): weight shift, breathing knee flex, foot taps, toe pivots, heel lifts /
// kicks, step turns while pointing, hops, bow knee bend.
// Usage: const m = new MillieController(vrm, {camera, scene}); per frame: m.update(dt)  (calls vrm.update itself).
import * as THREE from 'three';
export { MillieColors, EXTRA_PRESETS } from './millie_colors.js';
const D = Math.PI / 180, TAU = Math.PI * 2;
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const smoother = t => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
// ------------------------------------------------------------------ second-order dynamics (t3ssel8r): f=freq Hz, z=damping, r=response (r<0 anticipates)
export class SOD {
  constructor(f, z, r, x0) { this.set(f, z, r); this.xp = x0.slice(); this.y = x0.slice(); this.yd = x0.map(() => 0); }
  set(f, z, r) { this.k1 = z / (Math.PI * f); this.k2 = 1 / ((TAU * f) ** 2); this.k3 = r * z / (TAU * f); }
  reset(x) { this.xp = x.slice(); this.y = x.slice(); this.yd = x.map(() => 0); }
  step(dt, x) {
    if (dt <= 0) return this.y;
    const k2 = Math.max(this.k2, dt * dt / 2 + dt * this.k1 / 2, dt * this.k1);
    for (let i = 0; i < x.length; i++) {
      const xd = (x[i] - this.xp[i]) / dt; this.xp[i] = x[i];
      this.y[i] += dt * this.yd[i];
      this.yd[i] += dt * (x[i] + this.k3 * xd - this.y[i] - this.k1 * this.yd[i]) / k2;
    }
    return this.y;
  }
}
// smooth value noise (sum of incommensurate sines) -> organic idle motion
const noise = (t, s) => Math.sin(t * 0.71 + s) * 0.5 + Math.sin(t * 1.37 + s * 2.1) * 0.3 + Math.sin(t * 2.29 + s * 3.7) * 0.2;
// quaternion <-> rotation vector
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3();
function qlog(q, out = [0, 0, 0]) { let { x, y, z, w } = q; if (w < 0) { x = -x; y = -y; z = -z; w = -w; } const s = Math.hypot(x, y, z); const a = 2 * Math.atan2(s, w); const k = s < 1e-8 ? 2 : a / s; out[0] = x * k; out[1] = y * k; out[2] = z * k; return out; }
function qexp(v, q) { const a = Math.hypot(v[0], v[1], v[2]); if (a < 1e-8) return q.set(v[0] / 2, v[1] / 2, v[2] / 2, 1).normalize(); const s = Math.sin(a / 2) / a; return q.set(v[0] * s, v[1] * s, v[2] * s, Math.cos(a / 2)); }
// ------------------------------------------------------------------ rest pose + bone dynamics
const REST = { leftUpperArm: [0, 0, -70], rightUpperArm: [0, 0, 70], leftLowerArm: [0, -14, 0], rightLowerArm: [0, 14, 0], leftHand: [0, 0, -8], rightHand: [0, 0, 8],
  leftShoulder: [0, 0, 0], rightShoulder: [0, 0, 0] };
const DYN = {   // f (Hz), z, r per bone family: lower f = more lag; z<1 = overshoot; children faster but under-damped -> follow-through
  hips: [2.0, 0.9, 0], spine: [2.2, 0.85, 0], chest: [2.4, 0.8, 0], upperChest: [2.6, 0.8, 0], neck: [2.4, 0.75, 0], head: [2.0, 0.62, 0],
  Shoulder: [2.6, 0.8, 0], UpperArm: [2.6, 0.58, 0], LowerArm: [3.0, 0.5, 0], Hand: [3.6, 0.45, 0], finger: [6, 0.8, 0], UpperLeg: [3, 0.85, 0], LowerLeg: [3, 0.85, 0], Foot: [3, 0.9, 0], eye: [10, 1, 0] };
const dynFor = n => DYN[n] || (/(Thumb|Index|Middle|Ring|Little)/.test(n) ? DYN.finger : DYN[n.replace(/^(left|right)/, '')] || [3, 0.85, 0]);
const FINGERS = ['Index', 'Middle', 'Ring', 'Little'];
function fingerPose(out, side, curl, indexCurl = curl, spread = 0) {
  const s = side === 'left' ? -1 : 1;
  FINGERS.forEach((f, i) => { for (const seg of ['Proximal', 'Intermediate', 'Distal']) { const c = (f === 'Index' ? indexCurl : curl) * (seg === 'Proximal' ? 0.9 : 1.1); add(out, side + f + seg, [0, seg === 'Proximal' ? s * spread * (i - 1.5) : 0, s * c]); } });
  add(out, side + 'ThumbProximal', [0, s * -0.35 * curl, 0]); add(out, side + 'ThumbDistal', [0, s * -0.3 * curl, 0]);
}
function add(out, b, v, w = 1) { const o = out[b] || (out[b] = [0, 0, 0]); o[0] += v[0] * w; o[1] += v[1] * w; o[2] += v[2] * w; }
// ------------------------------------------------------------------ keyframe helper with per-key easing (anticipation/overshoot are authored in the keys)
function trk(keys, t) { // keys: [[t, value(s)], ...] smoother interpolation; values number|array
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) { const [t0, a] = keys[i], [t1, b] = keys[i + 1]; if (t <= t1) { const u = smoother((t - t0) / (t1 - t0)); return Array.isArray(a) ? a.map((x, k) => x + (b[k] - x) * u) : a + (b - a) * u; } }
  return keys[keys.length - 1][1];
}
const env = (t, dur, a = 0.3, b = 0.4) => smooth(t / a) * smooth((dur - t) / b);   // gesture envelope (fade in/out)
// ------------------------------------------------------------------ gestures: fn(t, P) writes additive euler (deg) offsets, arm IK targets (body space, arm lengths), hips offset, expressions
export const CLIPS = {
  idle: { dur: Infinity, loop: true, fn() {} },
  wave: { dur: 2.8, fn(t, P) {
      const w = env(t, 2.8, 0.35, 0.5), ph = Math.max(0, t - 0.45), osc = Math.sin(ph * TAU * 2.2) * smooth(ph / 0.3) * smooth((2.4 - t) / 0.4);
      const ant = Math.sin(clamp(t / 0.3, 0, 1) * Math.PI) * 0.15;   // anticipation dip
      P.arm('right', [-0.62 - osc * 0.12, 1.02 - ant + Math.abs(osc) * 0.03, 0.22], w);
      P.rot('rightHand', [0, 0, -osc * 24], w); P.rot('rightLowerArm', [0, osc * 10, 0], w);   // wrist + forearm follow-through
      P.rot('spine', [0, -4, -4 + ant * 20], w); P.rot('chest', [0, -3, -2], w); P.rot('head', [0, -8 + osc * 2, -10 + osc * 3], w);
      P.hips([0, Math.abs(osc) * 0.006 - ant * 0.04, 0], w); P.expr('happy', 0.8 * w); P.fingers('right', 4, 4, 6, w);
    } },
  nod: { dur: 1.5, fn(t, P) {
      const p = trk([[0, 0], [0.12, -5], [0.32, 16], [0.52, -3], [0.72, 11], [0.95, -1], [1.2, 0]], t);
      P.rot('head', [p, 0, 0]); P.rot('neck', [p * 0.4, 0, 0]); P.rot('spine', [p * 0.1, 0, 0]); P.hips([0, -Math.max(0, p) * 0.0008, 0]);
      P.expr('relaxed', 0.55 * env(t, 1.5, 0.25, 0.4));
    } },
  shake: { dur: 1.7, fn(t, P) {
      const w = env(t, 1.7, 0.15, 0.4); const y = Math.sin(Math.max(0, t - 0.1) * TAU * 2.3) * 19 * Math.exp(-Math.max(0, t - 0.1) * 1.4) * smooth(t / 0.15);
      P.rot('head', [3 * w, y, -y * 0.15]); P.rot('neck', [0, y * 0.3, 0]); P.rot('chest', [0, -y * 0.12, 0]); P.expr('sad', 0.35 * w);
    } },
  thinking: { dur: 3.6, fn(t, P) {
      const w = env(t, 3.6, 0.55, 0.6), tap = Math.max(0, Math.sin(t * TAU * 1.6)) ** 2 * smooth((t - 0.9) / 0.3) * smooth((3.0 - t) / 0.3);
      P.arm('right', [-0.06, 0.40, 0.58], w); P.arm('left', [-0.04, -0.42, 0.5], w * 0.9);
      P.fingers('right', 55, 55 - tap * 30, 0, w); P.rot('head', [-5 + Math.sin(t * 1.3) * 2, 9, 13 + Math.sin(t * 0.9) * 2], w); P.rot('spine', [0, 4, 3], w);
      P.hips([0.008, 0, 0], w); P.expr('Thinking', 0.8 * w); P.look([0.35, 0.45], w);
    } },
  celebrate: { dur: 2.6, fn(t, P) {
      const w = env(t, 2.6, 0.2, 0.45);
      const hop = trk([[0, 0], [0.18, -0.035], [0.38, 0.05], [0.55, -0.02], [0.75, -0.03], [0.95, 0.045], [1.12, -0.02], [1.35, 0], [2.6, 0]], t);   // crouch -> jump -> squash land x2
      const crouch = Math.max(0, -hop) / 0.035;
      P.hips([0, hop, 0], w); const air = Math.max(0, hop - 0.004);   // crouch = hips down with planted feet (IK bends the knees); airborne = feet follow
      for (const s of ['left', 'right']) P.foot(s, [0, air, 0, air * 260, 0], w);
      const pump = Math.sin(Math.max(0, t - 0.35) * TAU * 1.7) * smooth((t - 0.3) / 0.2);
      P.arm('right', [-0.6, 1.4 + pump * 0.1 - crouch * 0.3, 0.12], w); P.arm('left', [0.6, 1.4 - pump * 0.1 - crouch * 0.3, 0.12], w);
      P.fingers('right', 70, 70, 0, w); P.fingers('left', 70, 70, 0, w);
      P.rot('spine', [-6 + crouch * 10, 0, pump * 3], w); P.rot('head', [-8 + crouch * 8 - hop * 60, 0, -pump * 4], w); P.expr('happy', w);
    } },
  bow: { dur: 2.8, fn(t, P) {
      const b = trk([[0, 0], [0.2, -4], [0.75, 26], [1.7, 26], [2.25, -3], [2.5, 0]], t), w = env(t, 2.8, 0.2, 0.5);
      P.rot('spine', [b, 0, 0]); P.rot('chest', [b * 0.5, 0, 0]); P.rot('head', [b * 0.45, 0, 0]); P.hips([0, -Math.max(0, b) * 0.00045, -b * 0.0006]);   // knees bend (IK) as she bows
      P.arm('right', [-0.1, -0.78, 0.34], w); P.arm('left', [0.1, -0.78, 0.34], w); P.expr('relaxed', 0.8 * w);
    } },
  // QA-only extremes (not demo buttons)
  qa_armsUp: { dur: 1.6, fn(t, P) { P.arm('right', [-0.65, 1.6, 0.1]); P.arm('left', [0.65, 1.6, 0.1]); } },
  qa_across: { dur: 1.6, fn(t, P) { P.arm('right', [0.45, 0.15, 0.4]); P.arm('left', [-0.45, 0.15, 0.4]); } },
  qa_bendTilt: { dur: 1.6, fn(t, P) { P.rot('spine', [30, 0, 15]); P.rot('chest', [15, 20, 0]); P.rot('head', [-15, 30, 20]); } },
  qa_fastShake: { dur: 1.3, fn(t, P) { const s = Math.sign(Math.sin(t * TAU * 3.3)) * (t < 1 ? 1 : 0); P.rot('hips', [0, 45 * s, 0]); P.rot('head', [20 * s, 30 * s, 0]); } },
};
export const DEMO_CLIPS = ['idle', 'wave', 'nod', 'shake', 'thinking', 'celebrate', 'bow'];

// ------------------------------------------------------------------ kawaii reactions: face = VRM expressions (p_* parts, toggles, groups) + raw morphs (m:),
// body(t, P, w, R) = per-reaction body language (same additive API as clips, plus P.foot for the leg layer). Eased in/out.
const sn = (t, f, ph = 0) => Math.sin(t * TAU * f + ph);
const ARM = {
  // Keep hands clear of each other — tight ±0.07 targets crossed the sleeve meshes on this chibi.
  clasp: P => { P.arm('right', [-0.30, -0.68, 0.22]); P.arm('left', [0.30, -0.68, 0.22]); P.fingers('right', 28, 28, 2); P.fingers('left', 28, 28, 2); },
  cheeks: P => { P.arm('right', [-0.2, 0.52, 0.44]); P.arm('left', [0.2, 0.52, 0.44]); P.fingers('right', 20, 20, 4); P.fingers('left', 20, 20, 4); },
  fists: (P, k = 0) => { P.arm('right', [-0.3, 0.02 + k, 0.55]); P.arm('left', [0.3, 0.02 + k, 0.55]); P.fingers('right', 85, 85, 0); P.fingers('left', 85, 85, 0); },
  eyes: P => { P.arm('right', [-0.12, 0.66, 0.46]); P.arm('left', [0.12, 0.66, 0.46]); P.fingers('right', 50, 50, 0); P.fingers('left', 50, 50, 0); },
  crossed: P => { P.arm('right', [0.2, -0.08, 0.42]); P.arm('left', [-0.2, -0.04, 0.46]); P.fingers('right', 30, 30, 0); P.fingers('left', 30, 30, 0); },
  paws: P => { P.arm('right', [-0.15, 0.32, 0.56]); P.arm('left', [0.15, 0.32, 0.56]); P.fingers('right', 70, 70, 0); P.fingers('left', 70, 70, 0); },
  startle: P => { P.arm('right', [-0.32, 0.42, 0.48]); P.arm('left', [0.32, 0.42, 0.48]); P.fingers('right', 0, 0, 10); P.fingers('left', 0, 0, 10); },
  down: P => { P.arm('right', [-0.36, -0.78, 0.16]); P.arm('left', [0.36, -0.78, 0.16]); P.fingers('right', 85, 85, 0); P.fingers('left', 85, 85, 0); },
};
const kick = (t, P, side, f = 0.55) => {   // heel-lift / foot-kick back, alternating, smooth
  const u = (t * f) % 1, k = Math.sin(clamp(u / 0.45, 0, 1) * Math.PI) ** 2; P.foot(side, [0, 0.032 * k, -0.03 * k, 38 * k, 0]); };
export const REACTIONS = {
  neutral: { face: {}, body() {} },
  happy: { face: { 'm:Fcl_EYE_Joy': 1, p_mouth_smile_tongue: 1, p_brow_happy: 1, p_fx_blush: 1 },
    // Face + soft sway only — no arm IK (bringing hands in front crossed the jacket sleeves).
    body(t, P) { const sw = sn(t, 0.45); P.rot('head', [-2, 0, 4 * sw]); P.rot('spine', [-1, 0, 1.2 * sw]); P.hips([0.003 * sw, 0, 0]);
      const bob = Math.max(0, Math.sin(Math.max(0, t - 0.35) * TAU * 0.55)) ** 2 * 0.35;
      P.foot(sw > 0 ? 'right' : 'left', [0, 0.006 * bob, 0, 6 * bob, 0]); } },
  excited: { face: { p_eye_star: 1, p_mouth_grin: 1, p_brow_surprised: 1, p_fx_sparkles: 1, p_fx_blush: 1 },
    body(t, P) { const ph = Math.max(0, t - 0.25) * TAU * 1.6, b = Math.sin(ph), up = Math.max(0, b) ** 2 * 0.024, dn = Math.max(0, -b) ** 2 * 0.010;   // bouncy hops
      P.hips([0, up - dn, 0]); for (const sd of ['left', 'right']) P.foot(sd, [0, Math.max(0, up - 0.003), 0, up * 400, 0]);
      ARM.fists(P, 0.12 + up * 3); P.rot('head', [-6 + dn * 300, 0, 0]); P.rot('spine', [-4 + dn * 200, 0, 0]); } },
  love: { face: { p_eye_heart: 1, p_mouth_cat: 1, p_brow_happy: 1, p_fx_hearts: 1, p_fx_blush_strong: 1 },
    body(t, P) { ARM.cheeks(P); const sw = sn(t, 0.45); P.rot('head', [0, 0, 9 * sw]); P.rot('spine', [0, 0, 3 * sw]); P.hips([0.006 * sw, 0, 0]);
      P.foot(sw > 0 ? 'right' : 'left', [0, 0.004 * Math.abs(sw), 0, 22 * Math.abs(sw), 0]); } },
  shy: { face: { p_eye_teary: 1, p_mouth_wobble: 1, p_brow_sad: 1, p_fx_blush_strong: 1 },
    body(t, P) { ARM.clasp(P); P.rot('head', [12, -8, 7]); P.rot('neck', [5, 0, 0]); P.rot('spine', [4, 0, 0]);
      P.rot('leftShoulder', [0, -9, 7]); P.rot('rightShoulder', [0, 9, -7]); P.look([0.25, -0.35], 1);   // shoulders in, head down, glance aside
      const tw = Math.sin(t * TAU * 0.7) * smooth((t - 0.6) / 0.4); P.foot('right', [0.006, 0, 0.012, 14, -16 + 10 * tw]); P.foot('left', [-0.004, 0, 0, 0, 6]); } },   // toe twist, knees in
  flustered: { face: { p_eye_spiral: 1, p_mouth_wobble: 1, p_brow_sad: 1, p_fx_blush_strong: 1, p_fx_sweat: 1 },
    body(t, P) { const j = sn(t, 3.1), k = sn(t, 2.3, 1); P.arm('right', [-0.32, 0.38 + 0.08 * j, 0.5]); P.arm('left', [0.32, 0.38 - 0.08 * j, 0.5]); P.fingers('right', 0, 0, 12); P.fingers('left', 0, 0, 12);
      P.rot('head', [4, 10 * k, 4 * j]); P.rot('spine', [0, 4 * k, 0]); P.foot(j > 0 ? 'left' : 'right', [0, 0.006 * Math.abs(j), 0, 16 * Math.abs(j), 0]); } },
  surprised: { face: { p_eye_tiny: 1, p_mouth_o: 1, p_brow_surprised: 1, p_fx_sweat: 1 },
    body(t, P) { const st = trk([[0, 0], [0.12, 1], [0.35, -0.3], [0.6, 0.1], [0.9, 0]], t);   // startle hop back + settle
      ARM.startle(P); P.rot('spine', [-7, 0, 0]); P.rot('head', [-6 - 4 * st, 0, 0]); P.hips([0, 0.016 * Math.max(0, st) - 0.004, -0.012 * smooth(t / 0.3)]);
      for (const sd of ['left', 'right']) P.foot(sd, [0, 0.012 * Math.max(0, st), -0.012 * smooth(t / 0.3), 10 * Math.max(0, st), 0]); } },
  angry: { face: { p_eye_angry: 1, p_mouth_pout: 1, p_brow_angry: 1, CheekPuff: 1, p_fx_vein: 1, p_fx_puff: 1 },
    body(t, P) { ARM.down(P); P.rot('spine', [5, 0, 0]); P.rot('head', [-4, 0, 0]); P.rot('leftShoulder', [0, 0, 5]); P.rot('rightShoulder', [0, 0, -5]);
      const u = (t * 0.6) % 1, st = Math.sin(clamp(u / 0.3, 0, 1) * Math.PI); P.foot('right', [0, 0.03 * st, 0.01 * st, -6 * st, 0]); P.hips([0, -0.004 * (1 - st), 0]); } },   // cute stomp
  pout: { face: { p_mouth_pout: 1, CheekPuff: 1, p_brow_angry: 1, p_fx_puff: 1 },
    body(t, P) { ARM.crossed(P); P.rot('head', [-7, 18, -5]); P.rot('spine', [0, -6, 0]); P.look([-0.4, 0.1], 1);
      const tap = Math.max(0, Math.sin(t * TAU * 2)) ** 2 * smooth((t - 0.8) / 0.3); P.foot('left', [0, 0, 0.01, -16 * tap, 0]); } },   // toe tap (pivot on heel)
  sad: { face: { p_eye_teary: 1, p_mouth_wobble: 1, p_brow_sad: 1 },
    body(t, P) { P.rot('head', [14, 0, -5]); P.rot('spine', [6, 0, 0]); P.rot('leftShoulder', [0, 0, -5]); P.rot('rightShoulder', [0, 0, 5]); ARM.clasp(P); P.hips([0, -0.004, 0]);
      P.foot('left', [0.004, 0, 0.01, 6, 12]); } },
  cry: { face: { p_eye_teary: 1, p_fx_tears: 1, p_mouth_sad: 1, p_brow_sad: 1, p_fx_blush: 1 },
    body(t, P) { ARM.eyes(P); const sob = Math.max(0, sn(t, 1.6)) ** 3; P.rot('head', [10 + 3 * sob, 0, 0]); P.rot('leftShoulder', [0, 0, 6 * sob]); P.rot('rightShoulder', [0, 0, -6 * sob]); P.hips([0, -0.004 - 0.003 * sob, 0]); } },
  sleepy: { face: { p_eye_sleepy: 1, p_mouth_o: 0.7, p_brow_sad: 1 },
    body(t, P) { const d = sn(t, 0.18); P.rot('head', [10 + 6 * Math.max(0, d), 0, 12 * d]); P.rot('spine', [3, 0, 3 * d]); P.hips([0.006 * d, -0.005, 0]); ARM.clasp(P); } },
  relaxed: { face: { 'm:Fcl_EYE_Close': 1, p_mouth_small_smile: 1, p_brow_happy: 1, p_fx_blush: 1 },
    body(t, P) { const d = sn(t, 0.22); P.rot('head', [-2, 0, 6 * d]); P.hips([0.006 * d, -0.002, 0]); P.foot(d > 0 ? 'right' : 'left', [0, 0, 0, 8 * Math.abs(d), 0]); } },
  wink: { face: { Wink: 1 },
    body(t, P) { P.rot('head', [0, 6, 12]); P.arm('right', [-0.3, 0.62, 0.42]); P.fingers('right', 70, 5, 14); kick(Math.max(0, t - 0.3), P, 'left', 0.4); } },
  thinking: { face: { p_mouth_hmm: 1, p_brow_surprised: 0.7, p_brow_determined: 0.3 },
    body(t, P) { P.arm('right', [-0.06, 0.4, 0.58]); P.arm('left', [-0.04, -0.42, 0.5], 0.9); P.fingers('right', 55, 55, 0); P.look([0.35, 0.5], 1);
      P.rot('head', [-6, 8, 12]); const tap = Math.max(0, Math.sin(t * TAU * 1.5)) ** 2 * smooth((t - 1) / 0.3); P.foot('right', [0, 0, 0.01, -14 * tap, 0]); } },
  determined: { face: { p_eye_determined: 1, p_mouth_teeth: 1, p_brow_determined: 1 },
    body(t, P) { const pump = trk([[0, 0], [0.25, -0.2], [0.45, 1], [0.7, 0.85], [1.2, 0.9]], t); ARM.fists(P, 0.05 + 0.1 * pump); P.rot('spine', [6, 0, 0]); P.rot('head', [3 - 6 * pump, 0, 0]);
      P.foot('left', [0.012, 0, 0.018, 0, 6]); P.foot('right', [-0.012, 0, -0.01, 0, -6]); P.hips([0, -0.006, 0.004]); } },   // wider, firm stance
  smug: { face: { Smug: 1 },
    body(t, P) { P.rot('head', [-8, -8, -6]); P.arm('right', [-0.5, -0.32, -0.04]); P.fingers('right', 40, 40, 0); P.hips([-0.012, 0, 0]); P.foot('left', [0.006, 0, 0.02, 10, 14]); } },
  laugh: { face: { p_eye_squeeze: 1, p_mouth_grin: 1, p_brow_happy: 1, p_fx_blush: 1 },
    body(t, P) { const h = Math.abs(sn(t, 2.6)) * smooth(t / 0.3); P.rot('spine', [-6, 0, 0]); P.rot('head', [-10 + 4 * h, 0, 0]); P.rot('leftShoulder', [0, 0, 5 * h]); P.rot('rightShoulder', [0, 0, -5 * h]);
      P.hips([0, -0.006 * h, 0]); P.arm('right', [-0.18, -0.15, 0.5]); P.arm('left', [0.12, -0.3, 0.45]); P.fingers('right', 70, 70, 0); P.fingers('left', 70, 70, 0); } },   // knee bounce
  cat: { face: { 'm:Fcl_EYE_Joy': 1, p_mouth_cat: 1, p_brow_happy: 1, p_fx_blush: 1 },
    body(t, P) { ARM.paws(P); P.rot('head', [0, 0, 12 + 3 * sn(t, 0.6)]); P.hips([0.004 * sn(t, 0.6), 0, 0]); kick(t, P, 'right', 0.45); } },
  apologetic: { face: { 'm:Fcl_EYE_Joy': 1, p_mouth_small_smile: 1, p_brow_sad: 1, p_fx_sweat: 1 },
    body(t, P) { P.arm('right', [-0.28, 1.0, -0.06]); P.fingers('right', 20, 20, 4); P.rot('head', [9, 0, -10]); P.rot('spine', [8, 0, 0]); P.hips([0, -0.005, -0.004]);
      P.foot('left', [0, 0, 0.012, 0, 10 + 8 * sn(t, 0.5)]); } },   // hand behind head, little bow, toe pivot
};
for (const [a, b] of [['joy', 'happy'], ['wow', 'excited'], ['heart', 'love'], ['embarrassed', 'shy'], ['angryCute', 'angry'], ['hmm', 'thinking'], ['tired', 'sleepy'], ['sorry', 'apologetic'], ['proud', 'smug']]) REACTIONS[a] = REACTIONS[b];
export const REACTION_NAMES = Object.keys(REACTIONS);
// ------------------------------------------------------------------ text -> viseme track with coarticulation
const VMAP = { a: 'aa', á: 'aa', e: 'ee', é: 'ee', i: 'ih', í: 'ih', y: 'ih', o: 'oh', ó: 'oh', u: 'ou', ú: 'ou', w: 'ou' };
export function textToVisemes(text, cps = 13) {
  const out = []; let t = 0.05; const dt = 1 / cps;
  for (const ch of text.toLowerCase()) {
    if (VMAP[ch]) { out.push([t, VMAP[ch], 1, dt * 1.6]); t += dt; }
    else if (/[bmp]/.test(ch)) { out.push([t, 'close', 1, dt * 0.8]); t += dt * 0.7; }
    else if (/[fv]/.test(ch)) { out.push([t, 'ih', 0.3, dt]); t += dt * 0.7; }
    else if (/[a-zñ]/.test(ch)) { out.push([t, 'ih', 0.22, dt]); t += dt * 0.55; }
    else if (/[,;:]/.test(ch)) t += dt * 2.5; else if (/[.!?]/.test(ch)) t += dt * 4.5; else t += dt * 0.5;
  }
  return { track: out, dur: t + 0.25 };
}
// ------------------------------------------------------------------ controller
export class MillieController {
  constructor(vrm, opts = {}) {
    this.vrm = vrm; this.h = vrm.humanoid; this.em = vrm.expressionManager; this.camera = opts.camera; this.scene = opts.scene || vrm.scene;
    this.s0 = vrm.meta?.metaVersion === '0' ? -1 : 1;   // VRM0 normalized rig faces -Z (left=-X); authored facing +Z
    this.time = 0; this.gest = [];   // active gestures [{name,t,w,fadeOut}]
    this.expr = {}; this.exprT = {}; this.exprDyn = {}; this.talk = null; this.audio = null;
    this.point = null; this.pointT = 0; this.pointW = 0; this.lookTarget = null; this.onClipEnd = null;
    this.blink = { next: 1.5 + Math.random() * 2, t: -1, double: false, w: 0 };
    this.names = Object.keys(this.h.humanBones).filter(n => this.bone(n));
    this.restQ = {}; this.dyn = {}; this.hipsRest = this.bone('hips').position.clone();
    for (const n of this.names) { this.restQ[n] = this.bone(n).quaternion.clone(); const [f, z, r] = dynFor(n); this.dyn[n] = new SOD(f, z, r, [0, 0, 0]); }
    this.hipsDyn = new SOD(2.2, 0.7, 0, [0, 0, 0]);
    this.vis = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 }; this.visDyn = new SOD(9, 0.75, 0, [0, 0, 0, 0, 0]);
    this.lookObj = new THREE.Object3D(); this.scene.add(this.lookObj); this.eyeDyn = new SOD(7, 0.95, 0, [0, 0, 0]); this.headLook = new SOD(1.5, 0.8, 0, [0, 0]);
    this.sacc = { next: 0.5, off: [0, 0] }; this.wander = { next: 2, tgt: [0, 0] }; this.talkEnergy = 0; this.beat = { next: 1.2, t: -1, side: 'left' };
    this.armLen = this._armLength(); this.pointDyn = new SOD(3.4, 0.92, 0, [0, 0, 0]);   // critically damped — no buzz on target updates
    if (vrm.lookAt) { vrm.lookAt.target = this.lookObj; vrm.lookAt.autoUpdate = true; }
    // Blended + z-writing face cards: fully transparent texels still write depth and punch square holes in the eye layers behind them.
    vrm.scene.traverse(o => { for (const m of [].concat(o.material || [])) if (m.transparent && m.depthWrite && !m.alphaTest) { m.alphaTest = 0.02; m.needsUpdate = true; } });
    // v2.2 legs: rest ankle / toe / heel in rig-root space, foot-target dynamics (x,y,z m, pitch deg (+ = heel up about the toe, - = toe up about the heel), yaw deg)
    this.legRest = {}; this.legDyn = {}; const root = this.bone('hips').parent; root.updateMatrixWorld(true); const rl = n => root.worldToLocal(this.bone(n).getWorldPosition(new THREE.Vector3()));
    for (const sd of ['left', 'right']) { if (!this.bone(sd + 'Foot')) continue; const an = rl(sd + 'Foot'), toe = this.bone(sd + 'Toes') ? rl(sd + 'Toes') : an.clone().add(new THREE.Vector3(0, -0.07, 0.045 * this.s0));
      const heel = new THREE.Vector3(an.x, toe.y, an.z - (toe.z - an.z) * 0.8); const up = rl(sd + 'UpperLeg'), kn = rl(sd + 'LowerLeg');
      this.legRest[sd] = { an, toe, heel, l1: up.distanceTo(kn), l2: kn.distanceTo(an) }; this.legDyn[sd] = new SOD(3.4, 0.62, 0, [0, 0, 0, 0, 0]); }
    this.legEv = { tap: { next: 5 + Math.random() * 5, t: -1, side: 'right' }, piv: { next: 9 + Math.random() * 6, t: -1, side: 'left', dir: 1 } };
    this.reacts = []; this.reaction = 'neutral'; this.mouthGate = new SOD(4, 1, 0, [1]); this.rawDyn = {}; this.raw = {};
    this.legsEnabled = opts.legs !== false;
    this._first = true;
  }
  bone(n) { return this.h.getNormalizedBoneNode(n); }
  _armLength() { const p = n => this.bone(n)?.getWorldPosition(new THREE.Vector3()); const s = p('rightUpperArm'), e = p('rightLowerArm'), w = p('rightHand'); return s && e && w ? s.distanceTo(e) + e.distanceTo(w) : 0.3; }
  // ---- public API
  play(name, { fade = 0.3 } = {}) {
    if (!CLIPS[name]) throw new Error('unknown clip ' + name);
    for (const g of this.gest) g.fadeOut = g.fadeOut ?? fade;   // everything else fades out (envelopes + bone dynamics -> no pop)
    if (name !== 'idle') this.gest.push({ name, t: 0, fadeIn: fade });
    this.clip = name;
  }
  get playing() { return this.gest.filter(g => g.fadeOut == null).map(g => g.name)[0] || 'idle'; }
  /** True while a non-idle clip, reaction, point, or talk is active — presence beats must wait. */
  get busy() {
    return this.gest.some(g => g.fadeOut == null)
      || !!this.point
      || this.reacts.some(r => r.fadeOut == null)
      || !!(this.talk || this.audio);
  }
  setExpression(name, w = 1) { this.exprT[name] = w; }
  // v2.2 kawaii reactions: millie.react('shy'), react('excited', {hold: 2.5}) (auto-returns to neutral), react('neutral'); intensity 0..1
  react(name = 'neutral', { intensity = 1, hold = null, fade = 0.35 } = {}) {
    if (!REACTIONS[name]) throw new Error('unknown reaction ' + name + ' (see REACTION_NAMES)');
    for (const r of this.reacts) r.fadeOut = r.fadeOut ?? fade;
    if (name !== 'neutral') this.reacts.push({ name, t: 0, w: 0, k: intensity, hold, fadeIn: fade, dyn: new SOD(2.2, 0.75, 0, [0]) });
    this.reaction = name; return this;
  }
  get reactions() { return REACTION_NAMES; }
  clearExpressions() { for (const k in this.exprT) this.exprT[k] = 0; }
  say(text, cps) { this.talk = { ...textToVisemes(text, cps), t: 0 }; return this.talk.dur; }
  sayAudio(analyser) { this.audio = { an: analyser, buf: new Uint8Array(analyser.frequencyBinCount) }; }
  stopTalking() { this.talk = null; this.audio = null; }
  pointAtWorld(v3, side) {
    // Ignore micro target jitter (re-measure / breath) — keeps IK from buzzing.
    if (this.point && this.point.pos.distanceToSquared(v3) < 0.0004) {
      if (side) this.point.side = side;
      return;
    }
    const fresh = !this.point;
    this.point = { pos: v3.clone(), side: side || this.point?.side || null };
    this._pointHold = null; // re-freeze after settle
    if (fresh) this.pointT = 0;
  }
  stopPointing() { this.point = null; this._pointHold = null; this._lastPoint = null; }
  lookAtWorld(v3) { this.lookTarget = v3 ? v3.clone() : null; }
  screenToWorld(x, y, rect, depthOffset = 0.25) {
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    const c = (this.bone('upperChest') || this.bone('chest')).getWorldPosition(new THREE.Vector3());
    const n = this.camera.getWorldDirection(new THREE.Vector3()).negate();
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, c.clone().addScaledVector(n, depthOffset));
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, this.camera); const hit = new THREE.Vector3();
    return ray.ray.intersectPlane(plane, hit) ? hit : c;
  }
  pointAtElement(el, canvas = document.querySelector('canvas'), side) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cr = (canvas || document.querySelector('canvas'))?.getBoundingClientRect?.();
    if (!cr || cr.width < 2 || cr.height < 2) return null;
    // Nearest edge of the UI target to Millie's chest (screen space).
    const mx = cr.left + cr.width * 0.5;
    const my = cr.top + cr.height * 0.42;
    const ax = clamp(mx, r.left + 4, r.right - 4);
    const ay = clamp(my, r.top + 4, r.bottom - 4);
    // Facing-camera: target on viewer's left → her RIGHT arm (and vice versa).
    const prefer = side || (ax < mx - 10 ? 'right' : ax > mx + 10 ? 'left' : null);
    // Desk targets live outside the tiny overlay canvas — raw NDC misses the chest plane
    // and IK + head collision fight every frame (hand "vibrates"). Map screen direction
    // into a reachable body-local point instead.
    const body = this._body();
    const L = Math.max(this.armLen || 0.35, 0.2);
    const dx = (ax - mx) / Math.max(cr.width, 1);
    const dy = (my - ay) / Math.max(cr.height, 1);
    let lx = clamp(dx * 1.55, -1.05, 1.05) * L;
    let ly = clamp(dy * 1.25, -0.55, 0.85) * L;
    let lz = Math.max(0.42 * L, 0.62 * L - Math.abs(lx) * 0.18);
    // Soft face clearance (same bias as the pointing layer).
    const sx = prefer === 'left' ? 1 : prefer === 'right' ? -1 : Math.sign(lx || 1);
    if (Math.abs(lx) < 0.3 * L && ly > 0.1 * L) {
      lx = sx * Math.max(Math.abs(lx), 0.4 * L);
      ly = Math.min(ly, 0.06 * L);
      lz = Math.max(lz, 0.45 * L);
    }
    const p = new THREE.Vector3(lx * this.s0, ly, lz * this.s0).applyQuaternion(body.q).add(body.o);
    this.pointAtWorld(p, prefer);
    return p;
  }
  // colours (see millie_colors.js); await millie.initColors() once after loading
  async initColors(url) { const { MillieColors } = await import('./millie_colors.js'); this.colors = await MillieColors.load(this.vrm, url); return this.colors; }
  setColor(region, hex) { this.colors.setColor(region, hex); }
  setPalette(p, opt) { this.colors.setPalette(p, opt); }
  getRegions() { return this.colors.getRegions(); }
  getPresets() { return this.colors.presets(); }
  /**
   * Tour-only look: animated black leather jacket + Jensen glasses.
   * On = tumble-on glasses + staged darken; off = fly-away + restore Nebius.
   */
  setTourLook(on) {
    const g = this._ensureTourGlasses();
    const was = this._tourLook?.on;
    // Reverse mid-flight if the user toggles again.
    let t0 = 0;
    if (this._tourLook && was === !on) t0 = Math.max(0, 1 - this._tourLook.t / this._tourLook.dur) * (on ? 0.85 : 0.7);
    this._tourLook = {
      on: !!on,
      t: t0,
      dur: on ? 0.9 : 0.75,
      jacketStep: 0,
      spin: on ? 1 : -1,
    };
    if (g && this._glassesHome) {
      g.visible = true;
      if (on && t0 === 0) {
        g.scale.setScalar(0.05);
        g.position.copy(this._glassesHome.pos);
        g.position.y += 0.09;
      }
    }
    return this;
  }
  _ensureTourGlasses() {
    if (this._tourGlasses) return this._tourGlasses;
    const head = this.bone('head');
    if (!head) return null;
    head.updateWorldMatrix(true, false);

    // Unlit + no depth test: bangs/eye cards otherwise bury the frames on this chibi.
    const frameMat = new THREE.MeshBasicMaterial({ color: 0x050508, depthTest: false });
    const lensMat = new THREE.MeshBasicMaterial({
      color: 0x1a1a22, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
    });

    const le = this.bone('leftEye'), re = this.bone('rightEye');
    let mid = new THREE.Vector3(0, 0.06, 0.05 * this.s0);
    let half = 0.038;
    if (le && re) {
      const lp = head.worldToLocal(le.getWorldPosition(new THREE.Vector3()));
      const rp = head.worldToLocal(re.getWorldPosition(new THREE.Vector3()));
      mid = lp.clone().add(rp).multiplyScalar(0.5);
      half = Math.max(Math.abs(lp.x - rp.x) * 0.55, 0.032);
    }
    // Push past the eye cards / lashes so rims aren't buried in the face mesh.
    const out = mid.clone();
    out.y *= 0.15;
    if (out.lengthSq() < 1e-8) out.set(0, 0, this.s0);
    else out.normalize();
    mid.addScaledVector(out, 0.055);

    // Jensen-style: oversized rectangular frames relative to eye span.
    const lensW = half * 1.55, lensH = lensW * 0.62, thick = Math.max(lensW * 0.18, 0.0055), depth = thick * 1.35;
    const tag = (mesh) => {
      mesh.frustumCulled = false;
      mesh.renderOrder = 20;
      return mesh;
    };
    const rim = (ox) => {
      const g = new THREE.Group();
      const top = tag(new THREE.Mesh(new THREE.BoxGeometry(lensW + thick, thick, depth), frameMat));
      top.position.y = lensH * 0.5;
      const bot = tag(new THREE.Mesh(new THREE.BoxGeometry(lensW + thick, thick * 0.9, depth), frameMat));
      bot.position.y = -lensH * 0.5;
      const L = tag(new THREE.Mesh(new THREE.BoxGeometry(thick, lensH, depth), frameMat));
      L.position.x = -lensW * 0.5;
      const R = tag(new THREE.Mesh(new THREE.BoxGeometry(thick, lensH, depth), frameMat));
      R.position.x = lensW * 0.5;
      const lens = tag(new THREE.Mesh(new THREE.PlaneGeometry(lensW * 0.9, lensH * 0.86), lensMat));
      lens.position.z = depth * 0.2;
      g.add(top, bot, L, R, lens);
      g.position.set(ox, 0, 0);
      return g;
    };

    const group = new THREE.Group();
    group.name = 'MillieTourGlasses';
    group.frustumCulled = false;
    group.add(rim(-half * 1.12), rim(half * 1.12));
    const bridge = tag(new THREE.Mesh(new THREE.BoxGeometry(half * 0.42, thick * 0.75, depth * 0.85), frameMat));
    group.add(bridge);
    const armLen = half * 1.85, armY = lensH * 0.12;
    for (const sx of [-1, 1]) {
      const arm = tag(new THREE.Mesh(new THREE.BoxGeometry(thick * 0.75, thick * 0.75, armLen), frameMat));
      // Temples go back into the head (opposite face-out).
      arm.position.set(sx * (half * 1.12 + lensW * 0.5), armY, -out.z >= 0 ? -armLen * 0.42 : armLen * 0.42);
      // Align arm length with face-out axis in local Z of the group (built facing +Z).
      arm.position.z = -armLen * 0.42;
      group.add(arm);
    }
    // Orient group so local +Z points out of the face.
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), out.clone().normalize());
    group.position.copy(mid);
    group.quaternion.copy(q);
    group.visible = false;
    group.scale.setScalar(1);
    head.add(group);
    this._glassesHome = { pos: mid.clone(), quat: q.clone() };
    this._tourGlasses = group;
    this._glassesLensMat = lensMat;
    return group;
  }
  /** Drive glasses tumble + staged jacket palette (not every-frame recolor). */
  _updateTourLook(dt) {
    const a = this._tourLook;
    if (!a) return;
    a.t += dt;
    const u = clamp(a.t / a.dur, 0, 1);
    const g = this._tourGlasses;
    const home = this._glassesHome;
    if (g && home) {
      if (a.on) {
        // Drop from above, double spin, squash-bounce land.
        const land = smoother(clamp(u / 0.72, 0, 1));
        const bounce = u < 0.72 ? 0 : Math.sin(((u - 0.72) / 0.28) * Math.PI) * 0.12 * (1 - (u - 0.72) / 0.28);
        const sc = land < 1
          ? 0.05 + land * 1.2
          : 1.25 - bounce * 0.8;
        const settled = u >= 1 ? 1 : (land >= 1 ? 1.08 - bounce * 0.5 : sc);
        g.scale.set(settled * (1 + bounce * 0.35), settled * (1 - bounce * 0.45), settled);
        g.position.copy(home.pos);
        g.position.y += (1 - land) * 0.1 + bounce * 0.012;
        g.position.x += Math.sin(land * Math.PI * 2) * 0.012 * (1 - land);
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          land * Math.PI * 2 * a.spin,
          land * Math.PI * 2.4 * a.spin,
          (1 - land) * 0.4 * a.spin,
        ));
        g.quaternion.copy(home.quat).multiply(spin);
        if (this._glassesLensMat) this._glassesLensMat.opacity = 0.08 + land * 0.34;
      } else {
        // Flip up, shrink, spin away.
        const lift = smoother(u);
        const sc = 1 - lift * 0.95;
        g.scale.set(sc * (1 + lift * 0.4), sc * (1 - lift * 0.2), sc);
        g.position.copy(home.pos);
        g.position.y += lift * 0.12;
        g.position.x += Math.sin(lift * Math.PI * 3) * 0.04 * lift;
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(
          -lift * Math.PI * 1.6,
          lift * Math.PI * 3.2 * a.spin,
          lift * Math.PI * 0.5,
        ));
        g.quaternion.copy(home.quat).multiply(spin);
        if (this._glassesLensMat) this._glassesLensMat.opacity = 0.42 * (1 - lift);
      }
    }
    // Jacket only: 2 discrete snaps (atlas rebuild is expensive — never every frame).
    if (this.colors) {
      if (a.on) {
        if (a.jacketStep < 1 && u >= 0.22) {
          this.colors.setPalette({ jacket: '#4a4a52', jacket_trim: '#3a3a42', jacket_glow: '#2a2a30' });
          a.jacketStep = 1;
        }
        if (a.jacketStep < 2 && u >= 0.48) {
          this.colors.setPalette('huang');
          a.jacketStep = 2;
        }
      } else if (a.jacketStep < 1 && u >= 0.28) {
        this.colors.reset();
        a.jacketStep = 1;
      }
    }
    if (u >= 1) {
      if (g && home) {
        if (a.on) {
          g.position.copy(home.pos);
          g.quaternion.copy(home.quat);
          g.scale.setScalar(1);
          if (this._glassesLensMat) this._glassesLensMat.opacity = 0.42;
        } else {
          g.visible = false;
          g.scale.setScalar(1);
          g.position.copy(home.pos);
          g.quaternion.copy(home.quat);
          if (this._glassesLensMat) this._glassesLensMat.opacity = 0.42;
        }
      }
      if (a.on && this.colors && a.jacketStep < 2) this.colors.setPalette('huang');
      if (!a.on && this.colors) this.colors.reset();
      this._tourLook = null;
    }
  }
  // ---- internals
  _body() { const root = this.bone('hips').parent; return { o: (this.bone('upperChest') || this.bone('chest')).getWorldPosition(new THREE.Vector3()), q: root.getWorldQuaternion(new THREE.Quaternion()), root }; }
  _ikArm(side, targetWorld) {   // analytic 2-bone IK on the CURRENT (target) pose -> local quats for upper/lower arm
    const S = (side === 'left' ? 1 : -1) * this.s0, ua = this.bone(side + 'UpperArm'), la = this.bone(side + 'LowerArm'), hd = this.bone(side + 'Hand');
    const root = this.bone('hips').parent; const qRI = root.getWorldQuaternion(new THREE.Quaternion()).invert(); const rp = root.getWorldPosition(new THREE.Vector3());
    const toRig = v => v.clone().sub(rp).applyQuaternion(qRI);
    const s = toRig(ua.getWorldPosition(new THREE.Vector3())), e0 = toRig(la.getWorldPosition(new THREE.Vector3())), w0 = toRig(hd.getWorldPosition(new THREE.Vector3()));
    const l1 = s.distanceTo(e0), l2 = e0.distanceTo(w0); const d = toRig(targetWorld).sub(s); const dist = clamp(d.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.985); d.normalize();
    const pole = new THREE.Vector3(S * 0.6, -1, -0.5 * this.s0).normalize(); const bend = pole.sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
    const A = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
    const elbow = s.clone().addScaledVector(d, Math.cos(A) * l1).addScaledVector(bend, Math.sin(A) * l1), wrist = s.clone().addScaledVector(d, dist);
    const axis = new THREE.Vector3(S, 0, 0); const qP = qRI.clone().multiply(ua.parent.getWorldQuaternion(new THREE.Quaternion()));
    const qU = new THREE.Quaternion().setFromUnitVectors(axis, elbow.clone().sub(s).normalize()), qL = new THREE.Quaternion().setFromUnitVectors(axis, wrist.clone().sub(elbow).normalize());
    return [qP.invert().multiply(qU), qU.clone().invert().multiply(qL)];
  }
  update(dt) {
    dt = Math.min(dt, 1 / 20); this.time += dt; const T = this.time, s0 = this.s0;
    this._updateTourLook(dt);
    // ----- 1) gather additive layer offsets (degrees, authored facing +Z)
    const R = {}, arms = { left: null, right: null }, fing = {}, ex = {}; let hips = [0, 0, 0], look = null, lookW = 0;
    const P = { rot: (b, v, w = 1) => add(R, b, v, w), hips: (v, w = 1) => { hips = hips.map((x, i) => x + v[i] * w); }, expr: (n, w) => { ex[n] = Math.max(ex[n] || 0, w); },
      arm: (side, v, w = 1) => { const a = arms[side]; if (!a) arms[side] = { v: v.slice(), w }; else { const k = w / (a.w + w + 1e-6); a.v = a.v.map((x, i) => x + (v[i] - x) * k); a.w = Math.min(1, a.w + w); } },
      fingers: (side, c, ic, sp, w = 1) => { (fing[side] ??= []).push([c, ic, sp, w]); }, look: (v, w) => { look = v; lookW = w; } };
    // idle: breathing, weight shift, sway (always on) — quiet torso while aiming so shoulder IK doesn't buzz
    const aiming = !!this.point;
    const br = Math.sin(T * TAU * 0.24), ws = noise(T * 0.35, 1.3), sw = [noise(T * 0.6, 4.1), noise(T * 0.5, 7.7), noise(T * 0.45, 2.2)];
    const tb = aiming ? 0.15 : 1;
    add(R, 'chest', [1.8 * br * tb, 0, 0]); add(R, 'spine', [(0.8 * br + 1.2 * sw[0]) * tb, 1.5 * sw[1] * tb, -2.2 * ws * tb]); add(R, 'upperChest', [0.6 * br * tb, 0, 0]);
    add(R, 'hips', [0, 1.2 * sw[2] * tb, 2.6 * ws * tb]); hips = [0.010 * ws * tb, -0.006 + 0.0016 * br * tb, 0];
    const FT = { left: [0, 0, 0, 0, 0], right: [0, 0, 0, 0, 0] };
    P.foot = (sd, v, w = 1) => { const o = FT[sd]; for (let i = 0; i < 5; i++) o[i] += v[i] * w; };
    { const relax = ws > 0 ? 'right' : 'left', a = Math.abs(ws);   // softer weight shift — big heel lifts flash the green soles in the desk crop
      P.foot(relax, [0, 0, 0.002 * a, 4 * smooth(a * 1.4), 0]); }
    const quiet = !this.gest.some(g => g.fadeOut == null) && !this.point && !this.reacts.some(r => r.fadeOut == null);
    { const E_ = this.legEv, tp = E_.tap, pv = E_.piv;   // idle foot taps / toe pivots — quieter for the desk panel
      tp.next -= dt; if (tp.next <= 0 && tp.t < 0 && quiet) { tp.t = 0; tp.side = ws > 0 ? 'right' : 'left'; tp.next = 9 + Math.random() * 8; }
      if (tp.t >= 0) { tp.t += dt; const e = smooth(tp.t / 0.25) * smooth((1.6 - tp.t) / 0.25); P.foot(tp.side, [0, 0, 0, -8 * Math.max(0, Math.sin(tp.t * TAU * 2.0)) ** 1.5 * e, 0]); if (tp.t > 1.6) tp.t = -1; }
      pv.next -= dt; if (pv.next <= 0 && pv.t < 0 && quiet) { pv.t = 0; pv.side = ws > 0 ? 'right' : 'left'; pv.dir = Math.random() < 0.5 ? 1 : -1; pv.next = 12 + Math.random() * 10; }
      if (pv.t >= 0) { pv.t += dt; const e = smooth(pv.t / 0.4) * smooth((3.2 - pv.t) / 0.5); P.foot(pv.side, [0, 0, 0, 4 * e, (pv.side === 'left' ? 1 : -1) * pv.dir * 7 * e]); if (pv.t > 3.2) pv.t = -1; } }
    add(R, 'neck', [1.5 * sw[1], 2 * sw[0], 0]); add(R, 'head', [2.2 * sw[2] - 1.2 * br, 3.5 * sw[0], 2.5 * ws + 1.5 * sw[1]]);
    add(R, 'leftShoulder', [0, 0, 1.2 * br]); add(R, 'rightShoulder', [0, 0, -1.2 * br]);
    // Idle arm sway fights pointing IK — mute while aiming.
    if (!aiming) {
      add(R, 'leftUpperArm', [0, 3 * sw[1], 2.5 * br + 2 * ws]); add(R, 'rightUpperArm', [0, -3 * sw[2], -2.5 * br + 2 * ws]);
      add(R, 'leftLowerArm', [0, -4 * sw[0], 0]); add(R, 'rightLowerArm', [0, 4 * sw[1], 0]);
    }
    // gestures (several can overlap during cross-fades)
    for (const g of this.gest) {
      g.t += dt; const C = CLIPS[g.name]; let w = smooth(g.t / Math.max(g.fadeIn, 1e-3));
      if (g.fadeOut != null) { g.fo = (g.fo || 0) + dt; w *= 1 - smooth(g.fo / Math.max(g.fadeOut, 1e-3)); }
      if (g.t >= C.dur && g.fadeOut == null) { g.fadeOut = 0.01; g.done = true; }
      const PW = { rot: (b, v, ww = 1) => P.rot(b, v, ww * w), hips: (v, ww = 1) => P.hips(v, ww * w), expr: (n, ww) => P.expr(n, ww * w), arm: (s, v, ww = 1) => P.arm(s, v, ww * w),
        fingers: (s, c, ic, sp, ww = 1) => P.fingers(s, c, ic, sp, ww * w), look: (v, ww) => P.look(v, ww * w), foot: (sd, v, ww = 1) => P.foot(sd, v, ww * w) };
      C.fn(Math.min(g.t, C.dur), PW); g.w = w;
    }
    for (const g of this.gest) if (g.done && !g.reported) { g.reported = true; this.onClipEnd?.(g.name); }
    this.gest = this.gest.filter(g => !(g.fadeOut != null && (g.fo || 0) >= g.fadeOut));
    // kawaii reactions: face targets + body language, weight eased by an under-damped SOD (soft overshoot), cross-faded
    const rawT = {};
    for (const r of this.reacts) {
      r.t += dt; if (r.hold != null && r.t >= r.hold && r.fadeOut == null) { r.fadeOut = 0.45; if (this.reaction === r.name) this.reaction = 'neutral'; }
      let tw = r.k * smooth(r.t / Math.max(r.fadeIn, 1e-3)); if (r.fadeOut != null) { r.fo = (r.fo || 0) + dt; tw *= 1 - smooth(r.fo / Math.max(r.fadeOut, 1e-3)); }
      r.w = clamp(r.dyn.step(dt, [tw])[0], 0, 1.15); const w = r.w, RX = REACTIONS[r.name];
      for (const [n, v] of Object.entries(RX.face)) { if (n.startsWith('m:')) rawT[n.slice(2)] = Math.max(rawT[n.slice(2)] || 0, v * Math.min(w, 1)); else P.expr(n, v * Math.min(w, 1)); }
      // Face-only while pointing — reaction arms + point IK = hand buzz.
      const PW = { rot: (b, v, ww = 1) => { if (aiming && /Arm|Hand|Shoulder/.test(b)) return; P.rot(b, v, ww * w); }, hips: (v, ww = 1) => P.hips(v, ww * w * (aiming ? 0.35 : 1)), expr: (n, ww) => P.expr(n, ww * w),
        arm: (sd, v, ww = 1) => { if (aiming) return; P.arm(sd, v, ww * Math.min(w, 1)); },
        fingers: (sd, c, ic, sp, ww = 1) => { if (aiming) return; P.fingers(sd, c, ic, sp, ww * Math.min(w, 1)); },
        look: (v, ww) => P.look(v, ww * Math.min(w, 1)), foot: (sd, v, ww = 1) => P.foot(sd, v, ww * w * (aiming ? 0.25 : 1)) };
      RX.body(r.t, PW);
    }
    this.reacts = this.reacts.filter(r => !(r.fadeOut != null && (r.fo || 0) >= r.fadeOut && r.w < 0.01));
    // talking: head beats from speech energy + occasional open-hand beat gesture
    const talking = !!(this.talk || this.audio); this.talkEnergy += ((talking ? (this.vis.aa + this.vis.oh + this.vis.ee * 0.6) : 0) - this.talkEnergy) * (1 - Math.exp(-dt * 6));
    if (talking) {
      const talkAmp = aiming ? 0.35 : 1;
      add(R, 'head', [(4 * this.talkEnergy + 2 * noise(T * 2.1, 9)) * talkAmp, 3 * noise(T * 1.3, 5) * talkAmp, 2.5 * noise(T * 0.9, 3) * talkAmp]); add(R, 'neck', [2 * this.talkEnergy * talkAmp, 0, 0]);
      const busy = this.point || this.gest.some(g => g.fadeOut == null);
      if (!busy) { this.beat.next -= dt; if (this.beat.next <= 0 && this.beat.t < 0) { this.beat.t = 0; this.beat.side = Math.random() < 0.5 ? 'left' : 'right'; this.beat.next = 2 + Math.random() * 2.5; } }
    }
    if (this.beat.t >= 0 && !aiming) { this.beat.t += dt; const b = this.beat.t, w = Math.sin(clamp(b / 1.3, 0, 1) * Math.PI); const sx = this.beat.side === 'left' ? 1 : -1;
      P.arm(this.beat.side, [sx * 0.15, -0.2 + 0.12 * Math.sin(b * TAU * 1.4) * w, 0.55], w); P.fingers(this.beat.side, 8, 6, 8, w); add(R, this.beat.side + 'Hand', [0, 0, sx * -25 * w]);
      if (b > 1.3) this.beat.t = -1; }
    else if (this.beat.t >= 0 && aiming) this.beat.t = -1;
    // pointing: head/eyes lead, arm follows once — steady hold (no emph pulse / step-hop buzz)
    const pk = 1 - Math.exp(-dt * 5); this.pointW += ((this.point ? 1 : 0) - this.pointW) * pk; this.pointT += dt;
    const body = this._body();
    if (this.point) this._lastPoint = this.point;
    if (this._lastPoint && this.pointW > 0.003) {
      const Pp = this._lastPoint; const local = Pp.pos.clone().sub(body.o).applyQuaternion(body.q.clone().invert()); local.x *= s0; local.z *= s0;
      const side = Pp.side || (local.x >= 0 ? 'left' : 'right'); const sx = side === 'left' ? 1 : -1;
      const tgt = this.pointDyn.step(dt, [Pp.pos.x, Pp.pos.y, Pp.pos.z]);
      const lead = smooth((this.pointT - 0.1) / 0.35);
      // Freeze body-local aim after settle — recomputing from a breathing shoulder buzzes the hand.
      let bl;
      if (this._pointHold && this.pointT > 0.55) {
        bl = this._pointHold.clone();
      } else {
        const sh = this.bone(side + 'UpperArm').getWorldPosition(new THREE.Vector3());
        const dir = new THREE.Vector3(...tgt).sub(sh); const dLen = dir.length(); if (dLen > 1e-5) dir.multiplyScalar(1 / dLen); else dir.set(sx * 0.4, 0.1, 0.9);
        const reachW = sh.clone().addScaledVector(dir, this.armLen * 0.9);
        bl = reachW.sub(body.o).applyQuaternion(body.q.clone().invert()); bl.x *= s0; bl.z *= s0; bl.divideScalar(this.armLen);
        const towardFace = Math.abs(bl.x) < 0.28 && bl.y > 0.12;
        if (towardFace) { bl.x = sx * Math.max(Math.abs(bl.x), 0.38); bl.y = Math.min(bl.y, 0.05); bl.z = Math.max(bl.z, 0.35); }
        if (this.pointT > 0.5) this._pointHold = bl.clone();
      }
      const headBusy = this.gest.some(g => g.fadeOut == null);
      const w = this.pointW;
      if (!headBusy) {
        P.arm(side, bl.toArray(), w * Math.max(lead, 0.02)); P.fingers(side, 75, 2, 0, w);
      }
      const yaw = clamp(Math.atan2(local.x, local.z) / D, -40, 40), up = clamp(local.y * 40, -15, 15);
      add(R, 'spine', [0, yaw * 0.08 * w, -sx * 1.5 * w]); add(R, 'chest', [-up * 0.08 * w, yaw * 0.06 * w, 0]);
      if (!this.lookTarget) { look = null; this._autoLook = new THREE.Vector3(...tgt); } else this._autoLook = null;
    } else this._autoLook = null;
    // ----- 2) compose target local rotations (rest * additive), solve IK on the composed pose
    const tq = {};
    for (const n of this.names) { const r = REST[n] || [0, 0, 0], a = R[n] || [0, 0, 0]; _e.set(s0 * (r[0] + a[0]) * D, (r[1] + a[1]) * D, s0 * (r[2] + a[2]) * D); tq[n] = new THREE.Quaternion().setFromEuler(_e); }
    // fingers: relaxed curl + gesture finger poses
    const fp = {}; fingerPose(fp, 'left', 14 + 3 * sw[0], 14 + 3 * sw[0], 2); fingerPose(fp, 'right', 14 + 3 * sw[1], 14 + 3 * sw[1], 2);
    for (const side of ['left', 'right']) for (const [c, ic, sp, w] of fing[side] || []) { const tmp = {}; fingerPose(tmp, side, c, ic, sp); const base = {}; fingerPose(base, side, 14, 14, 2);
      for (const b in tmp) add(fp, b, tmp[b].map((x, i) => (x - base[b][i]) * w)); }
    for (const b in fp) if (tq[b]) { _e.set(s0 * fp[b][0] * D, fp[b][1] * D, s0 * fp[b][2] * D); tq[b].multiply(_q.setFromEuler(_e)); }
    // pose the rig with targets (unsmoothed) for IK
    for (const n of this.names) this.bone(n).quaternion.copy(tq[n]);
    this.bone('hips').position.copy(this.hipsRest).add(_v.set(hips[0] * s0, hips[1], hips[2] * s0));
    this.vrm.scene.updateMatrixWorld(true);
    const L = this.armLen; const toWorld = v => new THREE.Vector3(v[0] * s0, v[1], v[2] * s0).multiplyScalar(L).applyQuaternion(body.q).add(body.o);
    for (const side of ['left', 'right']) { const a = arms[side]; if (!a || a.w < 1e-3) continue; const [qu, ql] = this._ikArm(side, toWorld(a.v)); const w = clamp(a.w, 0, 1);
      const ua = side + 'UpperArm', la = side + 'LowerArm'; const addU = R[ua] || [0, 0, 0], addL = R[la] || [0, 0, 0];
      tq[ua].slerp(qu, w); tq[la].slerp(ql, w);
      if (addL[1] || addL[0] || addL[2]) { /* forearm oscillation from gestures already in tq rest part; keep a share on top of IK */ _e.set(s0 * addL[0] * D * w, addL[1] * D * w, s0 * addL[2] * D * w); tq[la].multiply(_q.setFromEuler(_e)); } }
    // ----- 3) look-at: eyes first (fast + micro-saccades), head follows slowly (lead-lag)
    const head = this.bone('head'); const hp = head.getWorldPosition(new THREE.Vector3()); const camP = this.camera ? this.camera.getWorldPosition(new THREE.Vector3()) : hp.clone().add(new THREE.Vector3(0, 0, 2 * s0 * -1).applyQuaternion(body.q));
    let tgtW = this.lookTarget || this._autoLook;
    this.sacc.next -= dt; if (this.sacc.next <= 0) { this.sacc.next = 0.35 + Math.random() * 1.4; this.sacc.off = [(Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.035]; }
    if (!tgtW) {   // idle eye wander: mostly at the user (camera), sometimes a glance away
      this.wander.next -= dt; if (this.wander.next <= 0) { this.wander.next = 1.5 + Math.random() * 3; this.wander.tgt = Math.random() < 0.6 ? [0, 0] : [(Math.random() - 0.5) * 0.9, (Math.random() - 0.3) * 0.4]; }
      tgtW = camP.clone().add(new THREE.Vector3(this.wander.tgt[0], this.wander.tgt[1], 0));
      if (look) { const g = hp.clone().add(new THREE.Vector3(-look[0] * s0, look[1], 1.0 * s0).applyQuaternion(body.q)); tgtW = g.lerp(tgtW, 1 - clamp(lookW, 0, 1)); }   // clip gaze (x>0 = her right)
    }
    const eyeT = tgtW.clone().add(new THREE.Vector3(this.sacc.off[0], this.sacc.off[1], 0).multiplyScalar(hp.distanceTo(tgtW)));
    const ey = this.eyeDyn.step(dt, eyeT.toArray()); this.lookObj.position.set(ey[0], ey[1], ey[2]);
    if (this._first) { this.eyeDyn.reset(eyeT.toArray()); this.lookObj.position.copy(eyeT); }
    const loc = tgtW.clone().sub(hp).applyQuaternion(body.q.clone().invert()); loc.x *= s0; loc.z *= s0;
    const yaw = clamp(Math.atan2(loc.x, loc.z), -0.65, 0.65), pitch = clamp(Math.atan2(-loc.y, Math.hypot(loc.x, loc.z)), -0.4, 0.35);
    const hl = this.headLook.step(dt, [yaw, pitch]); const hw = (this.lookTarget || this._autoLook) ? 0.6 : 0.3;
    const big = Math.abs(yaw - (this._lastYaw ?? yaw)) > 0.25; this._lastYaw = yaw; if (big && Math.random() < 0.5) this.blink.next = Math.min(this.blink.next, 0.02);
    _e.set(s0 * hl[1] * hw * 0.75, hl[0] * hw * 0.75, 0); tq.head.premultiply(_q.setFromEuler(_e)); _e.set(s0 * hl[1] * hw * 0.25, hl[0] * hw * 0.25, 0); tq.neck?.premultiply(_q.setFromEuler(_e));
    // ----- 4) second-order dynamics on every bone (rotation vectors) + hips translation
    // Hard-set pointing arm — SOD lag on upper/lower arm is the remaining buzz.
    const v3 = [0, 0, 0];
    const armFrozen = (n) => aiming && /^(left|right)(UpperArm|LowerArm|Hand)$/.test(n);
    for (const n of this.names) {
      const q = tq[n]; qlog(q, v3); const d = this.dyn[n]; if (this._first) d.reset(v3);
      if (armFrozen(n)) { this.bone(n).quaternion.copy(q); d.reset(v3); continue; }
      const y = d.step(dt, v3); qexp(y, this.bone(n).quaternion);
    }
    const hy = this.hipsDyn.step(dt, hips); if (this._first) this.hipsDyn.reset(hips);
    this.bone('hips').position.copy(this.hipsRest).add(_v.set(hy[0] * s0, hy[1], hy[2] * s0));
    if (this.legsEnabled) this._legIK(dt, FT);
    // Soft limb↔head collisions (clip gestures / pointing through the chibi face).
    this._resolveArmHeadCollisions();
    // ----- 5) expressions: clip + user, eased with critically damped dynamics; blink; visemes; conflict rules
    const E = {}; for (const n in this.exprT) E[n] = this.exprT[n]; for (const n in ex) E[n] = Math.max(E[n] || 0, ex[n]);
    if (talking && !E.Smug) E.Explaining = Math.max(E.Explaining || 0, 0.25 * this.talkEnergy);
    for (const n of new Set([...Object.keys(E), ...Object.keys(this.exprDyn)])) { const d = this.exprDyn[n] || (this.exprDyn[n] = new SOD(3.2, 1, 0, [0])); this.expr[n] = clamp(d.step(dt, [E[n] || 0])[0], 0, 1); }
    // decal mouths (p_mouth_*) give way to visemes while talking; raw VRoid morphs (m:) eased like expressions
    const mg = clamp(this.mouthGate.step(dt, [talking ? 0 : 1])[0], 0, 1);
    for (const n in this.expr) if (n.startsWith('p_mouth_')) this.expr[n] *= mg;
    for (const n of new Set([...Object.keys(rawT), ...Object.keys(this.rawDyn)])) { const d = this.rawDyn[n] || (this.rawDyn[n] = new SOD(3.2, 1, 0, [0])); this.raw[n] = clamp(d.step(dt, [rawT[n] || 0])[0], 0, 1); }
    const X = this.expr; const eyeDecal = Math.max(0, ...Object.keys(X).filter(n => n.startsWith('p_eye_')).map(n => X[n]), this.raw.Fcl_EYE_Joy || 0, this.raw.Fcl_EYE_Close || 0);
    const closes = Math.max(X.happy || 0, X.Smug || 0, X.relaxed || 0, X.Wink || 0, X.Excited || 0, X.Laugh || 0, X.Cat || 0, X.Apologetic || 0, eyeDecal), mouthBlock = Math.max(X.Smug || 0, (X.Wink || 0) * mg);
    const B = this.blink; B.next -= dt;
    if (B.next <= 0 && B.t < 0) { B.t = 0; B.double = Math.random() < 0.12; B.next = 1.8 + Math.random() * 3.8; }
    if (B.t >= 0) { B.t += dt; const c = 0.065, h = 0.035, o = 0.14; const t = B.t;
      B.w = t < c ? smooth(t / c) : t < c + h ? 1 : t < c + h + o ? 1 - smooth((t - c - h) / o) : 0;
      if (t >= c + h + o) { B.t = -1; if (B.double) { B.double = false; B.next = 0.12; } } }
    const lookDown = clamp(pitch > 0 ? pitch * 0.4 : 0, 0, 0.15);   // lids follow the gaze down a little
    const blinkW = Math.max(B.w, lookDown) * (1 - closes);
    // visemes: coarticulated targets -> fast dynamics
    const VT = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    if (this.talk) { this.talk.t += dt; const tt = this.talk.t;
      for (const [t0, v, w, len] of this.talk.track) { if (tt < t0 - 0.06 || tt > t0 + len + 0.06) continue; const u = Math.sin(clamp((tt - t0 + 0.06) / (len + 0.12), 0, 1) * Math.PI);
        if (v === 'close') { for (const k in VT) VT[k] *= 1 - 0.8 * u; } else VT[v] = Math.max(VT[v], w * u * 0.9); }
      if (tt > this.talk.dur) this.talk = null; }
    if (this.audio) { const a = this.audio; a.an.getByteFrequencyData(a.buf); const n = a.buf.length; let lo = 0, mid = 0, hi = 0;
      for (let i = 2; i < n * 0.08; i++) lo += a.buf[i]; for (let i = Math.floor(n * 0.08); i < n * 0.2; i++) mid += a.buf[i]; for (let i = Math.floor(n * 0.2); i < n * 0.4; i++) hi += a.buf[i];
      const tot = lo + mid + hi + 1, vol = Math.min(1, tot / (n * 0.4 * 120)); VT.aa = vol * mid / tot * 2.2; VT.oh = vol * lo / tot * 1.6; VT.ih = vol * hi / tot * 2.0; }
    const vk = ['aa', 'ih', 'ou', 'ee', 'oh'], vy = this.visDyn.step(dt, vk.map(k => VT[k])); vk.forEach((k, i) => this.vis[k] = clamp(vy[i], 0, 1));
    if (this.em) {
      for (const e of this.em.expressions) this.em.setValue(e.expressionName, 0);
      for (const n in X) if (this.em.getExpression(n)) this.em.setValue(n, X[n]);
      this.em.setValue('blink', Math.max(X.blink || 0, blinkW));
      const mk = (1 - mouthBlock) * (1 - 0.5 * (X.happy || 0)); for (const k of vk) this.em.setValue(k, Math.max(X[k] || 0, this.vis[k] * mk));
    }
    if (this.vrm.lookAt) this.vrm.lookAt.target = this.lookObj;
    this._first = false;
    this.vrm.update(dt);
    this._applyRaw();
  }
  _applyRaw() {   // raw VRoid face morphs used by reactions (after vrm.update so the expression manager does not overwrite them)
    if (!this._rawIdx) { this._rawIdx = []; this.vrm.scene.traverse(o => { if (o.morphTargetDictionary) for (const k in o.morphTargetDictionary) { const m = k.match(/(Fcl_EYE_Joy|Fcl_EYE_Close)$/); if (m) this._rawIdx.push([o, o.morphTargetDictionary[k], m[1]]); } }); }
    for (const [o, i, n] of this._rawIdx) { const v = this.raw[n] || 0; if (v > 0) o.morphTargetInfluences[i] = Math.max(o.morphTargetInfluences[i], v); }
  }
  /**
   * Soft collision: keep lower-arm / hand outside a head sphere.
   * Re-IKs the arm to a pushed wrist and syncs bone dynamics so the next frame doesn't snap back.
   */
  _resolveArmHeadCollisions() {
    const head = this.bone('head');
    if (!head || !this.armLen) return;
    this.vrm.scene.updateMatrixWorld(true);
    const hp = head.getWorldPosition(new THREE.Vector3());
    // Chibi head is large vs arm length — generous radius + padding.
    const R = Math.max(0.1, this.armLen * 0.58);
    const pad = 0.018;
    const body = this._body();
    const s0 = this.s0;
    const tmp = new THREE.Vector3();
    const v3 = [0, 0, 0];
    // While pointing, that arm already clears the face — collision re-IK fights pointDyn → vibrate.
    let pointSide = null;
    if (this.point && this.pointW > 0.2) {
      const local = this.point.pos.clone().sub(body.o).applyQuaternion(body.q.clone().invert());
      local.x *= s0;
      pointSide = this.point.side || (local.x >= 0 ? 'left' : 'right');
    }
    for (const side of ['left', 'right']) {
      if (side === pointSide) continue;
      const uaN = side + 'UpperArm', laN = side + 'LowerArm', hdN = side + 'Hand';
      const ua = this.bone(uaN), la = this.bone(laN), hd = this.bone(hdN);
      if (!ua || !la || !hd) continue;
      const elbow = la.getWorldPosition(new THREE.Vector3());
      const wrist = hd.getWorldPosition(new THREE.Vector3());
      const mid = elbow.clone().lerp(wrist, 0.55);
      const samples = [elbow, mid, wrist];
      let pen = 0, pushDir = null, hit = null;
      for (const p of samples) {
        const d = p.clone().sub(hp);
        const dist = d.length();
        const depth = R - dist;
        if (depth > pen) {
          pen = depth;
          hit = p;
          pushDir = dist > 1e-5 ? d.normalize() : new THREE.Vector3(side === 'left' ? 1 : -1, 0, 0.2).normalize();
        }
      }
      if (pen <= 0.004 || !pushDir || !hit) continue;

      // Desired wrist = current wrist pushed out of the sphere along the hit normal.
      const safeWrist = wrist.clone().addScaledVector(pushDir, pen + pad);
      // Prefer clearing the face laterally (desk crop) — keep hand off the midline.
      const local = safeWrist.clone().sub(body.o).applyQuaternion(body.q.clone().invert());
      local.x *= s0;
      const sx = side === 'left' ? 1 : -1;
      const minLat = this.armLen * 0.3;
      if (Math.abs(local.x) < minLat) local.x = sx * minLat;
      if (local.y > this.armLen * 0.18) local.y = this.armLen * 0.1;
      if (local.z < this.armLen * 0.12) local.z = this.armLen * 0.2;
      const worldT = tmp.set(local.x * s0, local.y, local.z * s0).applyQuaternion(body.q).add(body.o);

      let qu, ql;
      try {
        [qu, ql] = this._ikArm(side, worldT);
      } catch {
        continue;
      }
      const k = clamp(pen / (R * 0.45), 0.4, 1);
      ua.quaternion.slerp(qu, k);
      la.quaternion.slerp(ql, k);
      // Keep SOD from fighting the correction next frame.
      if (this.dyn[uaN]) { qlog(ua.quaternion, v3); this.dyn[uaN].reset(v3); }
      if (this.dyn[laN]) { qlog(la.quaternion, v3); this.dyn[laN].reset(v3); }
    }
    this.vrm.scene.updateMatrixWorld(true);
  }
  _legIK(dt, FT) {   // planted feet: analytic 2-bone IK per leg on the smoothed pose; foot targets are second-order smoothed (ease + soft overshoot)
    const s0 = this.s0, root = this.bone('hips').parent, hipsB = this.bone('hips'); hipsB.updateMatrixWorld(true);
    const qRI = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    for (const sd of ['left', 'right']) {
      const L = this.legRest[sd]; if (!L) continue; const o = this.legDyn[sd].step(dt, FT[sd]); if (this._first) this.legDyn[sd].reset(FT[sd]);
      // auto step-lift: a foot that is re-positioned lifts a little (no sliding on the floor)
      const lp = this._legPrev?.[sd] || [o[0], o[2]]; const spd = Math.hypot(o[0] - lp[0], o[2] - lp[1]) / Math.max(dt, 1e-4); (this._legPrev ??= {})[sd] = [o[0], o[2]];
      const al = (this._legLift ??= {})[sd] || (this._legLift[sd] = new SOD(5, 0.9, 0, [0])); const autoLift = Math.max(0, al.step(dt, [Math.min(0.03, spd * 0.4)])[0]);
      const pitch = o[3] * D, qP_ = new THREE.Quaternion().setFromAxisAngle(_v.set(1, 0, 0), s0 * pitch), qY = new THREE.Quaternion().setFromAxisAngle(_v.set(0, 1, 0), o[4] * D);
      const piv = pitch >= 0 ? L.toe : L.heel;   // pitch about toe (heel up) or heel (toe up) - identical at 0 -> continuous; then yaw about the (pitched) ball of the foot
      const an1 = L.an.clone().sub(piv).applyQuaternion(qP_).add(piv), toe1 = L.toe.clone().sub(piv).applyQuaternion(qP_).add(piv);
      const an = an1.sub(toe1).applyQuaternion(qY).add(toe1).add(_v.set(o[0] * s0, Math.max(0, o[1]) + autoLift, o[2] * s0)); const qF = qY.clone().multiply(qP_);
      const ub = this.bone(sd + 'UpperLeg'), lb = this.bone(sd + 'LowerLeg'), fb = this.bone(sd + 'Foot');
      const hp = root.worldToLocal(ub.getWorldPosition(new THREE.Vector3())); const d = an.clone().sub(hp); const l1 = L.l1, l2 = L.l2;
      const dist = clamp(d.length(), Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995); d.normalize();
      const pole = new THREE.Vector3(0, 0, s0).applyAxisAngle(new THREE.Vector3(0, 1, 0), o[4] * D * 0.6); const bend = pole.sub(d.clone().multiplyScalar(pole.dot(d))).normalize();
      const A = Math.acos(clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1));
      const knee = hp.clone().addScaledVector(d, Math.cos(A) * l1).addScaledVector(bend, Math.sin(A) * l1), ank = hp.clone().addScaledVector(d, dist);
      const qP = qRI.clone().multiply(ub.parent.getWorldQuaternion(new THREE.Quaternion()));   // upper-leg parent in root space
      const qU = new THREE.Quaternion().setFromUnitVectors(lb.position.clone().normalize(), knee.clone().sub(hp).normalize().applyQuaternion(qP.clone().invert()));
      ub.quaternion.copy(qU); const qPU = qP.clone().multiply(qU);
      const qL = new THREE.Quaternion().setFromUnitVectors(fb.position.clone().normalize(), ank.clone().sub(knee).normalize().applyQuaternion(qPU.clone().invert()));
      lb.quaternion.copy(qL); fb.quaternion.copy(qPU.multiply(qL).invert().multiply(qF));
    }
  }
}
