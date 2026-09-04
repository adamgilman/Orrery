// Dev helper: rasterise an SVG so humans (and agents) can look at it. Usage: node test/preview.mjs in.svg out.png
import { readFileSync, writeFileSync } from "node:fs";
import { Resvg } from "@resvg/resvg-js";
const [, , inFile, outFile] = process.argv;
const png = new Resvg(readFileSync(inFile, "utf8"), { fitTo: { mode: "zoom", value: 2 }, background: "#ffffff" }).render().asPng();
writeFileSync(outFile, png);
