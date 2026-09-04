// Zero-dependency static server for site/dist. Usage: node site/serve.mjs [port]
import { createServer } from "node:http";
import { createReadStream, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";

const root = new URL("./dist", import.meta.url).pathname;
const port = Number(process.argv[2] ?? 8080);
const types = { ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".css": "text/css", ".js": "text/javascript", ".png": "image/png" };

createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path === "/" ? "index.html" : path);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try {
    if (!statSync(file).isFile()) throw new Error();
  } catch { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
  createReadStream(file).pipe(res);
}).listen(port, "0.0.0.0", () => console.log(`serving ${root} on http://0.0.0.0:${port}`));
