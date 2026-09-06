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

/**
 * A transform list of translate() and scale() functions, as the renderer writes them: an entity's position, or the
 * camera (translate to the stage centre, scale, translate the zoom target's centre to the origin). `none` is the identity
 * in the shape of whatever it is paired with.
 */
type Fn = { name: "translate" | "scale"; args: number[] };
const parseTransform = (v: string): Fn[] => {
  if (v === "none") return [];
  const fns = [...v.matchAll(/(translate|scale)\(([^)]*)\)/g)].map((m) => ({ name: m[1] as Fn["name"], args: m[2]!.split(/[ ,]+/).filter(Boolean).map((a) => Number(a.replace("px", ""))) }));
  if (!fns.length) throw new Error(`unsupported transform "${v}"`);
  return fns;
};
const identityLike = (shape: Fn[]): Fn[] => shape.map((f) => ({ name: f.name, args: f.args.map(() => (f.name === "scale" ? 1 : 0)) }));
const lerp = (p: number, q: number, t: number) => p + (q - p) * t;
/** Interpolate two transform lists of the same shape, component by component, into SVG attribute syntax. */
function lerpTransform(a: string, b: string, t: number): string {
  let x = parseTransform(a), y = parseTransform(b);
  if (!x.length) x = identityLike(y);
  if (!y.length) y = identityLike(x);
  if (x.length !== y.length || x.some((f, i) => f.name !== y[i]!.name || f.args.length !== y[i]!.args.length)) throw new Error(`transforms "${a}" and "${b}" have different shapes`);
  return x.map((f, i) => `${f.name}(${f.args.map((v, j) => lerp(v, y[i]!.args[j]!, t).toFixed(f.name === "scale" ? 4 : 2)).join(" ")})`).join(" ");
}
const NUMERIC = new Set(["width", "height", "x", "y"]);

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
    else if (prop === "transform") out[prop] = lerpTransform(a, b, t);
    else if (NUMERIC.has(prop)) out[prop] = String(Math.round(lerp(parseFloat(a), parseFloat(b), t) * 100) / 100);
    else out[prop] = t < 1 ? a : b;
  }
  return out;
}

/**
 * Replace every renderer-generated animation with its static value at time t. Flow and pulse are handled elsewhere;
 * this covers the camera, positions, sizes, visibility, state variants, edges, legends, captions, steps and tours.
 * Geometry (transform, width, height, x, y) is written as attributes, which every renderer honours; the rest inline.
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
  // Inline animations on elements. An attribute the static value replaces is dropped from the tag first.
  return svg.replace(/<(g|text|rect) ([^>]*?)style="animation:(orrery-(?!flow|pulse)[\w-]+) ([\d.]+)s (?:linear|step-end) infinite"/g, (whole, tag: string, attrs: string, name: string, dur: string) => {
    const st = staticOf(name, Number(dur));
    if (st === null) return whole;
    const attributes: string[] = [], styles: string[] = [];
    for (const decl of st.split(";")) {
      const i = decl.indexOf(":"), k = decl.slice(0, i), v = decl.slice(i + 1);
      if (k === "transform" || NUMERIC.has(k)) { attrs = attrs.replace(new RegExp(` ?${k}="[^"]*"`), ""); attributes.push(`${k}="${v}"`); } else styles.push(decl);
    }
    return `<${tag} ${attrs.trim()} ${attributes.join(" ")}${attributes.length ? " " : ""}style="${styles.join(";")}"`;
  });
}
