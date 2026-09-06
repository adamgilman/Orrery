// Assemble the landing page from its template, a theme, and the static renders next to it.
// Usage: node site/landing/build.mjs [out.html] [--theme clockwork|planetarium]
// Output: site/dist/index.html (also copied to the scratch path the Artifact tool publishes from, if given).
// A theme is two fragments in themes/: <name>.head.html (font links and the stylesheet) and <name>.tail.html
// (any script), plus the hero mechanism it asks for below. Structure and copy live in the template alone.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = new URL(".", import.meta.url).pathname;
const args = process.argv.slice(2);
const themeAt = args.indexOf("--theme");
const theme = themeAt >= 0 ? args[themeAt + 1] : "clockwork";
const out = args.find((a, i) => !a.startsWith("--") && i !== themeAt + 1);
let html = readFileSync(join(dir, "index.template.html"), "utf8");
html = html.replace("<!--theme-->", readFileSync(join(dir, `themes/${theme}.head.html`), "utf8"));
html = html.replace("<!--theme-script-->", readFileSync(join(dir, `themes/${theme}.tail.html`), "utf8"));
for (const name of ["solar", "failover-play", "vocabulary-play", "data-view", "drill-down-tour", "shapes", "packs-aws"]) {
  // Inline the SVG. Keep width/height (the intrinsic size browsers scale from) and add an explicit aspect ratio;
  // drop the document title so the page's own text carries.
  const raw = readFileSync(join(dir, `${name}.svg`), "utf8");
  const [, w, h] = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const svg = raw.replace(/<svg /, `<svg style="aspect-ratio:${w} / ${h}" `).replace(/<title>[^<]*<\/title>\n?/, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  html = html.replace(`<!--svg:${name}-->`, svg);
}

const f2 = (v) => v.toFixed(2);
/** 360 graduation ticks around a circle of radius R centred at c; long every 30° and 90°. */
function graduation(c, R) {
  const tick = (deg, len, w) => { const a = (deg * Math.PI) / 180; return `<line x1="${f2(c + (R - len) * Math.cos(a))}" y1="${f2(c + (R - len) * Math.sin(a))}" x2="${f2(c + R * Math.cos(a))}" y2="${f2(c + R * Math.sin(a))}" stroke-width="${w}"/>`; };
  const ticks = [];
  for (let d = 0; d < 360; d++) ticks.push(tick(d, d % 90 === 0 ? 14 : d % 30 === 0 ? 9 : 4, d % 30 === 0 ? 1 : 0.5));
  return ticks.join("");
}

/**
 * Planetarium: a working orrery, generated. Orbits spaced geometrically for the eye, planets whose periods are to
 * scale (Kepler: T ∝ a^1.5, from the real sidereal years). Earth takes one minute. Distances are not to scale.
 */
function orrery(size, earthSeconds, cls) {
  const c = size / 2, R = c - 8;
  const planets = [
    { name: "Mercury", years: 0.2408, r: 2.2, fill: "#C9CEDD" },
    { name: "Venus", years: 0.6152, r: 3.2, fill: "#F2F4FF" },
    { name: "Earth", years: 1, r: 3.4, fill: "#5B8CFF", moon: { years: 0.0748, dist: 9, r: 1.1 } },
    { name: "Mars", years: 1.8809, r: 2.6, fill: "#E7B79A" },
    { name: "Jupiter", years: 11.862, r: 5.2, fill: "#E9E2CF" },
  ];
  const first = R * 0.3, ratio = Math.pow((R * 0.86) / first, 1 / (planets.length - 1));
  const orbits = planets.map((p, i) => ({ ...p, a: first * Math.pow(ratio, i) }));
  const bodies = orbits.map((p, i) => {
    const dur = f2(p.years * earthSeconds), delay = f2(-(i * 7.3) % (p.years * earthSeconds));
    const moon = p.moon ? `<g class="o-turn" style="animation-duration:${f2(p.moon.years * earthSeconds)}s;transform-origin:${f2(c + p.a)}px ${c}px"><circle cx="${f2(c + p.a + p.moon.dist)}" cy="${c}" r="${p.moon.r}" fill="#F2F4FF"/></g>` : "";
    return `<g class="o-turn" style="animation-duration:${dur}s;animation-delay:${delay}s"><circle cx="${f2(c + p.a)}" cy="${c}" r="${p.r}" fill="${p.fill}"/>${moon}<title>${p.name}, ${p.years} years</title></g>`;
  }).join("");
  return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
<g class="o-engrave">${graduation(c, R)}</g>
<circle class="o-ring" cx="${c}" cy="${c}" r="${R - 18}"/>
${orbits.map((p) => `<circle class="o-orbit" cx="${c}" cy="${c}" r="${f2(p.a)}"/>`).join("")}
<circle class="o-sun" cx="${c}" cy="${c}" r="6.5"/><circle class="o-sun-halo" cx="${c}" cy="${c}" r="13"/>
<g transform-origin="${c} ${c}" class="o-bodies">${bodies}</g>
</svg>`;
}

/** A gear as a path: `teeth` trapezoid teeth on pitch radius `r`, centred at (0,0). */
function gearPath(teeth, r) {
  const add = r * 0.11, ded = r * 0.12, half = Math.PI / teeth;
  const pt = (rad, ang) => `${f2(rad * Math.cos(ang))} ${f2(rad * Math.sin(ang))}`;
  const pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * 2 * half;
    pts.push(pt(r - ded, a - half * 0.55), pt(r - ded, a - half * 0.45), pt(r + add, a - half * 0.22), pt(r + add, a + half * 0.22), pt(r - ded, a + half * 0.45), pt(r - ded, a + half * 0.55));
  }
  return `M${pts.join(" L")} Z`;
}

/**
 * Clockwork: a gimbal of rings turning at different rates around a lamp, and a gear train that meshes at true
 * ratios (a gear of n teeth turns 30/n times as fast as the 30-tooth drive, the other way). Cold steel, one ember.
 */
function mechanism(size, cls) {
  const c = size / 2, R = c - 8;
  // Rings seen at an angle: ellipses with the ratio of a tilted circle, each spinning in the plane at its own rate.
  const rings = [
    { rx: R * 0.78, tilt: 0.22, tilt0: 18, period: 96 },
    { rx: R * 0.66, tilt: 0.5, tilt0: -34, period: 150, ember: true },
    { rx: R * 0.56, tilt: 0.86, tilt0: 62, period: 210 },
  ].map((g, i) => {
    const ry = g.rx * g.tilt, len = 2 * Math.PI * Math.sqrt((g.rx * g.rx + ry * ry) / 2);
    const run = g.ember ? `<ellipse class="m-run" cx="${c}" cy="${c}" rx="${f2(g.rx)}" ry="${f2(ry)}" style="stroke-dasharray:${f2(len * 0.08)} ${f2(len * 0.92)};animation-duration:${g.period / 3}s"/>` : "";
    return `<g class="o-turn" style="animation-duration:${g.period}s;animation-direction:${i % 2 ? "reverse" : "normal"}"><g transform="rotate(${g.tilt0} ${c} ${c})"><ellipse class="m-ring" cx="${c}" cy="${c}" rx="${f2(g.rx)}" ry="${f2(ry)}"/>${run}</g></g>`;
  }).join("");
  // The gear train, lower left, driven from a 30-tooth gear.
  const drive = { teeth: 30, r: 78 }, gx = c - R * 0.36, gy = c + R * 0.34;
  const train = [
    { teeth: 30, r: 78, x: gx, y: gy, dir: 1 },
    { teeth: 15, r: 39, x: gx + (78 + 39) * Math.cos(-0.9), y: gy + (78 + 39) * Math.sin(-0.9), dir: -1, phase: 180 / 15 },
    { teeth: 48, r: 124.8, x: gx + (78 + 124.8) * Math.cos(0.42), y: gy + (78 + 124.8) * Math.sin(0.42), dir: -1, phase: 180 / 48 },
  ];
  const period = 60;
  const gears = train.map((g) => {
    const dur = f2((period * g.teeth) / drive.teeth);
    return `<g transform="translate(${f2(g.x)} ${f2(g.y)}) rotate(${g.phase ?? 0})"><g class="o-turn m-gear" style="animation-duration:${dur}s;animation-direction:${g.dir < 0 ? "reverse" : "normal"};transform-origin:0 0"><path d="${gearPath(g.teeth, g.r)}"/><circle class="m-hub" r="${f2(g.r * 0.18)}"/><circle class="m-spoke" r="${f2(g.r * 0.62)}"/></g></g>`;
  }).join("");
  return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
<g class="o-engrave o-turn" style="animation-duration:480s;transform-origin:${c}px ${c}px">${graduation(c, R)}</g>
<circle class="m-bezel" cx="${c}" cy="${c}" r="${R - 18}"/>
<g class="o-bodies">${rings}</g>
${gears}
<circle class="m-lamp" cx="${c}" cy="${c}" r="7"/><circle class="m-lamp-halo" cx="${c}" cy="${c}" r="16"/>
</svg>`;
}

const hero = theme === "planetarium" ? orrery(640, 60, "o-orrery o-orrery-hero") : mechanism(640, "o-orrery o-orrery-hero");
const close = theme === "planetarium" ? orrery(900, 60, "o-orrery o-orrery-close") : mechanism(900, "o-orrery o-orrery-close");
html = html.replace("<!--orrery:hero-->", hero).replace("<!--orrery:close-->", close);
mkdirSync(join(dir, "../dist"), { recursive: true });
writeFileSync(join(dir, "../dist/index.html"), html);
if (out) writeFileSync(out, html);
console.log(`landing page (${theme}): ${html.length} bytes`);
