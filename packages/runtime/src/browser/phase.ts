/** Fraction of the way through a cycle, 0..1, from an animation's current time. 0 when unknown. */
export function phaseOf(currentTimeMs: number | null, durationMs: number): number {
  if (currentTimeMs === null || !(durationMs > 0)) return 0;
  return (((currentTimeMs % durationMs) + durationMs) % durationMs) / durationMs;
}
