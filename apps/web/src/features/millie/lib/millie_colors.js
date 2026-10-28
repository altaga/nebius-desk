// Runtime recolor for Millie chibi v2.1 (all regions independent, 4 materials kept).
// Region maps (8-bit ids, same UVs as the atlases) + regions.json come from gen/g3b_palette.py.
// Formula (identical to the generator): luminance-preserving remap from the region's baked base colour to the new colour,
// so painted shading, folds and highlights survive any hue.
import * as THREE from 'three';
const hex2 = h => { const c = new THREE.Color(h); return [c.r, c.g, c.b].map(x => x); };   // sRGB components (no linear conversion: we edit sRGB texels)
const srgb = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };
const luma = c => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
export const EXTRA_PRESETS = {
  midnight: { jacket: '#2d3345', jacket_trim: '#ff7a59', jacket_glow: '#ff7a59', shorts: '#2d3345', shorts_trim: '#ff7a59', shorts_cuff: '#ff7a59', shorts_tab: '#ff7a59', innershirt: '#14161c', tights: '#14161c', turtleneck: '#1b1e27',
    belt: '#14161c', buckle: '#ff7a59', shoes: '#e8e8ef', shoes_accent: '#ff7a59', shoes_laces: '#8a8fa3', shoes_lining: '#14161c', badge: '#e8e8ef', badge_trim: '#ff7a59', badge_text: '#14161c', hair: '#c9b6ff', iris: '#5aa8ff', visor: '#ff7a59', outline: '#101218' },
  sakura: { jacket: '#fff3f6', jacket_trim: '#ff8fb1', jacket_glow: '#ff5c93', shorts: '#ffd9e4', shorts_trim: '#ff8fb1', shorts_cuff: '#ff8fb1', shorts_tab: '#ff8fb1', innershirt: '#5b3a4a', tights: '#5b3a4a', turtleneck: '#7a4c61',
    belt: '#5b3a4a', buckle: '#ffffff', shoes: '#ffffff', shoes_accent: '#ff8fb1', shoes_laces: '#e6b8c6', shoes_lining: '#5b3a4a', badge: '#ffffff', badge_trim: '#ff8fb1', badge_text: '#5b3a4a', hair: '#ffb3c8', iris: '#7a3cff', brows: '#a0606f', blush: '#ff5c8a', visor: '#ff8fb1', outline: '#4a2a36' },
  forest: { jacket: '#3d5a40', jacket_trim: '#f2c14e', jacket_glow: '#f2c14e', shorts: '#6b4f36', shorts_trim: '#f2c14e', shorts_cuff: '#f2c14e', shorts_tab: '#f2c14e', innershirt: '#e9e2cf', tights: '#2a2a22', turtleneck: '#e9e2cf',
    belt: '#2a2a22', buckle: '#f2c14e', shoes: '#6b4f36', shoes_accent: '#f2c14e', shoes_laces: '#e9e2cf', shoes_lining: '#2a2a22', badge: '#e9e2cf', badge_trim: '#3d5a40', badge_text: '#2a2a22', hair: '#8a5a2b', iris: '#3f8f4f', skin: '#e8b892', visor: '#f2c14e', outline: '#1f2a1f' },
  /** Tour-only: exaggerated black leather — deep body, lit seams, cool sheen. */
  huang: { jacket: '#050508', jacket_trim: '#6a6a78', jacket_glow: '#3a4250' },
};
export const LEATHER_REGIONS = ['jacket', 'jacket_trim', 'jacket_glow', 'innershirt'];
export class MillieColors {
  constructor(vrm, meta, baseUrl = './assets/') { this.vrm = vrm; this.meta = meta; this.base = baseUrl; this.cur = {}; this.dirty = new Set(); this.ready = false; }
  static async load(vrm, url = './assets/millie_regions.json') {
    const meta = await (await fetch(url)).json(); const c = new MillieColors(vrm, meta, url.replace(/[^/]*$/, '')); await c._init(); return c;
  }
  async _pixels(src, w, h) {   // ImageBitmap/HTMLImage/canvas or URL -> Uint8ClampedArray RGBA
    const img = typeof src === 'string' ? await createImageBitmap(await (await fetch(this.base + src)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : src;
    const cv = document.createElement('canvas'); cv.width = w || img.width; cv.height = h || img.height;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.imageSmoothingEnabled = false; g.drawImage(img, 0, 0, cv.width, cv.height); return g.getImageData(0, 0, cv.width, cv.height).data;
  }
  async _init() {
    const m = this.meta; this.ids = m.ids; this.names = Object.keys(m.ids).filter(n => n !== 'misc');
    this.atlas = {};   // key -> {textures:Set, w,h, orig:Uint8ClampedArray, label, baked:{region:hex}, canvas}
    const add = (key, tex) => { if (!tex?.image) return; (this.atlas[key] ??= { textures: new Set() }).textures.add(tex); };
    this.mats = [];
    this.vrm.scene.traverse(o => { if (!o.isMesh) return; for (const mt of [].concat(o.material)) {
      if (!mt || this.mats.includes(mt)) continue; this.mats.push(mt); const n = mt.name.replace(/ \(Outline\)$/, '');
      const key = n === 'M_Body' ? 'body' : n === 'M_FaceAlpha' ? 'face' : n === 'M_Hair' ? 'hair' : null;
      if (key) { add(key, mt.map); add(key, mt.shadeMultiplyTexture); if (key === 'body') add('body_emit', mt.emissiveMap); } } });
    for (const [key, A] of Object.entries(this.atlas)) {
      const t0 = [...A.textures][0]; A.w = t0.image.width; A.h = t0.image.height; A.orig = await this._pixels(t0.image);
      const lm = (m.atlases[key === 'body_emit' ? 'body' : key] || {}).map;
      if (lm) { const lp = await this._pixels(lm, A.w, A.h); A.label = new Uint8Array(A.w * A.h); for (let i = 0; i < A.label.length; i++) A.label[i] = lp[i * 4]; }
      else { A.label = new Uint8Array(A.w * A.h).fill(this.ids.hair); }
      A.baked = m.baked[key] || {};
      A.canvas = document.createElement('canvas'); A.canvas.width = A.w; A.canvas.height = A.h;
    }
    for (const n of this.names) this.cur[n] = this.bakedColor(n);
    this.cur.outline = m.presets[m.palette].outline; this.cur.visor = m.presets[m.palette].visor;
    this.ready = true;
  }
  bakedColor(n) { for (const k of ['body', 'face', 'hair', 'body_emit']) if (this.atlas[k]?.baked?.[n]) return this.atlas[k].baked[n]; return this.meta.presets[this.meta.palette][n]; }
  getRegions() { return [...this.names, 'outline', 'visor'].map(n => ({ name: n, color: this.cur[n], baked: this.bakedColor(n) })); }
  presets() { return { ...this.meta.presets, ...EXTRA_PRESETS }; }
  setColor(region, hex) { if (!(region in this.cur) && region !== 'outline' && region !== 'visor') throw new Error('unknown region ' + region); this.cur[region] = hex; this.dirty.add(region); this._schedule(); }
  setPalette(p, opt = {}) { if (typeof p === 'string') p = this.presets()[p]; if (opt.reset && p !== this.meta.presets.original) this.setPalette(this.meta.presets.original); for (const [k, v] of Object.entries(p)) if (k in this.cur || k === 'outline' || k === 'visor') { this.cur[k] = v; this.dirty.add(k); } this._schedule(); }
  reset() { this.setPalette(this.meta.presets[this.meta.palette]); }
  /**
   * Black-leather mode for the jacket regions. Applied inside every atlas rebuild
   * (a one-shot edit would be wiped by the next scheduled applyNow).
   */
  setLeather(on) {
    on = !!on; if (this.leather === on) return; this.leather = on;
    for (const n of LEATHER_REGIONS) this.dirty.add(n);
    this._schedule();
  }
  /** @deprecated use setLeather(true). */
  boostLeatherJacket() { this.setLeather(true); return true; }
  // The baked jacket is nearly flat (folds only ~8% under base), so the painted
  // shading is amplified hard: crushed creases, glints on crease edges, glossy ridges.
  _leatherPass(A, d) {
    const src = A.orig, L = A.label, w = A.w, ids = this.ids;
    const idJ = ids.jacket, idT = ids.jacket_trim, idG = ids.jacket_glow, idS = ids.innershirt;
    const lum = p => (src[p] * 0.2126 + src[p + 1] * 0.7152 + src[p + 2] * 0.0722) / 255;
    const base = {};
    for (const n of LEATHER_REGIONS) base[ids[n]] = Math.max(luma(srgb(A.baked[n] || '#e8e8e8')), 1e-3);
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let i = 0, p = 0; i < L.length; i++, p += 4) {
      const id = L[i]; if (!(id in base) || src[p + 3] === 0) continue;
      const lb = base[id], t = lum(p) / lb - 1;
      // Crease-edge glint: local luma gradient within the same region.
      let gx = 0, gy = 0;
      const x = i % w;
      if (x > 0 && x < w - 1 && L[i - 1] === id && L[i + 1] === id) gx = (lum(p + 4) - lum(p - 4)) / lb;
      if (i >= w && i < L.length - w && L[i - w] === id && L[i + w] === id) gy = (lum(p + 4 * w) - lum(p - 4 * w)) / lb;
      const edge = sm(0.01, 0.06, Math.hypot(gx, gy));
      let v;
      if (id === idJ) {
        const crease = t < 0 ? Math.max(0.2, 1 + t * 6) : 1;
        v = 0.075 * crease + 0.42 * sm(0.004, 0.06, t) + 0.1 * edge;
      } else if (id === idS) {
        // Waist band under the cropped hem reads as the jacket continuing to the belt.
        v = 0.07 * Math.max(0.45, 1 + t * 1.5);
      } else if (id === idT) {
        // Dark gunmetal zipper / piping, just above the leather.
        v = 0.11 + 0.12 * sm(0.0, 0.08, t);
      } else {
        v = 0.09 + 0.06 * sm(0.0, 0.06, t);
      }
      v = Math.min(1, v);
      d[p] = v * 0.9 * 255; d[p + 1] = v * 0.94 * 255; d[p + 2] = Math.min(255, v * 1.08 * 255 + 3);
    }
  }
  /**
   * Swap the body diffuse for a pre-baked atlas with the Nebius Desk chest mark
   * (dark mark + lime accent — cream SVG is invisible on the cream badge).
   */
  async applyBrandedBody(atlasUrl = '/millie/atlas_body_branded.webp') {
    const A = this.atlas.body;
    if (!this.ready || !A) return false;
    try {
      const bmp = await createImageBitmap(await (await fetch(atlasUrl)).blob(), {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
      });
      const g = A.canvas.getContext('2d', { willReadFrequently: true });
      g.imageSmoothingEnabled = false;
      g.clearRect(0, 0, A.w, A.h);
      g.drawImage(bmp, 0, 0, A.w, A.h);
      bmp.close?.();
      const img = g.getImageData(0, 0, A.w, A.h);
      A.orig.set(img.data);
      // Freeze former AI lettering so palette remaps cannot restore it.
      const idText = this.ids.badge_text;
      const misc = this.ids.misc ?? 0;
      if (A.label && idText != null) {
        for (let i = 0; i < A.label.length; i++) if (A.label[i] === idText) A.label[i] = misc;
      }
      for (const t of A.textures) {
        t.image = A.canvas;
        t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
      }
    } catch {
      return false;
    }

    const E = this.atlas.body_emit;
    const idBadge = this.ids.badge, idText = this.ids.badge_text;
    if (E?.orig && E.label && idBadge != null) {
      const misc = this.ids.misc ?? 0;
      for (let i = 0, p = 0; i < E.label.length; i++, p += 4) {
        if (E.label[i] !== idText && E.label[i] !== idBadge) continue;
        E.orig[p] = 0; E.orig[p + 1] = 0; E.orig[p + 2] = 0;
        E.label[i] = misc;
      }
      const eg = E.canvas.getContext('2d');
      const eimg = eg.createImageData(E.w, E.h);
      eimg.data.set(E.orig);
      eg.putImageData(eimg, 0, 0);
      for (const t of E.textures) { t.image = E.canvas; t.needsUpdate = true; }
    }
    return true;
  }
  /** @deprecated prefer applyBrandedBody — kept as alias for older call sites. */
  async stampChestLogo(logoUrl) {
    return this.applyBrandedBody(typeof logoUrl === 'string' && logoUrl.endsWith('.webp') ? logoUrl : '/millie/atlas_body_branded.webp');
  }
  _schedule() { if (this._t) return; this._t = Promise.resolve().then(() => { this._t = null; this.applyNow(); }); }
  applyNow() {
    const D = this.dirty; this.dirty = new Set(); if (!D.size) return;
    if (D.has('outline')) for (const mt of this.mats) if (mt.outlineColorFactor) mt.outlineColorFactor.set(this.cur.outline);
    if (D.has('visor')) for (const mt of this.mats) if (mt.name.startsWith('M_Glow')) { mt.color?.set(this.cur.visor); mt.emissive?.set(this.cur.visor); }
    for (const [key, A] of Object.entries(this.atlas)) {
      const regs = Object.keys(A.baked).filter(n => D.has(n)); if (!regs.length) continue;
      // full rebuild of the atlas from the ORIGINAL texels (never cumulative)
      const lut = new Array(256).fill(null);
      for (const n of Object.keys(A.baked)) { const b = srgb(A.baked[n]), nc = srgb(this.cur[n]); if (A.baked[n].toLowerCase() === this.cur[n].toLowerCase()) continue; lut[this.ids[n]] = { nc, lb: Math.max(luma(b), 1e-3) }; }
      const src = A.orig, L = A.label, g = A.canvas.getContext('2d'); const img = g.createImageData(A.w, A.h); const d = img.data; d.set(src);
      for (let i = 0, p = 0; i < L.length; i++, p += 4) { const e = lut[L[i]]; if (!e || src[p + 3] === 0) continue;
        const r = src[p] / 255, gg = src[p + 1] / 255, b = src[p + 2] / 255, lp = r * 0.2126 + gg * 0.7152 + b * 0.0722, t = lp / e.lb, nc = e.nc;
        if (t <= 1) { d[p] = nc[0] * t * 255; d[p + 1] = nc[1] * t * 255; d[p + 2] = nc[2] * t * 255; }
        else { const s = Math.min(1, (lp - e.lb) / Math.max(1 - e.lb, 1e-3)); d[p] = (nc[0] + (1 - nc[0]) * s) * 255; d[p + 1] = (nc[1] + (1 - nc[1]) * s) * 255; d[p + 2] = (nc[2] + (1 - nc[2]) * s) * 255; } }
      if (this.leather && key === 'body') this._leatherPass(A, d);
      if (this.leather && key === 'body_emit') { const idG = this.ids.jacket_glow; for (let i = 0, p = 0; i < L.length; i++, p += 4) if (L[i] === idG) { d[p] = 0; d[p + 1] = 0; d[p + 2] = 0; } }
      g.putImageData(img, 0, 0);
      for (const t of A.textures) { t.image = A.canvas; t.needsUpdate = true; }
    }
  }
}
