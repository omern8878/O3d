import type { SceneTemplate } from '@engine/templates'
import type { PointLayer, SvgPointCloud } from '../vector/point-cloud.types.ts'

/** Peak bend at the tip, in radians. */
const SWAY_AMPLITUDE_RAD = 0.22
const SWAY_SPEED = 2.4
/** Phase lag from base to tip, so the bend travels along the tail like a wave. */
const WAVE_LAG = 2.2

/**
 * Swings one contiguous layer (the cat's tail) around a pivot with a
 * travelling wave. Only that layer's nodes are written, so the GPU upload
 * each frame is exactly its position slice and nothing else.
 */
export class TailAnimator {
  readonly layer: PointLayer
  private readonly offsets: Float32Array
  private readonly pivotX: number
  private readonly pivotY: number
  private readonly maxReach: number
  private readonly baseZ: Float32Array
  private readonly position: [number, number, number] = [0, 0, 0]

  constructor(cloud: SvgPointCloud, layer: PointLayer, pivot: [number, number]) {
    this.layer = layer
    ;[this.pivotX, this.pivotY] = pivot
    const length = layer.end - layer.start
    this.offsets = new Float32Array(length * 2)
    this.baseZ = new Float32Array(length)
    let maxReach = 1e-6
    for (let i = 0; i < length; i++) {
      const o = (layer.start + i) * 3
      const dx = cloud.positions[o]! - this.pivotX
      const dy = cloud.positions[o + 1]! - this.pivotY
      this.offsets[i * 2] = dx
      this.offsets[i * 2 + 1] = dy
      this.baseZ[i] = cloud.positions[o + 2]!
      maxReach = Math.max(maxReach, Math.hypot(dx, dy))
    }
    this.maxReach = maxReach
  }

  /** Writes the tail pose for `timeSeconds` into the scene. */
  update(scene: SceneTemplate, ids: Uint32Array, timeSeconds: number): void {
    const position = this.position
    const length = this.layer.end - this.layer.start
    for (let i = 0; i < length; i++) {
      const dx = this.offsets[i * 2]!
      const dy = this.offsets[i * 2 + 1]!
      const reach = Math.hypot(dx, dy) / this.maxReach
      const angle =
        SWAY_AMPLITUDE_RAD * reach * Math.sin(timeSeconds * SWAY_SPEED - reach * WAVE_LAG)
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      position[0] = this.pivotX + dx * cos - dy * sin
      position[1] = this.pivotY + dx * sin + dy * cos
      position[2] = this.baseZ[i]!
      scene.updateNodePosition(ids[this.layer.start + i]!, position)
    }
  }
}
