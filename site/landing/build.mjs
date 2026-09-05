// Assemble the landing page from its template and the static renders next to it. Usage: node site/landing/build.mjs
// Output: site/dist/index.html (also copied to the scratch path the Artifact tool publishes from, if given as argv[2]).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const dir = new URL(".", import.meta.url).pathname;
let html = readFileSync(join(dir, "index.template.html"), "utf8");
for (const name of ["solar", "failover-play", "quorum", "checkout-data"]) {
  // Inline the SVG scaled by its viewBox; drop the fixed size and the document title so the page's own text carries.
  const svg = readFileSync(join(dir, `${name}.svg`), "utf8").replace(/ width="[\d.]+" height="[\d.]+"/, "").replace(/<title>[^<]*<\/title>\n?/, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  html = html.replace(`<!--svg:${name}-->`, svg);
}
mkdirSync(join(dir, "../dist"), { recursive: true });
writeFileSync(join(dir, "../dist/index.html"), html);
if (process.argv[2]) writeFileSync(process.argv[2], html);
console.log(`landing page: ${html.length} bytes`);
