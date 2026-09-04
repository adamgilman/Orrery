import { readFileSync } from "node:fs";
import { join } from "node:path";
/** The bundled browser runtime, embedded verbatim into rendered documents. Built by bundle.mjs into dist/. */
export const RUNTIME_SOURCE: string = readFileSync(join(import.meta.dirname, "../dist/runtime.min.js"), "utf8");
