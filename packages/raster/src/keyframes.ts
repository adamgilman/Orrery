/**
 * Freeze the renderer's own CSS animations at time t. The renderer emits a small, known subset of CSS:
 * `@keyframes name{p%{decl;decl}...}` over `opacity`, `visibility` and `transform` (translate/scale lists), with an
 * optional per-stop `animation-timing-function`, applied either inline (`style="animation:name Ds linear infinite"`)
 * or by a selector rule (`selector{animation:name Ds linear infinite}`). This module evaluates those exactly.
 */

interface Stop { at: number; decls: Record<string, string>; timing?: string }
interface Keyframes { name: string; stops: Stop[] }

export function parseKeyframes(css: string): Map<string, Keyframes> {
  const out = new Map<string, Keyframes>();
  for (const m of css.matchAll(/@keyframes ([\w-]+)\{((?:[^{}]*\{[^{}]*\})*)\}/g)) {
    const stops: Stop[] = [];
    for (const st of m[2]!.matchAll(/([\d.]+)%\{([^}]*)\}/g)) {
      const decls: Record<string, string> = {};
      let timing: string | undefined;
      for (const d of st[2]!.split(";")) { const i = d.indexOf(":"); if (i < 0) continue; const k = d.slice(0, i).trim(), v = d.slice(i + 1).trim(); if (k === "animation-timing-function") timing = v; else decls[k] = v; }
      stops.push({ at: Number(st[1]), decls, ...(timing ? { timing } : {}) });
    }
    out.set(m[1]!, { name: m[1]!, stops });
  }
  return out;
}

/** CSS ease-in-out: cubic-bezier(0.42, 0, 0.58, 1), solved for y at time x. */
function easeInOut(x: number): number {
  const bx = (t: number) => 3 * 0.42 * (1 - t) * (1 - t) * t + 3 * 0.58 * (1 - t) * t * t + t * t * t;
  const by = (t: number) => 3 * 0 * (1 - t) * (1 - t) * t + 3 * 1 * (1 - t) * t * t + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (bx(mid) < x) lo = mid; else hi = mid; }
  return by((lo + hi) / 2);
}

interface Xf { a: number; b: number; s: number; c: number; d: number }
const parseXf = (v: string): Xf => {
  if (v === "none") return { a: 0, b: 0, s: 1, c: 0, d: 0 };
  const m = v.match(/translate\(([\d.-]+)px, ([\d.-]+)px\) scale\(([\d.]+)\) translate\(([\d.-]+)px, ([\d.-]+)px\)/);
  if (!m) throw new Error(`unsupported transform "${v}"`);
  return { a: Number(m[1]), b: Number(m[2]), s: Number(m[3]), c: Number(m[4]), d: Number(m[5]) };
};
const lerp = (p: number, q: number, t: number) => p + (q - p) * t;

/** The animated properties of `kf` at fraction `phase` (0..1) of its cycle. */
export function valuesAt(kf: Keyframes, phase: number): Record<string, string> {
  const p = phase * 100;
  const props = new Set(kf.stops.flatMap((s) => Object.keys(s.decls)));
  const out: Record<string, string> = {};
  for (const prop of props) {
    const stops = kf.stops.filter((s) => prop in s.decls);
    let prev = stops[0]!, next = stops[stops.length - 1]!;
    for (let i = 0; i < stops.length - 1; i++) if (stops[i]!.at <= p && p <= stops[i + 1]!.at) { prev = stops[i]!; next = stops[i + 1]!; break; }
    let t = next.at === prev.at ? 1 : Math.min(1, Math.max(0, (p - prev.at) / (next.at - prev.at)));
    if (prev.timing === "ease-in-out") t = easeInOut(t);
    const a = prev.decls[prop]!, b = next.decls[prop]!;
    if (prop === "opacity") out[prop] = String(Math.round(lerp(Number(a), Number(b), t) * 1000) / 1000);
    else if (prop === "visibility") out[prop] = t < 1 ? a : b; // discrete
    else if (prop === "transform") { const x = parseXf(a), y = parseXf(b); const r = { a: lerp(x.a, y.a, t), b: lerp(x.b, y.b, t), s: lerp(x.s, y.s, t), c: lerp(x.c, y.c, t), d: lerp(x.d, y.d, t) }; out[prop] = `translate(${r.a.toFixed(2)} ${r.b.toFixed(2)}) scale(${r.s.toFixed(4)}) translate(${r.c.toFixed(2)} ${r.d.toFixed(2)})`; }
    else out[prop] = t < 1 ? a : b;
  }
  return out;
}

/**
 * Replace every renderer-generated animation (inline or by rule) with its static value at time t. Flow and pulse
 * are handled elsewhere; this covers camera, state, level-of-detail, caption, step and tour tracks.
 */
export function freezeTracks(svg: string, tMs: number): string {
  const styleMatch = svg.match(/<style>([\s\S]*?)<\/style>/);
  if (!styleMatch) return svg;
  const css = styleMatch[1]!;
  const frames = parseKeyframes(css);
  const staticOf = (name: string, durS: number): string | null => {
    const kf = frames.get(name);
    if (!kf) return null;
    const phase = ((tMs / 1000) % durS) / durS;
    const v = valuesAt(kf, phase);
    // transform is emitted as an SVG attribute (every renderer honours it), the rest as inline style
    return Object.entries(v).map(([k, val]) => `${k}:${val}`).join(";");
  };
  let out = svg;
  // inline animations on elements
  out = out.replace(/<(g|text) ([^>]*?)style="animation:(orrery-(?:camera|state|lod|caption|step|tour|play)[\w-]*) ([\d.]+)s (?:linear|step-end) infinite"/g, (whole, tag: string, attrs: string, name: string, dur: string) => {
    const st = staticOf(name, Number(dur));
    if (st === null) return whole;
    const tf = st.match(/transform:([^;]+)/);
    const rest = st.replace(/transform:[^;]+;?/, "").replace(/;$/, "");
    return `<${tag} ${attrs}${tf ? `transform="${tf[1]}" ` : ""}style="${rest}"`;
  });
  // rule-based animations (level of detail): append a static rule with the same selector after the stylesheet
  const rules: string[] = [];
  for (const m of css.matchAll(/([^{}\n]+)\{animation:(orrery-lod-[\w-]+) ([\d.]+)s linear infinite\}/g)) {
    const st = staticOf(m[2]!, Number(m[3]));
    if (st !== null) rules.push(`${m[1]!.trim()}{${st}}`);
  }
  if (rules.length) out = out.replace("</style>", `\n${rules.join("\n")}\n</style>`);
  return out;
}
