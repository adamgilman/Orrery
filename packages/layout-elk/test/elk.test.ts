import { ElkLayoutEngine } from "../src/index.js";
import { layoutContract } from "../../core/test/layoutContract.js";

layoutContract("ElkLayoutEngine", () => new ElkLayoutEngine());

import { describe, expect, it } from "vitest";
describe("ElkLayoutEngine: model order", () => {
  it("keeps siblings in input order within a layer so JSON order predicts canvas order", async () => {
    const r = await new ElkLayoutEngine().layout({
      direction: "down",
      nodes: ["lb", "s1", "s2", "s3"].map((id) => ({ id, width: 120, height: 48 })),
      edges: [
        { id: "e0", from: "lb", to: "s1" }, { id: "e1", from: "lb", to: "s2" }, { id: "e2", from: "lb", to: "s3" },
      ],
    });
    expect(r.nodes.s1!.x).toBeLessThan(r.nodes.s2!.x);
    expect(r.nodes.s2!.x).toBeLessThan(r.nodes.s3!.x);
  });
});

describe("ElkLayoutEngine: compound graphs", () => {
  it("lays out nested groups with edges crossing hierarchy levels (regression: considerModelOrder crashed ELK)", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { validate, toLayoutGraph } = await import("@orrery/core");
    const r = validate(JSON.parse(readFileSync(join(import.meta.dirname, "../../../fixtures/valid/checkout.json"), "utf8")));
    if (!r.ok) throw new Error();
    const out = await new ElkLayoutEngine().layout(toLayoutGraph(r.diagram));
    expect(Object.keys(out.nodes)).toHaveLength(11);
    expect(Object.keys(out.groups)).toHaveLength(5);
    expect(Object.keys(out.edges)).toHaveLength(12);
  });
});
