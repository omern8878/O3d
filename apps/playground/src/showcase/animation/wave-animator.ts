import type { PointCloud } from '../../cloud/point-cloud.types.ts'
import type { NodeWriter } from './node-writer.ts'

/** World units of vertical travel (canonical space spans [-10, 10]). */
export const WAVE_AMPLITUDE = 0.6
const WAVE_NUMBER = 0.45
const WAVE_SPEED = 2.2

/** The vertical displacement of the wave at `(x, z)` and `timeSeconds`. */
export function waveOffset(x: number, z: number, timeSeconds: number): number {
  return WAVE_AMPLITUDE * Math.sin(WAVE_NUMBER * (x + 0.6 * z) - WAVE_SPEED * timeSeconds)
}

/**
 * A travelling wave through every particle: the stress case where the whole
 * position buffer changes and is uploaded each frame, in one write.
 */
export class WaveAnimator {
  private readonly base: Float32Array
  private readonly scratch: Float32Array

  constructor(cloud: PointCloud) {
    this.base = cloud.positions.slice(0, cloud.count * 3)
    this.scratch = new Float32Array(this.base.length)
  }

  update(writer: NodeWriter, timeSeconds: number): void {
    const { base, scratch } = this
    for (let i = 0; i < base.length; i += 3) {
      scratch[i] = base[i]!
      scratch[i + 1] = base[i + 1]! + waveOffset(base[i]!, base[i + 2]!, timeSeconds)
      scratch[i + 2] = base[i + 2]!
    }
    writer.writeNodeViews(0, { positions: scratch })
  }

  reset(writer: NodeWriter): void {
    writer.writeNodeViews(0, { positions: this.base })
  }
}
