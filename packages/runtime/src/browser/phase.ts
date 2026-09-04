/**
 * When an animation's duration changes, restart it at the same phase so dashes never jump.
 * Returns the (negative) animation-delay to apply with the new duration.
 */
export function continuedDelay(currentTimeMs: number | null, oldDurationMs: number, newDurationMs: number): number {
  if (currentTimeMs === null || !(oldDurationMs > 0) || !(newDurationMs > 0)) return 0;
  const phase = ((currentTimeMs % oldDurationMs) + oldDurationMs) % oldDurationMs / oldDurationMs;
  return -phase * newDurationMs;
}
