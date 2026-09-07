/**
 * Icon glyph markup, rebuilt from an allowlist (S15). A model file is untrusted input for a library, and a glyph is
 * markup the renderer embeds in the picture, so it is parsed, every element and attribute checked against what a
 * drawing needs, and serialised again from the parsed tree. Nothing in the input reaches the output as written:
 * not comments, not entities, not an attribute the list does not name. What can run, load, link, or rewrite the
 * document at runtime is simply not on the list: script, handlers, SMIL animation, foreignObject, image, links,
 * external references. The provider packs are built through the same door (tools/packs/build.mjs).
 */

export type GlyphCheck = { ok: true; svg: string } | { ok: false; reason: string };

/** Elements a drawing needs: shapes, groups, gradients, clips, masks and the filter primitives exported icons carry. */
const ELEMENTS = new Set([
  "g", "defs", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "use",
  "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "symbol",
  "filter", "feBlend", "feColorMatrix", "feComposite", "feFlood", "feGaussianBlur", "feMerge", "feMergeNode", "feOffset",
]);
/** Attributes a drawing needs. Presentation and geometry only; `href` is checked separately, `style` is parsed. */
const ATTRIBUTES = new Set([
  "id", "transform", "style", "href", "xlink:href",
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "color", "display", "visibility", "paint-order",
  "isolation", "mix-blend-mode", "vector-effect", "shape-rendering", "clip-path", "clip-rule", "mask", "filter",
  "d", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "width", "height", "points",
  "offset", "stop-color", "stop-opacity", "gradientUnits", "gradientTransform", "spreadMethod",
  "clipPathUnits", "maskUnits", "maskContentUnits", "patternUnits", "patternContentUnits", "patternTransform", "viewBox", "preserveAspectRatio",
  "filterUnits", "primitiveUnits", "color-interpolation-filters", "flood-color", "flood-opacity",
  "in", "in2", "result", "type", "values", "mode", "operator", "stdDeviation", "dx", "dy", "k1", "k2", "k3", "k4",
]);
/** Style properties a drawing needs; the same presentation set, as CSS. */
const STYLE_PROPERTIES = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
  "stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "color", "display", "visibility", "paint-order",
  "isolation", "mix-blend-mode", "vector-effect", "shape-rendering", "clip-path", "clip-rule", "mask", "filter",
  "stop-color", "stop-opacity", "flood-color", "flood-opacity", "transform", "transform-origin", "color-interpolation-filters",
]);

const ID = /^[A-Za-z_][\w.-]*$/;
const ID_REF = /^#[A-Za-z_][\w.-]*$/;
const XML_NAME = /^[A-Za-z_:][\w.:-]*$/;
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as const;

class Rejected extends Error {}
const refuse = (reason: string): never => { throw new Rejected(reason); };

