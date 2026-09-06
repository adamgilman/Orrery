// Prints markdown image lines for SVG files on the current branch, for a pull request body (the orrery-pr skill).
// Usage: node tools/pr-images.mjs examples/checkout/8-sequence.svg [more.svg ...] [--branch <name>]
import { execFileSync } from "node:child_process";
const args = process.argv.slice(2);
const at = args.indexOf("--branch");
const branch = at >= 0 ? args[at + 1] : execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
const files = args.filter((a, i) => !a.startsWith("--") && (at < 0 || i !== at + 1));
if (!files.length) { console.error("usage: node tools/pr-images.mjs <file.svg> [...] [--branch <name>]"); process.exit(2); }
const remote = execFileSync("git", ["remote", "get-url", "origin"], { encoding: "utf8" }).trim().replace(/^git@github\.com:/, "https://github.com/").replace(/\.git$/, "");
const repo = remote.replace("https://github.com/", "");
for (const f of files) console.log(`![${f.split("/").pop().replace(/\.svg$/, "")}](https://raw.githubusercontent.com/${repo}/${branch}/${f})`);
