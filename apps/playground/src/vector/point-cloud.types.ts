import type { Rgb } from './svg-color.ts'

/** A contiguous run of points that came from one named SVG layer. */
export type PointLayer = {
  name: string
  /** First point index (inclusive). */
  start: number
  /** One past the last point index. */
  end: number
  /** The layer's paint color. */
  color: Rgb
}

/** SVG content sampled into instanced particles, ready for a `SceneTemplate`. */
export type SvgPointCloud = {
  count: number
  /** `x, y, z` per point, in world units (`+Y` up, `+Z` towards the viewer). */
  positions: Float32Array
  /** `sx, sy, sz` per point. */
  scales: Float32Array
  /** `r, g, b` per point, each in `0..1`. */
  colors: Float32Array
  /** Layers in draw order; each one's points are contiguous. */
  layers: PointLayer[]
  /** Maps an SVG root-space point to world `x, y`. */
  toWorld(x: number, y: number): [number, number]
}
