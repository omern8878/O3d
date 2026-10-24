import type { ParticleRequest, PointCloud } from '../cloud/point-cloud.types.ts'

/**
 * How a source's characteristic layer moves in "sub-slice" mode:
 * `sway` swings it around a pivot (a tail), `rise` loops it upward (steam),
 * `spin` turns it around its own vertical axis, `pulse` breathes it radially.
 */
export type SliceAnimationKind = 'sway' | 'rise' | 'spin' | 'pulse'

export type SliceAnimationSpec = {
  /** Name of the contiguous layer to animate. */
  layer: string
  kind: SliceAnimationKind
  /** World-space `x, y` pivot for `sway`; defaults to the layer's centroid. */
  pivot?: [number, number]
}

/** A source's particles in canonical space, plus how to present them. */
export type BuiltScene = {
  cloud: PointCloud
  slice: SliceAnimationSpec | null
  /** Friendly names for picked layers, by layer name. */
  labels: Readonly<Record<string, string>>
  /** One line on how the particles were produced, for the HUD. */
  detail: string
}

/** Anything the playground can show: a preset or a dropped file. */
export type SceneSource = {
  id: string
  label: string
  /** 3D sources switch the camera to perspective when loaded. */
  dimension: '2d' | '3d'
  builtIn: boolean
  build(request: ParticleRequest): Promise<BuiltScene>
}
