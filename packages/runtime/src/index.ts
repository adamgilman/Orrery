import { readFileSync } from "node:fs";
/** The bundled browser runtime, embedded verbatim into rendered documents. */
export const RUNTIME_SOURCE: string = readFileSync(new URL("./runtime.min.js", import.meta.url), "utf8");
