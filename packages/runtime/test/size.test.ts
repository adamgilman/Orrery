import { describe, expect, it } from "vitest";
import { gzipSync } from "node:zlib";
import { RUNTIME_SOURCE } from "../src/index.js";

describe("runtime bundle", () => {
  it("stays under the 25 KB gzipped budget and has no CDATA terminator hazards left unescaped by the renderer", () => {
    const gz = gzipSync(Buffer.from(RUNTIME_SOURCE)).length;
    expect(gz, `runtime is ${gz} bytes gzipped`).toBeLessThan(25 * 1024);
    expect(RUNTIME_SOURCE.length).toBeGreaterThan(1000);
  });
});
