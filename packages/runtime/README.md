# @orrery-diagrams/runtime

The engine inlined into every interactive Orrery SVG: camera, states, scenarios, drill-down, sequence stepping and
tours. Opened directly, a rendered SVG is interactive with no page around it: click a component to step it through
its states, click a closed group to open it, Enter or a double-click zooms, Escape steps back out, arrows select,
`s` cycles scenarios, brackets step, digits switch views. For a page of your own, the same engine mounts on the SVG
and reports what it does.

```sh
npm install @orrery-diagrams/runtime
```

```ts
import { RUNTIME_SOURCE } from "@orrery-diagrams/runtime";
import { renderDocument } from "@orrery-diagrams/core";

const svg = await renderDocument(model, engine, { runtime: RUNTIME_SOURCE }); // the engine travels inside the file
```

In a page, `orrery embed` writes the diagram, `orrery.js` (the engine, defining `window.Orrery`) and a sample page.
The engine has no user interface of its own; the page builds its controls from the interface:

```js
const orrery = Orrery.mount(svgElement, { size: { width: 1200, height: 700 } });
orrery.views; orrery.scenarios; orrery.states; orrery.groups();
orrery.showView("data"); orrery.open(["sessions"]); orrery.zoom("db"); orrery.back();
orrery.setScenario("db-fails", 1); orrery.next(); orrery.prev(); orrery.setState("api", "degraded");
orrery.play(); orrery.stop(); orrery.reset();
orrery.on("change", (snapshot) => { /* view, open groups, zoom, scenario step and note, every state and reason, selection, sequence message */ });
orrery.destroy();
```

`RUNTIME_SOURCE` is the bundled engine as a string, for embedding; the browser entry is the module itself. Every
method is described in the source, `src/browser/index.ts`, and exercised by the test suite in a DOM.

MIT.
