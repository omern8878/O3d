/**
 * Particle sizing that keeps scenes from 5,000 to 1,000,000+ points dense
 * but not smeared: the spacing between N evenly spread points shrinks with
 * 1 / sqrt(N), so their size follows it.
 */

/** Size relative to the spacing of points spread over a surface. */
const SURFACE_OVERLAP = 1.35
/**
 * Size relative to the projected spacing of points spread through a volume.
 * Above 1 because volumes are viewed through: particles overlap in depth,
 * and smaller ones fall below a pixel and fade out at 100k+.
 */
const VOLUME_OVERLAP = 1.8

/** For N points covering a surface of `area`: `1.35 * sqrt(area / N)`. */
export function surfaceParticleSize(area: number, count: number): number {
  return SURFACE_OVERLAP * Math.sqrt(Math.max(area, 0) / Math.max(count, 1))
}

/**
 * For N points filling a volume of half-extent `extent` (seen projected onto
 * the screen): `1.8 * 2 * extent / sqrt(N)`.
 */
export function volumeParticleSize(extent: number, count: number): number {
  return (VOLUME_OVERLAP * 2 * extent) / Math.sqrt(Math.max(count, 1))
}
