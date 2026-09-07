# @orrery-diagrams/layout-elk

Orrery's layout engine, backed by the Eclipse Layout Kernel (elkjs). It implements the `LayoutEngine` contract
from `@orrery-diagrams/core`: a graph of measured boxes and nested groups in, positions, group frames and edge
routes out. Layout runs when a picture is rendered, never when it is viewed; the SVG carries the coordinates.

```sh
npm install @orrery-diagrams/core @orrery-diagrams/layout-elk
```

```ts
import { render } from "@orrery-diagrams/core";
import { ElkLayoutEngine } from "@orrery-diagrams/layout-elk";

const svg = await render(model, new ElkLayoutEngine());
```

`ElkLayoutEngine` is the only export. It is the only place in Orrery that imports elkjs, and a test keeps it so; a
different engine is a class with the same `layout(graph)` method, handed to `render` in its place. The layered
algorithm is used with the model's `direction`; groups are compound nodes with the padding core declares; empty
groups keep a minimum size. elkjs stays at 0.9: 0.12 crashes on compound graphs when model order is enforced.

MIT.
