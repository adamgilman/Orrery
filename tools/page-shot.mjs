// Screenshot a local HTML page in headless Chromium. Usage: node tools/page-shot.mjs <file.html> <out.png> <width> [height] [scrollY]
// With a height the shot is the viewport at scrollY; without, the full page.
import { chromium } from "playwright";
const [,, file, out, width, height, scrollY] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height ?? 900) }, deviceScaleFactor: 1 });
await page.goto("file://" + file); await page.waitForTimeout(1200);
if (scrollY) { await page.evaluate((y) => window.scrollTo(0, y), Number(scrollY)); await page.waitForTimeout(300); }
await page.screenshot({ path: out, fullPage: !height });
await browser.close();
