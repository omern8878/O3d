import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { EntityAttributeArrays } from '@engine/templates'
import type { PointCloud } from '../../cloud/point-cloud.types.ts'
import { easeInOutCubic, MorphTransition, sourceIndex } from './morph-transition.ts'
import { SliceAnimator } from './slice-animator.ts'
import { WAVE_AMPLITUDE, WaveAnimator, waveOffset } from './wave-animator.ts'

/** Records every bulk write, like `SceneTemplate.writeNodeViews`. */
function recorder() {
  type Copied = { positions?: Float32Array; scales?: Float32Array; colors?: Float32Array }
  const writes: { start: number; data: Copied }[] = []
  return {
    writes,
    writeNodeViews: (start: number, data: EntityAttributeArrays) => {
      const copy = (v?: ArrayLike<number>) => (v ? Float32Array.from(v) : undefined)
      writes.push({ start, data: { positions: copy(data.positions), scales: copy(data.scales), colors: copy(data.colors) } })
    },
  }
}

/** 6 points: a 2-point `body` and a 4-point `tail` along +x. */
function cloud(): PointCloud {
  const positions = Float32Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0, 0, 4, 0, 0, 5, 0, 0])
  return {
    count: 6,
    positions,
    scales: new Float32Array(18).fill(0.5),
    colors: new Float32Array(18).fill(1),
    layers: [
      { name: 'body', start: 0, end: 2, color: [1, 1, 1] },
      { name: 'tail', start: 2, end: 6, color: [1, 1, 1] },
    ],
  }
}

describe('SliceAnimator', () => {
  it('writes only its layer, once per frame, at the layer start', () => {
    const c = cloud()
    const animator = new SliceAnimator(c, c.layers[1]!, { layer: 'tail', kind: 'sway', pivot: [2, 0] })
    const writer = recorder()
    animator.update(writer, 0.4)

    assert.equal(writer.writes.length, 1)
    assert.equal(writer.writes[0]!.start, 2)
    assert.equal(writer.writes[0]!.data.positions!.length, 12)
  })

  it('sway rotates around the pivot, preserving distances; the pivot itself stays put', () => {
    const c = cloud()
    const writer = recorder()
    new SliceAnimator(c, c.layers[1]!, { layer: 'tail', kind: 'sway', pivot: [2, 0] }).update(writer, 0.4)
    const p = writer.writes[0]!.data.positions!
    assert.deepEqual([p[0], p[1]], [2, 0])
    for (let i = 0; i < 4; i++) {
      assert.ok(Math.abs(Math.hypot(p[i * 3]! - 2, p[i * 3 + 1]!) - i) < 1e-5)
    }
  })

  it('spin keeps heights and the distance to the vertical axis; pulse scales about the centroid', () => {
    const c = cloud()
    const writer = recorder()
    new SliceAnimator(c, c.layers[1]!, { layer: 'tail', kind: 'spin' }).update(writer, 1)
    new SliceAnimator(c, c.layers[1]!, { layer: 'tail', kind: 'pulse' }).update(writer, 0.5)
    const spun = writer.writes[0]!.data.positions!
    const pulsed = writer.writes[1]!.data.positions!
    for (let i = 0; i < 4; i++) {
      assert.equal(spun[i * 3 + 1], 0)
      assert.ok(Math.abs(Math.hypot(spun[i * 3]! - 3.5, spun[i * 3 + 2]!) - Math.abs(i + 2 - 3.5)) < 1e-5)
    }
    const centroidX = (pulsed[0]! + pulsed[3]! + pulsed[6]! + pulsed[9]!) / 4
    assert.ok(Math.abs(centroidX - 3.5) < 1e-5)
  })

  it('rise keeps points inside the layer height, wrapping to the bottom', () => {
    const c = cloud()
    c.positions.set([0, 0, 0, 0, 1, 0, 0, 2, 0, 0, 3, 0], 6)
    const writer = recorder()
    const animator = new SliceAnimator(c, c.layers[1]!, { layer: 'tail', kind: 'rise' })
    for (const t of [0.3, 1.7, 9.2]) animator.update(writer, t)
    for (const { data } of writer.writes) {
      for (let i = 1; i < 12; i += 3) assert.ok(data.positions![i]! >= 0 && data.positions![i]! <= 3)
    }
  })

  it('reset writes the resting pose back', () => {
    const c = cloud()
    const writer = recorder()
    new SliceAnimator(c, c.layers[1]!, { layer: 'tail', kind: 'spin' }).reset(writer)
    assert.deepEqual([...writer.writes[0]!.data.positions!], [...c.positions.subarray(6)])
  })
})

describe('WaveAnimator', () => {
  it('displaces y by the wave and writes the whole buffer in one call', () => {
    const c = cloud()
    const writer = recorder()
    new WaveAnimator(c).update(writer, 0.25)
    const p = writer.writes[0]!.data.positions!
    assert.equal(writer.writes.length, 1)
    assert.equal(p.length, 18)
    for (let i = 0; i < 6; i++) {
      assert.ok(Math.abs(p[i * 3 + 1]! - waveOffset(i, 0, 0.25)) < 1e-6)
      assert.ok(Math.abs(p[i * 3 + 1]!) <= WAVE_AMPLITUDE + 1e-6)
    }
  })
})

describe('MorphTransition', () => {
  it('eases from the old particles to the new ones and lands exactly', () => {
    const from = { ...cloud(), count: 2, positions: Float32Array.from([0, 0, 0, 10, 10, 10]), scales: new Float32Array(6).fill(1), colors: new Float32Array(6) }
    const to = cloud()
    const writer = recorder()
    const morph = new MorphTransition(from, to, 100)

    morph.begin(writer, 0)
    assert.deepEqual([...writer.writes[0]!.data.positions!.subarray(0, 3)], [0, 0, 0])
    assert.deepEqual([...writer.writes[0]!.data.positions!.subarray(15, 18)], [10, 10, 10], 'later targets start from later sources')

    assert.equal(morph.step(writer, 50), false)
    const middle = writer.writes[1]!.data.positions!
    assert.ok(middle[15]! > 5 && middle[15]! < 10)

    assert.equal(morph.step(writer, 100), true)
    assert.deepEqual([...writer.writes[2]!.data.positions!], [...to.positions])
    assert.deepEqual([...writer.writes[2]!.data.scales!], [...to.scales])
  })

  it('maps targets proportionally onto sources and eases smoothly', () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => sourceIndex(i, 4, 2)), [0, 0, 1, 1])
    assert.deepEqual([0, 1].map((i) => sourceIndex(i, 2, 4)), [0, 2])
    assert.equal(easeInOutCubic(0), 0)
    assert.equal(easeInOutCubic(0.5), 0.5)
    assert.equal(easeInOutCubic(1), 1)
    assert.equal(easeInOutCubic(7), 1)
  })
})
