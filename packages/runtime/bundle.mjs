// Bundle the browser runtime into one minified IIFE the renderer embeds verbatim. It defines window.Orrery ({ mount }). It defines window.Orrery ({ mount }).
import { build } from "esbuild";
import { mkdirSync } from "node:fs";
mkdirSync("dist", { recursive: true });
await build({
  entryPoints: ["src/browser/index.ts"],
  bundle: true, minify: true, format: "iife", globalName: "Orrery", target: ["es2020"], charset: "utf8",
  outfile: "dist/runtime.min.js", legalComments: "none", logLevel: "warning",
});
