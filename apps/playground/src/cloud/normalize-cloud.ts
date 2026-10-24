import type { PointCloud } from '../cloud/point-cloud.types.ts'

/** Canonical world space: every source is fitted into `[-10, 10]` on its longest axis. */
export const CANONICAL_HALF_EXTENT = 10

/** How a cloud was moved and scaled into canonical space. */
export type CanonicalTransform = {
  /** Subtracted from positions before scaling (the source's AABB centre). */
  center: [number, number, number]
  scale: number
  /** Maps a source-space point into canonical space. */
  apply(x: number, y: number, z: number): [number, number, number]
}

/**
 * Centres a cloud's axis-aligned bounding box on the origin and scales it
 * uniformly so its longest half-extent is {@link CANONICAL_HALF_EXTENT},
 * scaling particle sizes by the same factor, in place. Any 2D or 3D source
 * then fits the same camera framing.
 */
export function normalizeCloud(cloud: PointCloud): CanonicalTransform {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const { positions, scales } = cloud
  for (let i = 0; i < cloud.count * 3; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis]!
      if (Number.isFinite(value)) {
        if (value < min[axis]!) min[axis] = value
        if (value > max[axis]!) max[axis] = value
      }
    }
  }
  const center: [number, number, number] = [0, 1, 2].map((axis) =>
    Number.isFinite(min[axis]!) ? (min[axis]! + max[axis]!) / 2 : 0) as [number, number, number]
  const halfExtent = Math.max(...[0, 1, 2].map((axis) =>
    Number.isFinite(min[axis]!) ? (max[axis]! - min[axis]!) / 2 : 0))
  const scale = halfExtent > 0 ? CANONICAL_HALF_EXTENT / halfExtent : 1

  for (let i = 0; i < cloud.count * 3; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      positions[i + axis] = (positions[i + axis]! - center[axis]!) * scale
      scales[i + axis] = scales[i + axis]! * scale
    }
  }
  return {
    center,
    scale,
    apply: (x, y, z) => [(x - center[0]) * scale, (y - center[1]) * scale, (z - center[2]) * scale],
  }
}
