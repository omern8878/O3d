import type { PointCloud } from '../../cloud/point-cloud.types.ts'
import type { NodeWriter } from './node-writer.ts'

export const MORPH_DURATION_MS = 600

/** A copy of the particles currently on screen, to morph away from. */
export type ParticleSnapshot = Pick<PointCloud, 'count' | 'positions' | 'scales' | 'colors'>

/** Smooth start and stop: cubic ease-in-out on `0..1`. */
export function easeInOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t))
  return clamped < 0.5 ? 4 * clamped ** 3 : 1 - (-2 * clamped + 2) ** 3 / 2
}

/** Which source particle target particle `i` starts from: proportional, so layers flow into layers. */
export function sourceIndex(i: number, targetCount: number, sourceCount: number): number {
  return Math.min(sourceCount - 1, Math.floor((i * sourceCount) / targetCount))
}

/**
 * Morphs the scene from the previous particles to a new cloud: every target
 * particle starts at a proportionally chosen old particle and its position,
 * colour and size are eased to their targets over ~600 ms, one bulk write
 * per attribute per frame.
 */
export class MorphTransition {
  private readonly from: ParticleSnapshot
  private readonly to: PointCloud
  private readonly durationMs: number
  private readonly start: { positions: Float32Array; scales: Float32Array; colors: Float32Array }
  private readonly frame: { positions: Float32Array; scales: Float32Array; colors: Float32Array }
  private startedAt = 0

  constructor(from: ParticleSnapshot, to: PointCloud, durationMs = MORPH_DURATION_MS) {
    this.from = from
    this.to = to
    this.durationMs = durationMs
    const gather = (source: Float32Array) => {
      const out = new Float32Array(to.count * 3)
      for (let i = 0; i < to.count; i++) {
        const j = sourceIndex(i, to.count, from.count) * 3
        out[i * 3] = source[j]!
        out[i * 3 + 1] = source[j + 1]!
        out[i * 3 + 2] = source[j + 2]!
      }
      return out
    }
    this.start = { positions: gather(from.positions), scales: gather(from.scales), colors: gather(from.colors) }
    this.frame = {
      positions: new Float32Array(to.count * 3),
      scales: new Float32Array(to.count * 3),
      colors: new Float32Array(to.count * 3),
    }
  }

  /** Shows the starting state (the old shape) and starts the clock. */
  begin(writer: NodeWriter, now: number): void {
    this.startedAt = now
    writer.writeNodeViews(0, this.start)
  }

  /** Writes the frame at `now`; returns `true` once the target is reached exactly. */
  step(writer: NodeWriter, now: number): boolean {
    const t = easeInOutCubic((now - this.startedAt) / this.durationMs)
    if (t >= 1) {
      writer.writeNodeViews(0, { positions: this.to.positions, scales: this.to.scales, colors: this.to.colors })
      return true
    }
    for (const key of ['positions', 'scales', 'colors'] as const) {
      const a = this.start[key], b = this.to[key], out = this.frame[key]
      for (let i = 0; i < out.length; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t
    }
    writer.writeNodeViews(0, this.frame)
    return false
  }

  get sourceCount(): number {
    return this.from.count
  }
}
