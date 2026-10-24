import type { PointCloud, PointLayer } from '../cloud/point-cloud.types.ts'
import type { NodeWriter } from './animation/node-writer.ts'

const PULSE_DURATION_MS = 1400
const PULSE_PERIOD_MS = 700
const HIGHLIGHT: [number, number, number] = [1, 0.84, 0.32]

/**
 * Flashes a picked layer toward gold for a moment, then restores its sampled
 * colours exactly. Each frame writes only that layer's colour range, in one
 * bulk write.
 */
export class PickPulse {
  private layer: PointLayer | null = null
  private startedAt = 0
  private scratch = new Float32Array(0)

  start(layer: PointLayer, now: number): void {
    this.layer = layer
    this.startedAt = now
    this.scratch = new Float32Array((layer.end - layer.start) * 3)
  }

  /** Stops without restoring (the scene is being replaced). */
  cancel(): void {
    this.layer = null
  }

  update(writer: NodeWriter, cloud: PointCloud, now: number): void {
    const layer = this.layer
    if (!layer) return
    const base = cloud.colors.subarray(layer.start * 3, layer.end * 3)
    const elapsed = now - this.startedAt
    if (elapsed >= PULSE_DURATION_MS) {
      writer.writeNodeViews(layer.start, { colors: base })
      this.layer = null
      return
    }
    const strength = 0.5 - 0.5 * Math.cos((elapsed / PULSE_PERIOD_MS) * 2 * Math.PI)
    for (let i = 0; i < base.length; i++) {
      this.scratch[i] = base[i]! + (HIGHLIGHT[i % 3]! - base[i]!) * strength
    }
    writer.writeNodeViews(layer.start, { colors: this.scratch })
  }
}
