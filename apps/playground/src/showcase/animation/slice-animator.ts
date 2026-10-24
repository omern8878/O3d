import type { PointCloud, PointLayer } from '../../cloud/point-cloud.types.ts'
import { layerCentroid } from '../../import/layer-centroid.ts'
import type { SliceAnimationSpec } from '../../import/scene-source.types.ts'
import type { NodeWriter } from './node-writer.ts'

const SWAY_AMPLITUDE_RAD = 0.22
const SWAY_SPEED = 2.4
const SWAY_LAG = 2.2
const RISE_SPEED = 0.35
const RISE_WOBBLE = 0.05
/** Plume width at its base, relative to its width gained over the full height. */
const RISE_BASE_WIDTH = 0.35
const SPIN_SPEED = 0.6
const PULSE_AMPLITUDE = 0.12
const PULSE_SPEED = 3

/**
 * Animates one contiguous layer (the "sub-slice") and nothing else, so each
 * frame uploads exactly that layer's position range: a tail swaying around
 * its hip, steam rising, a core spinning or a segment pulsing.
 */
export class SliceAnimator {
  readonly layer: PointLayer
  private readonly kind: SliceAnimationSpec['kind']
  private readonly base: Float32Array
  private readonly scratch: Float32Array
  private readonly pivot: [number, number, number]
  /** `sway`: per-point distance from the pivot, normalized to `0..1`. */
  private readonly reach: Float32Array
  /** `rise`: the layer's vertical extent. */
  private readonly floor: number
  private readonly height: number

  constructor(cloud: PointCloud, layer: PointLayer, spec: SliceAnimationSpec) {
    this.layer = layer
    this.kind = spec.kind
    this.base = cloud.positions.slice(layer.start * 3, layer.end * 3)
    this.scratch = new Float32Array(this.base.length)
    const centroid = layerCentroid(cloud, layer)
    this.pivot = spec.pivot ? [spec.pivot[0], spec.pivot[1], centroid[2]] : centroid

    this.reach = new Float32Array(this.base.length / 3)
    let maxReach = 1e-6
    let floor = Infinity, ceiling = -Infinity
    for (let i = 0; i < this.reach.length; i++) {
      const dx = this.base[i * 3]! - this.pivot[0], dy = this.base[i * 3 + 1]! - this.pivot[1]
      this.reach[i] = Math.hypot(dx, dy)
      maxReach = Math.max(maxReach, this.reach[i]!)
      floor = Math.min(floor, this.base[i * 3 + 1]!)
      ceiling = Math.max(ceiling, this.base[i * 3 + 1]!)
    }
    for (let i = 0; i < this.reach.length; i++) this.reach[i]! /= maxReach
    this.floor = floor
    this.height = Math.max(ceiling - floor, 1e-6)
  }

  /** Writes the layer's pose at `timeSeconds`. */
  update(writer: NodeWriter, timeSeconds: number): void {
    const { base, scratch, pivot } = this
    for (let i = 0; i < base.length; i += 3) {
      const x = base[i]!, y = base[i + 1]!, z = base[i + 2]!
      switch (this.kind) {
        case 'sway': {
          const reach = this.reach[i / 3]!
          const angle = SWAY_AMPLITUDE_RAD * reach * Math.sin(timeSeconds * SWAY_SPEED - reach * SWAY_LAG)
          const cos = Math.cos(angle), sin = Math.sin(angle)
          const dx = x - pivot[0], dy = y - pivot[1]
          scratch[i] = pivot[0] + dx * cos - dy * sin
          scratch[i + 1] = pivot[1] + dx * sin + dy * cos
          scratch[i + 2] = z
          break
        }
        case 'rise': {
          // Each particle loops from the bottom to the top of the layer, its
          // offset from the plume's axis widening with height like a plume.
          const startFraction = (y - this.floor) / this.height
          const fraction = (startFraction + timeSeconds * RISE_SPEED) % 1
          const widen = (RISE_BASE_WIDTH + fraction) / (RISE_BASE_WIDTH + startFraction)
          const wobble = Math.sin(timeSeconds * 1.7 + fraction * 9) * RISE_WOBBLE * this.height * fraction
          scratch[i] = pivot[0] + (x - pivot[0]) * widen + wobble
          scratch[i + 1] = this.floor + fraction * this.height
          scratch[i + 2] = pivot[2] + (z - pivot[2]) * widen + wobble * 0.5
          break
        }
        case 'spin': {
          const angle = timeSeconds * SPIN_SPEED
          const cos = Math.cos(angle), sin = Math.sin(angle)
          const dx = x - pivot[0], dz = z - pivot[2]
          scratch[i] = pivot[0] + dx * cos - dz * sin
          scratch[i + 1] = y
          scratch[i + 2] = pivot[2] + dx * sin + dz * cos
          break
        }
        case 'pulse': {
          const factor = 1 + PULSE_AMPLITUDE * Math.sin(timeSeconds * PULSE_SPEED)
          scratch[i] = pivot[0] + (x - pivot[0]) * factor
          scratch[i + 1] = pivot[1] + (y - pivot[1]) * factor
          scratch[i + 2] = pivot[2] + (z - pivot[2]) * factor
          break
        }
      }
    }
    writer.writeNodeViews(this.layer.start, { positions: scratch })
  }

  /** Puts the layer back at rest. */
  reset(writer: NodeWriter): void {
    writer.writeNodeViews(this.layer.start, { positions: this.base })
  }
}
