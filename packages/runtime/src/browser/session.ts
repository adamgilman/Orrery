import { declare, stopFlows } from "@orrery-diagrams/core/declare";
import type { Model } from "@orrery-diagrams/core/types";

/**
 * What the viewer has done to the model: a scenario position plus per-entity states they set. Pure state; the
 * model to draw comes from core's `declare` + `stopFlows`, the same path the CLI uses.
 */
export class Session {
  private readonly overrides = new Map<string, string>();
  scenario: { id: string; step: number } | null = null;
  readonly stateNames: string[];

  constructor(readonly model: Model) {
    this.stateNames = Object.keys(model.states.define);
  }

  /** Declared state of an entity under the current scenario, before overrides. */
  declared(id: string): string {
    const d = declare(this.model, this.scenario ? { scenario: this.scenario.id, step: this.scenario.step } : {}).model;
    return (d.components.find((c) => c.id === id) ?? d.groups.find((g) => g.id === id))!.state;
  }

  /** Declared state including the viewer's override. */
  current(id: string): string {
    return this.overrides.get(id) ?? this.declared(id);
  }

  set(id: string, state: string): void {
    if (state === this.declared(id)) this.overrides.delete(id); else this.overrides.set(id, state);
  }

  /** Base-model state of an entity, before any scenario. */
  base(id: string): string {
    return (this.model.components.find((c) => c.id === id) ?? this.model.groups.find((g) => g.id === id))!.state;
  }

  /** Next (or previous) state in the author's definition order. */
  cycle(id: string, by = 1): void {
    const n = this.stateNames.length;
    const i = this.stateNames.indexOf(this.current(id));
    this.set(id, this.stateNames[(i + by + n) % n]!);
  }

  setScenario(id: string | null, step = 1): void {
    if (!id) { this.scenario = null; return; }
    const sc = this.model.scenarios.find((s) => s.id === id);
    if (!sc) return;
    this.scenario = { id, step: Math.min(Math.max(step, 1), sc.steps.length) };
  }

  stepCount(): number {
    return this.scenario ? this.model.scenarios.find((s) => s.id === this.scenario!.id)!.steps.length : 0;
  }

  note(): string {
    if (!this.scenario) return "";
    return this.model.scenarios.find((s) => s.id === this.scenario!.id)!.steps[this.scenario.step - 1]!.note ?? "";
  }

  reset(): void {
    this.overrides.clear();
    this.scenario = null;
  }

  /** Replace every override at once (a tour scene's `set`). */
  replaceOverrides(set: Record<string, string[]> | undefined): void {
    this.overrides.clear();
    for (const [state, ids] of Object.entries(set ?? {})) for (const id of ids) this.overrides.set(id, state);
  }

  /** The model to draw for the current situation. */
  effective(): Model {
    const set: Record<string, string[]> = Object.create(null);
    for (const [id, s] of this.overrides) set[s] = [...(set[s] ?? []), id];
    const d = declare(this.model, { ...(this.scenario ? { scenario: this.scenario.id, step: this.scenario.step } : {}), set });
    return stopFlows(d.model);
  }
}
