import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeGlyph, validate, type Glyph, type Pack } from "../src/index.js";

const root = join(import.meta.dirname, "../../..");
const ok = (svg: string) => { const r = sanitizeGlyph(svg); if (!r.ok) throw new Error(r.reason); return r.svg; };
const bad = (svg: string) => { const r = sanitizeGlyph(svg); return r.ok ? undefined : r.reason; };
const model = (svg: string) => validate({ kinds: { components: { own: { glyph: { viewBox: "0 0 10 10", svg } } } }, components: [{ id: "a", kind: "own" }] });

describe("glyph markup is rebuilt from an allowlist, never passed through (S15)", () => {
  it("refuses a link whose target is entity-encoded, the bypass an outside review found", () => {
    // The old check looked for the literal string "javascript:"; XML decodes &#106; to "j" before the browser sees it.
    const payload = '<a xlink:href="&#106;avascript:alert(1)"><rect width="10" height="10"/></a>';
    expect(bad(payload)).toMatch(/element "a" is not allowed/);
    const r = model(payload);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.toString())).toEqual(['/kinds/components/own/glyph/svg: must be drawing markup only: element "a" is not allowed']);
  });
  it("refuses what can run, load, link or rewrite: script, handlers, SMIL, foreignObject, external references", () => {
    expect(bad('<script>alert(1)</script>')).toMatch(/element "script"/);
    expect(bad('<ScRiPt>alert(1)</ScRiPt>')).toMatch(/element "ScRiPt"/);
    expect(bad('<rect width="1" height="1" onload="alert(1)"/>')).toMatch(/attribute "onload"/);
    expect(bad('<rect width="1" height="1" onLoad="alert(1)"/>')).toMatch(/attribute "onLoad"/);
    expect(bad('<use href="#a"><set attributeName="href" to="javascript:alert(1)"/></use>')).toMatch(/element "set"/);
    expect(bad('<rect><animate attributeName="href" to="x"/></rect>')).toMatch(/element "animate"/);
    expect(bad('<foreignObject><body xmlns="http://www.w3.org/1999/xhtml"/></foreignObject>')).toMatch(/element "foreignObject"/);
    expect(bad('<image href="https://example.com/x.svg"/>')).toMatch(/element "image"/);
    expect(bad('<use href="https://example.com/x.svg#a"/>')).toMatch(/href must point at an id in this glyph/);
    expect(bad('<use href="data:image/svg+xml,x"/>')).toMatch(/href must point at an id/);
    expect(bad('<use xlink:href="&#x68;ttp://example.com/#a"/>')).toMatch(/href must point at an id/);
    expect(bad('<feImage href="https://example.com/x.png"/>')).toMatch(/element "feImage"/);
    expect(bad('<style>rect{fill:url(http://x)}</style>')).toMatch(/element "style"/);
    expect(bad('<rect fill="url(http://example.com/x)"/>')).toMatch(/url\(\) may only name an id/);
    expect(bad('<rect style="fill:url(&quot;http://x&quot;)"/>')).toMatch(/url\(\) may only name an id/);
    expect(bad('<rect style="behavior:url(x.htc)"/>')).toMatch(/style property "behavior"/);
    expect(bad('<rect style="fill:red;-moz-binding:url(x)"/>')).toMatch(/style property "-moz-binding"/);
    expect(bad('<rect width="1" xmlns:x="http://x" x:y="1"/>')).toMatch(/attribute "x:y"/);
  });
  it("refuses what a parser could read differently: comments, CDATA, directives, text, entities it does not know, bad nesting", () => {
    expect(bad('<!-- --><rect/>')).toMatch(/comments/);
    expect(bad('<![CDATA[<script>]]>')).toMatch(/CDATA/);
    expect(bad('<?xml version="1.0"?><rect/>')).toMatch(/directives/);
    expect(bad('<!DOCTYPE svg [<!ENTITY x "y">]><rect/>')).toMatch(/directives/);
    expect(bad('<g>hello</g>')).toMatch(/text/);
    expect(bad('<rect d="&nbsp;"/>')).toMatch(/entity/);
    expect(bad('<g><rect/></p>')).toMatch(/closing/);
    expect(bad('<g><rect/>')).toMatch(/unclosed/);
    expect(bad('<rect width="1" width="2"/>')).toMatch(/repeated attribute/);
    expect(bad("<rect width='1\"/>")).toMatch(/attribute value/);
    expect(bad('<rect id="a b"/>')).toMatch(/id/);
    expect(bad('')).toMatch(/empty/);
  });
  it("accepts drawing markup and rebuilds it canonically, so what renders is what was allowed", () => {
    expect(ok('<path d="M0 0h10v10z" fill="#f00"/>')).toBe('<path d="M0 0h10v10z" fill="#f00"/>');
    expect(ok("<g><rect x='1' y='1' width='8' height='8' rx='2' style='fill:#0f0; stroke: #000'/></g>")).toBe('<g><rect x="1" y="1" width="8" height="8" rx="2" style="fill:#0f0;stroke:#000"/></g>');
    expect(ok('<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/>'))
      .toContain('fill="url(#g)"');
    expect(ok('<use href="#a" xlink:href="#a"/>')).toBe('<use href="#a" xlink:href="#a"/>');
    expect(ok('<circle cx="5" cy="5" r="4" fill="&#35;abc" />')).toBe('<circle cx="5" cy="5" r="4" fill="#abc"/>'); // decoded, then written plainly
    expect(ok('<path d="M0 0" fill="a&amp;b&lt;c&gt;&quot;"/>')).toBe('<path d="M0 0" fill="a&amp;b&lt;c&gt;&quot;"/>');
    expect(ok(' <rect width="1" height="1"/>\n<circle r="1"/> ')).toBe('<rect width="1" height="1"/><circle r="1"/>');
  });
  it("accepts every icon in every provider pack unchanged, so the packs were built through the same door", () => {
    for (const name of ["aws", "azure", "gcp"]) {
      const pack = JSON.parse(readFileSync(join(root, `packages/pack-${name}/pack.json`), "utf8")) as Pack;
      let n = 0;
      for (const [kind, def] of Object.entries(pack.kinds!.components!)) {
        const g = def.glyph as Glyph;
        const r = sanitizeGlyph(g.svg);
        expect(r.ok, `${name}:${kind}: ${r.ok ? "" : r.reason}`).toBe(true);
        if (r.ok) expect(r.svg, `${name}:${kind}`).toBe(g.svg);
        n++;
      }
      expect(n).toBeGreaterThan(200);
    }
  });
  it("keeps the sanitized markup in the model, so the renderer draws what was allowed", () => {
    const r = validate({ kinds: { components: { own: { glyph: { viewBox: "0 0 10 10", svg: "<rect  width='10'   height='10' fill='&#35;abc'/>" } } } }, components: [{ id: "a", kind: "own" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.model.kinds.components.own!.glyph as Glyph).svg).toBe('<rect width="10" height="10" fill="#abc"/>');
  });
});
