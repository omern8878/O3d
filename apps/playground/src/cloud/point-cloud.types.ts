import type { Rgb } from '../vector/svg-color.ts'

/** A contiguous run of points that came from one named source layer (SVG layer, OBJ group). */
export type PointLayer = {
  name: string
  /** First point index (inclusive). */
  start: number
  /** One past the last point index. */
  end: number
  /** The layer's base colour. */
  color: Rgb
}

/** Particles ready for a `SceneTemplate`, from any source. */
export type PointCloud = {
  count: number
  /** `x, y, z` per point, in world units (`+Y` up, `+Z` towards the viewer). */
  positions: Float32Array
  /** `sx, sy, sz` per point. */
  scales: Float32Array
  /** `r, g, b` per point, each in `0..1`. */
  colors: Float32Array
  /** Layers in draw order; each one's points are contiguous. */
  layers: PointLayer[]
}

/** SVG content sampled into particles, plus the SVG-to-world mapping. */
export type SvgPointCloud = PointCloud & {
  /** Maps an SVG root-space point to world `x, y`. */
  toWorld(x: number, y: number): [number, number]
}

/** A requested particle count, or `'auto'` to let the source decide. */
export type ParticleRequest = number | 'auto'
