/** Converts a wheel `deltaY` into a multiplicative zoom factor (`< 1` = in). */

/** Pixels assumed per `deltaMode === 1` (line) tick. */
const PIXELS_PER_LINE = 16
/** Soft cap so trackpad inertia / mouse notches cannot jump the view. */
const MAX_ABS_DELTA_PX = 80
/** Zoom strength per pixel of normalized wheel delta. */
const ZOOM_PER_PIXEL = 0.0015

/**
 * Normalizes `WheelEvent` deltas across mouse and trackpad (`deltaMode` 0/1/2)
 * and clamps spikes, then maps them to a smooth zoom factor.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  if (!Number.isFinite(deltaY)) return 1
  let pixels = deltaY
  if (deltaMode === 1) pixels *= PIXELS_PER_LINE
  else if (deltaMode === 2) pixels *= MAX_ABS_DELTA_PX * 10
  pixels = Math.max(-MAX_ABS_DELTA_PX, Math.min(MAX_ABS_DELTA_PX, pixels))
  return Math.exp(pixels * ZOOM_PER_PIXEL)
}

/**
 * Pointer position → NDC (`[-1, 1]`, `+Y` up) relative to a canvas rect.
 */
export function clientToNdc(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
): { ndcX: number; ndcY: number } {
  const width = Math.max(rect.width, 1)
  const height = Math.max(rect.height, 1)
  // Avoid signed zero from the Y flip so callers can assert with `=== 0`.
  const ndcX = ((clientX - rect.left) / width) * 2 - 1
  const ndcY = -(((clientY - rect.top) / height) * 2 - 1) || 0
  return { ndcX: ndcX || 0, ndcY }
}

