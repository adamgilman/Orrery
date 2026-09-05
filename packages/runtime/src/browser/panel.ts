import type { Model } from "@orrery/core/types";

export const PANEL_W = 280;
const XHTML = "http://www.w3.org/1999/xhtml";

const PANEL_CSS = `
.orrery-panel{box-sizing:border-box;width:${PANEL_W}px;height:100%;overflow:auto;padding:14px 14px 20px;background:rgba(248,250,252,.96);border-right:1px solid #e2e8f0;font:13px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a}
.orrery-panel h1{font-size:15px;margin:0 0 10px}
.orrery-panel label{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin:12px 0 4px}
.orrery-panel select,.orrery-panel button{font:inherit;padding:4px 8px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:inherit}
.orrery-panel select{width:100%}
.orrery-panel button{cursor:pointer}.orrery-panel button:hover{background:#f1f5f9}.orrery-panel button:disabled{opacity:.4;cursor:default}
.orrery-steps{display:flex;gap:6px;align-items:center;margin-top:6px}
.orrery-step{color:#64748b;min-width:44px;text-align:center}
.orrery-note{margin:6px 0 0;color:#334155;min-height:1.4em}
.orrery-states{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.orrery-states button{font-size:11px;padding:2px 7px}.orrery-states button.is-on{border-color:#2563eb;color:#2563eb}
.orrery-outline{list-style:none;margin:0;padding:0}
.orrery-outline li{padding:3px 6px;border-radius:5px;cursor:pointer;display:flex;align-items:center;gap:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.orrery-outline li:hover{background:#e2e8f0}.orrery-outline li.is-active{background:#dbeafe}
.orrery-outline li[data-type=group]{color:#475569;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.orrery-dot{width:8px;height:8px;border-radius:50%;background:#16a34a;flex:none}
.orrery-help{margin-top:14px;color:#64748b;font-size:11px;line-height:1.6}
.orrery-help kbd{border:1px solid #cbd5e1;border-radius:4px;padding:0 4px;background:#fff;font:inherit}
.orrery-reset{margin-top:12px}`;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElementNS(XHTML, tag) as HTMLElementTagNameMap[K];
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export interface Panel {
  host: SVGForeignObjectElement;
  views: HTMLSelectElement;
  scenarios: HTMLSelectElement;
  prev: HTMLButtonElement;
  next: HTMLButtonElement;
  step: HTMLSpanElement;
  note: HTMLParagraphElement;
  stateBar: HTMLDivElement;
  outline: HTMLUListElement;
  reset: HTMLButtonElement;
}

/** Build the side panel's DOM. No behaviour; the caller wires events. */
export function buildPanel(model: Model, views: { id: string; title: string }[]): Panel {
  const host = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
  host.setAttribute("x", "0"); host.setAttribute("y", "0"); host.setAttribute("width", String(PANEL_W)); host.setAttribute("height", "100%");
  const panel = h("div", "orrery-panel");
  const style = h("style"); style.textContent = PANEL_CSS; panel.appendChild(style);
  panel.appendChild(h("h1", "orrery-title", model.title ?? "Model"));

  panel.appendChild(h("label", undefined, "View"));
  const viewSel = h("select", "orrery-views");
  for (const v of views) { const o = h("option", undefined, v.title); o.value = v.id; viewSel.appendChild(o); }
  panel.appendChild(viewSel);

  panel.appendChild(h("label", undefined, "Scenario"));
  const scSel = h("select", "orrery-scenarios");
  const none = h("option", undefined, "None"); none.value = ""; scSel.appendChild(none);
  for (const s of model.scenarios) { const o = h("option", undefined, s.label); o.value = s.id; scSel.appendChild(o); }
  panel.appendChild(scSel);
  const steps = h("div", "orrery-steps");
  const prev = h("button", "orrery-prev", "◀"), next = h("button", "orrery-next", "▶"), step = h("span", "orrery-step", "");
  steps.append(prev, step, next); panel.appendChild(steps);
  const note = h("p", "orrery-note", ""); panel.appendChild(note);

  panel.appendChild(h("label", undefined, "Selected"));
  const stateBar = h("div", "orrery-states");
  for (const name of Object.keys(model.states.define)) { const b = h("button", "orrery-state", name); b.setAttribute("data-state", name); stateBar.appendChild(b); }
  panel.appendChild(stateBar);

  panel.appendChild(h("label", undefined, "Outline"));
  const outline = h("ul", "orrery-outline"); panel.appendChild(outline);

  const help = h("div", "orrery-help");
  const unmet = model.states.needs.unmet;
  help.innerHTML = `Click a component or group to set it to <b>${unmet}</b> (click again to undo), <kbd>shift</kbd>+click to cycle states, or pick a state above. <kbd>↑</kbd><kbd>↓</kbd> select, <kbd>⏎</kbd> zoom, <kbd>f</kbd> set to ${unmet}, <kbd>[</kbd> <kbd>]</kbd> scenario steps, <kbd>1</kbd>–<kbd>9</kbd> views, <kbd>esc</kbd> reset view.`;
  panel.appendChild(help);
  const reset = h("button", "orrery-reset", "Reset"); panel.appendChild(reset);
  host.appendChild(panel);
  return { host, views: viewSel, scenarios: scSel, prev, next, step, note, stateBar, outline, reset };
}
