// A sample page for an Orrery embed: fetch the diagram, mount the engine, build controls from what it reports, and
// keep them in step with the engine's change events. Written to be thrown away and rewired your own way.
(async () => {
  const container = document.getElementById("diagram");
  // The HTML parser handles the file's CDATA sections and does not run its script; the engine comes from orrery.js.
  container.innerHTML = await (await fetch("{{name}}.svg")).text();
  const orrery = Orrery.mount(container.querySelector("svg"));

  const $ = (id) => document.getElementById(id);
  const el = (tag, text, attrs = {}) => { const e = document.createElement(tag); e.textContent = text; Object.assign(e, attrs); return e; };

  // Controls built once from what the model offers.
  for (const v of orrery.views) $("view").appendChild(el("option", v.title, { value: v.id }));
  for (const s of orrery.scenarios) $("scenario").appendChild(el("option", s.label, { value: s.id }));
  for (const s of orrery.states) {
    const b = el("button", s.name, { title: s.description ?? "" });
    b.dataset.state = s.name;
    b.addEventListener("click", () => { const id = orrery.snapshot().selected; if (id) orrery.setState(id, s.name); });
    $("states").appendChild(b);
  }
  $("view").addEventListener("change", () => orrery.showView($("view").value));
  $("scenario").addEventListener("change", () => orrery.setScenario($("scenario").value || null, 1));
  $("prev").addEventListener("click", () => orrery.prev());
  $("next").addEventListener("click", () => orrery.next());
  $("back").addEventListener("click", () => orrery.back());
  $("fit").addEventListener("click", () => orrery.zoom(null));
  $("play").addEventListener("click", () => orrery.play());
  $("stop").addEventListener("click", () => orrery.stop());
  $("reset").addEventListener("click", () => orrery.reset());

  // Controls kept in step with the engine: every change hands us a snapshot.
  const render = (s) => {
    $("view").value = s.view;
    $("scenario").value = s.scenario ? s.scenario.id : "";
    $("step").textContent = s.scenario ? `${s.scenario.step} / ${s.scenario.steps}` : "";
    $("prev").disabled = !s.scenario || s.scenario.step <= 1;
    $("next").disabled = !s.scenario || s.scenario.step >= s.scenario.steps;
    $("note").textContent = (s.scenario && s.scenario.note) || "";
    const sel = s.selected ? s.states[s.selected] : null;
    $("selected").textContent = s.selected ? `${s.selected}: ${sel.state}${sel.reason ? ` (${sel.reason})` : ""}` : "Click a component in the diagram.";
    for (const b of $("states").querySelectorAll("button")) b.classList.toggle("is-on", !!sel && b.dataset.state === sel.state);
    // Opening and zooming are separate: a toggle per closable group, and a zoom per drawn group.
    $("groups").replaceChildren(...orrery.groups().flatMap((g) => {
      const row = el("div", "");
      if (g.closable) {
        const t = el("button", g.open ? `Close ${g.label}` : `Open ${g.label}`);
        t.addEventListener("click", () => orrery.open(g.open ? s.open.filter((id) => id !== g.id) : [...s.open, g.id]));
        row.appendChild(t);
      }
      const z = el("button", `Zoom ${g.label}`); z.classList.toggle("is-on", s.zoom === g.id);
      z.addEventListener("click", () => orrery.zoom(g.id));
      row.appendChild(z);
      return [row];
    }));
    $("fit").disabled = !s.zoom;
    $("back").disabled = !s.zoom && !s.open.length;
    $("play").disabled = s.playing; $("stop").disabled = !s.playing;
  };
  orrery.on("change", render);
  render(orrery.snapshot());
})();