/** XML entity decoding, the five named ones and character references; anything else is refused. */
function decode(value: string): string {
  return value.replace(/&([^;]{0,10});?/g, (m, body: string) => {
    if (!m.endsWith(";")) return refuse(`unknown entity "${m}"`);
    if (Object.hasOwn(NAMED, body)) return NAMED[body as keyof typeof NAMED];
    const code = /^#x([0-9a-fA-F]{1,6})$/.exec(body) ? parseInt(body.slice(2), 16) : /^#(\d{1,7})$/.exec(body) ? parseInt(body.slice(1), 10) : NaN;
    if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff) return refuse(`unknown entity "${m}"`);
    return String.fromCodePoint(code);
  });
}
const encode = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** `url(…)` in a paint, clip, mask or filter value may only name an id in this glyph. */
function checkUrls(value: string, where: string): void {
  for (const m of value.matchAll(/url\(\s*(['"]?)([^)'"]*)\1\s*\)/gi)) if (!ID_REF.test(m[2]!.trim())) refuse(`${where}: url() may only name an id in this glyph, like url(#g)`);
  if (/url\s*\(/i.test(value) && !/url\(\s*(['"]?)#[A-Za-z_][\w.-]*\1\s*\)/.test(value)) refuse(`${where}: url() may only name an id in this glyph, like url(#g)`);
}
/** A `style` attribute: declarations of allowed properties, rebuilt as `prop:value;…`. */
function checkStyle(value: string): string {
  if (/[<>\\{}@]/.test(value) || /expression\s*\(/i.test(value)) refuse("style: markup, escapes and at-rules are not allowed");
  const out: string[] = [];
  for (const declaration of value.split(";")) {
    if (!declaration.trim()) continue;
    const colon = declaration.indexOf(":");
    if (colon < 0) refuse(`style: "${declaration.trim()}" is not a declaration`);
    const prop = declaration.slice(0, colon).trim(), v = declaration.slice(colon + 1).trim();
    if (!STYLE_PROPERTIES.has(prop)) refuse(`style property "${prop}" is not allowed`);
    checkUrls(v, `style ${prop}`);
    out.push(`${prop}:${v}`);
  }
  return out.join(";");
}
/** One attribute, decoded, checked, and given back ready to write. */
function checkAttribute(element: string, name: string, raw: string): string {
  if (!ATTRIBUTES.has(name)) refuse(`attribute "${name}" is not allowed on <${element}>`);
  const value = decode(raw);
  if (name === "href" || name === "xlink:href") { if (!ID_REF.test(value.trim())) refuse("href must point at an id in this glyph, like #g"); return value.trim(); }
  if (name === "id") { if (!ID.test(value)) refuse(`id "${value}" must be a plain name`); return value; }
  if (name === "style") return checkStyle(value);
  checkUrls(value, `attribute ${name}`);
  return value;
}

/**
 * Parse, check and rebuild glyph markup. Returns the canonical markup, or the first reason it was refused. Pure.
 * Refused outright, whatever they contain: comments, CDATA, processing instructions, doctype, text content.
 */
export function sanitizeGlyph(svg: string): GlyphCheck {
  try {
    if (!svg.trim()) refuse("empty markup");
    const out: string[] = [];
    const open: string[] = [];
    let i = 0;
    const n = svg.length;
    while (i < n) {
      const lt = svg.indexOf("<", i);
      const text = lt < 0 ? svg.slice(i) : svg.slice(i, lt);
      if (text.trim()) refuse("text content is not allowed; a glyph is shapes only");
      if (lt < 0) break;
      if (svg.startsWith("<!--", lt)) refuse("comments are not allowed");
      if (svg.startsWith("<![CDATA[", lt)) refuse("CDATA sections are not allowed");
      if (svg.startsWith("<!", lt) || svg.startsWith("<?", lt)) refuse("directives and processing instructions are not allowed");
      if (svg.startsWith("</", lt)) {
        const gt = svg.indexOf(">", lt);
        if (gt < 0) refuse("unclosed tag");
        const name = svg.slice(lt + 2, gt).trim();
        const expected = open.pop();
        if (expected === undefined || name !== expected) refuse(`closing </${name}> does not match <${expected ?? ""}>`);
        out.push(`</${name}>`);
        i = gt + 1;
        continue;
      }
      // an opening or empty tag: name, then attributes until "/>" or ">"
      let j = lt + 1;
      const nameStart = j;
      while (j < n && /[\w.:-]/.test(svg[j]!)) j++;
      const name = svg.slice(nameStart, j);
      if (!XML_NAME.test(name)) refuse("malformed tag");
      if (!ELEMENTS.has(name)) refuse(`element "${name}" is not allowed`);
      const seen = new Set<string>();
      const attrs: string[] = [];
      let selfClosing = false;
      for (;;) {
        while (j < n && /\s/.test(svg[j]!)) j++;
        if (j >= n) refuse("unclosed tag");
        if (svg.startsWith("/>", j)) { selfClosing = true; j += 2; break; }
        if (svg[j] === ">") { j++; break; }
        const attrStart = j;
        while (j < n && /[\w.:-]/.test(svg[j]!)) j++;
        const attr = svg.slice(attrStart, j);
        if (!XML_NAME.test(attr)) refuse("malformed tag");
        while (j < n && /\s/.test(svg[j]!)) j++;
        if (svg[j] !== "=") refuse(`attribute "${attr}" has no value`);
        j++;
        while (j < n && /\s/.test(svg[j]!)) j++;
        const quote = svg[j] ?? "";
        if (quote !== '"' && quote !== "'") refuse(`attribute "${attr}": attribute value must be quoted`);
        const end = svg.indexOf(quote, j + 1);
        if (end < 0) refuse(`attribute "${attr}": attribute value is not closed`);
        const raw = svg.slice(j + 1, end);
        if (raw.includes("<")) refuse(`attribute "${attr}": attribute value must not contain "<"`);
        j = end + 1;
        if (seen.has(attr)) refuse(`repeated attribute "${attr}"`);
        seen.add(attr);
        if (attr.startsWith("xmlns")) continue; // namespace declarations are implied by the document
        attrs.push(` ${attr}="${encode(checkAttribute(name, attr, raw))}"`);
      }
      out.push(`<${name}${attrs.join("")}${selfClosing ? "/>" : ">"}`);
      if (!selfClosing) { open.push(name); if (open.length > 64) refuse("nested too deep"); }
      i = j;
    }
    if (open.length) refuse(`unclosed <${open[open.length - 1]}>`);
    return { ok: true, svg: out.join("") };
  } catch (e) {
    if (e instanceof Rejected) return { ok: false, reason: e.message };
    throw e;
  }
}
