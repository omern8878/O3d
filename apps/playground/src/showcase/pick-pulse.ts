import type { SceneTemplate } from '@engine/templates'
import type { PointLayer, SvgPointCloud } from '../vector/point-cloud.types.ts'

const PULSE_DURATION_MS = 1400
const PULSE_PERIOD_MS = 700
const HIGHLIGHT: [number, number, number] = [1, 0.84, 0.32]

/**
 * Flashes a picked layer toward gold for a moment, then restores its sampled
 * colors exactly. Only the layer's color slice is written while it runs.
 */
export class PickPulse {
  private layer: PointLayer | null = null
  private startedAt = 0
  private readonly color: [number, number, number] = [0, 0, 0]

  start(layer: PointLayer, now: number): void {
    this.layer = layer
    this.startedAt = now
  }

  /** Clears any running pulse without restoring (the scene is being rebuilt). */
  cancel(): void {
    this.layer = null
  }

  update(scene: SceneTemplate, ids: Uint32Array, cloud: SvgPointCloud, now: number): void {
    const layer = this.layer
    if (!layer) return
    const elapsed = now - this.startedAt
    const finished = elapsed >= PULSE_DURATION_MS
    const strength = finished
      ? 0
      : 0.5 - 0.5 * Math.cos((elapsed / PULSE_PERIOD_MS) * 2 * Math.PI)

    const color = this.color
    for (let i = layer.start; i < layer.end; i++) {
      for (let c = 0; c < 3; c++) {
        const base = cloud.colors[i * 3 + c]!
        color[c] = base + (HIGHLIGHT[c]! - base) * strength
      }
      scene.updateNodeColor(ids[i]!, color)
    }
    if (finished) this.layer = null
  }
}
