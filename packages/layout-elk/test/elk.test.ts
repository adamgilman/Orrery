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
