// Builds site/index.html from examples/*.orrery.json (+ fixtures/valid) by rendering each with the CLI.
// Usage: node site/build.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const cli = join(root, "packages/cli/dist/main.js");
const out = join(root, "site/dist");
mkdirSync(join(out, "svg"), { recursive: true });

const sources = [
  ...readdirSync(join(root, "examples/readme")).filter((f) => f.endsWith(".orrery.json")).map((f) => join(root, "examples/readme", f)),
  ...readdirSync(join(root, "examples")).filter((f) => f.endsWith(".orrery.json")).map((f) => join(root, "examples", f)),
  ...readdirSync(join(root, "fixtures/valid")).filter((f) => !readdirSync(join(root, "examples")).includes(f.replace(/\.json$/, ".orrery.json"))).map((f) => join(root, "fixtures/valid", f)),
];

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cards = sources.map((file) => {
  const name = basename(file).replace(/\.orrery\.json$|\.json$/, "");
  const json = readFileSync(file, "utf8");
  const svg = execFileSync("node", [cli, "render", file], { encoding: "utf8" });
  writeFileSync(join(out, "svg", `${name}.svg`), svg);
  const d = JSON.parse(json);
  return `
<section class="card" id="${name}">
  <h2>${esc(d.title ?? name)} <span class="meta">${d.nodes.length} nodes · ${d.edges.length} edges · direction ${d.direction ?? "right"}</span></h2>
  <div class="tabs">
    <button data-tab="img" class="on">as &lt;img&gt; (how GitHub shows it)</button>
    <button data-tab="inline">inline SVG</button>
    <button data-tab="json">source JSON</button>
  </div>
  <div class="pane on" data-pane="img"><div class="scroll"><img src="svg/${name}.svg" alt="${esc(d.title ?? name)}"></div>
    <p class="hint">Plain image tag. Script and pointer events are stripped in this mode, animation is not. <a href="svg/${name}.svg" target="_blank">Open the SVG file</a>.</p></div>
  <div class="pane" data-pane="inline"><div class="scroll">${svg}</div></div>
  <div class="pane" data-pane="json"><pre><code>${esc(json)}</code></pre></div>
</section>`;
});

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orrery examples</title>
<style>
:root{--bg:#f8fafc;--fg:#0f172a;--muted:#64748b;--card:#fff;--line:#e2e8f0;--accent:#2563eb}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{padding:28px 32px 8px}header h1{margin:0;font-size:26px}header p{margin:4px 0 0;color:var(--muted)}
main{padding:8px 32px 48px;display:grid;gap:24px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 20px}
.card h2{margin:0 0 10px;font-size:18px}.meta{font-weight:400;color:var(--muted);font-size:13px;margin-left:8px}
.tabs{display:flex;gap:6px;margin-bottom:10px}.tabs button{border:1px solid var(--line);background:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font:inherit;font-size:13px}
.tabs button.on{border-color:var(--accent);color:var(--accent)}
.pane{display:none}.pane.on{display:block}.scroll{overflow-x:auto}.scroll img,.scroll svg{max-width:none;display:block}
pre{margin:0;background:#0f172a;color:#e2e8f0;padding:14px;border-radius:8px;overflow-x:auto;font-size:13px}
.hint{color:var(--muted);font-size:13px;margin:8px 0 0}
nav{padding:0 32px 8px;font-size:14px}nav a{margin-right:14px}
</style></head><body>
<header><h1>Orrery examples</h1><p>Milestone 0: JSON in, animated SVG out. Rebuilt with <code>node site/build.mjs</code>.</p></header>
<nav>${sources.map((f) => { const n = basename(f).replace(/\.orrery\.json$|\.json$/, ""); return `<a href="#${n}">${n}</a>`; }).join("")}</nav>
<main>${cards.join("\n")}</main>
<script>
document.querySelectorAll(".card").forEach(card => card.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => {
  card.querySelectorAll(".tabs button").forEach(x => x.classList.toggle("on", x === b));
  card.querySelectorAll(".pane").forEach(p => p.classList.toggle("on", p.dataset.pane === b.dataset.tab));
})));
</script></body></html>`;
writeFileSync(join(out, "index.html"), html);
console.log(`built ${sources.length} examples into site/dist`);
