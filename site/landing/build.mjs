// Assemble the landing page from its template and the static renders next to it. Usage: node site/landing/build.mjs
// Output: site/dist/index.html (also copied to the scratch path the Artifact tool publishes from, if given as argv[2]).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = new URL(".", import.meta.url).pathname;
let html = readFileSync(join(dir, "index.template.html"), "utf8");
for (const name of ["solar", "failover-play", "quorum", "checkout-data"]) {
  // Inline the SVG. Keep width/height (the intrinsic size browsers scale from) and add an explicit aspect ratio;
  // drop the document title so the page's own text carries.
  const raw = readFileSync(join(dir, `${name}.svg`), "utf8");
  const [, w, h] = raw.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const svg = raw.replace(/<svg /, `<svg style="aspect-ratio:${w} / ${h}" `).replace(/<title>[^<]*<\/title>\n?/, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  html = html.replace(`<!--svg:${name}-->`, svg);
}
/**
 * A working orrery, generated: an engraved ecliptic ring, orbits spaced geometrically for the eye, and planets whose
 * periods are to scale (Kepler: T ∝ a^1.5, taken from the real sidereal years). Earth takes one minute. Distances
 * are not to scale; the caption on the page says so.
 */
function orrery(size, earthSeconds, cls) {
  const c = size / 2, R = c - 8;
  const planets = [
    { name: "Mercury", years: 0.2408, r: 2.2, fill: "#D9CFB8" },
    { name: "Venus", years: 0.6152, r: 3.2, fill: "#E9E4D6" },
    { name: "Earth", years: 1, r: 3.4, fill: "#2563EB", moon: { years: 0.0748, dist: 9, r: 1.1 } },
    { name: "Mars", years: 1.8809, r: 2.6, fill: "#C98C6A" },
    { name: "Jupiter", years: 11.862, r: 5.2, fill: "#E3D6BE" },
  ];
  const first = R * 0.30, ratio = Math.pow((R * 0.86) / first, 1 / (planets.length - 1));
  const orbits = planets.map((p, i) => ({ ...p, a: first * Math.pow(ratio, i) }));
  const tick = (deg, len, w) => { const a = (deg * Math.PI) / 180; return `<line x1="${(c + (R - len) * Math.cos(a)).toFixed(2)}" y1="${(c + (R - len) * Math.sin(a)).toFixed(2)}" x2="${(c + R * Math.cos(a)).toFixed(2)}" y2="${(c + R * Math.sin(a)).toFixed(2)}" stroke-width="${w}"/>`; };
  const ticks = [];
  for (let d = 0; d < 360; d++) ticks.push(tick(d, d % 90 === 0 ? 14 : d % 30 === 0 ? 9 : 4, d % 30 === 0 ? 1 : 0.5));
  const bodies = orbits.map((p, i) => {
    const dur = (p.years * earthSeconds).toFixed(2), delay = (-(i * 7.3) % (p.years * earthSeconds)).toFixed(2);
    const moon = p.moon ? `<g class="o-turn" style="animation-duration:${(p.moon.years * earthSeconds).toFixed(2)}s" transform-origin="${(c + p.a).toFixed(2)} ${c}"><circle cx="${(c + p.a + p.moon.dist).toFixed(2)}" cy="${c}" r="${p.moon.r}" fill="#E9E4D6"/></g>` : "";
    return `<g class="o-turn" style="animation-duration:${dur}s;animation-delay:${delay}s"><circle cx="${(c + p.a).toFixed(2)}" cy="${c}" r="${p.r}" fill="${p.fill}"/>${moon}<title>${p.name}, ${p.years} years</title></g>`;
  }).join("");
  return `<svg class="${cls}" viewBox="0 0 ${size} ${size}" aria-hidden="true">
<g class="o-engrave">${ticks.join("")}</g>
<circle class="o-ring" cx="${c}" cy="${c}" r="${R - 18}"/>
${orbits.map((p) => `<circle class="o-orbit" cx="${c}" cy="${c}" r="${p.a.toFixed(2)}"/>`).join("")}
<circle cx="${c}" cy="${c}" r="6.5" fill="#C9A15A"/><circle cx="${c}" cy="${c}" r="13" fill="none" stroke="#C9A15A" stroke-opacity=".35" stroke-width=".8"/>
<g transform-origin="${c} ${c}" class="o-bodies">${bodies}</g>
</svg>`;
}
html = html.replace("<!--orrery:hero-->", orrery(640, 60, "o-orrery o-orrery-hero")).replace("<!--orrery:close-->", orrery(900, 60, "o-orrery o-orrery-close"));
mkdirSync(join(dir, "../dist"), { recursive: true });
writeFileSync(join(dir, "../dist/index.html"), html);
if (process.argv[2]) writeFileSync(process.argv[2], html);
console.log(`landing page: ${html.length} bytes`);
