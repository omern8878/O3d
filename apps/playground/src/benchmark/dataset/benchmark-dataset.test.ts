import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Vec3 } from '../competitor.types.ts'
import { orbitCamera, overviewCamera, pickPoints, tightCamera, visibleFraction } from './benchmark-cameras.ts'
import { createBenchmarkDataset, STAR_OUTER_RADIUS } from './benchmark-dataset.ts'
import { LiveKeyPool } from './live-key-pool.ts'

describe('benchmark dataset', () => {
  const data = createBenchmarkDataset(10_000)

  it('is byte-identical for the same size and seed', () => {
    const again = createBenchmarkDataset(10_000)
    assert.deepEqual(again.positions, data.positions)
    assert.deepEqual(again.colors, data.colors)
    assert.notDeepEqual(createBenchmarkDataset(10_000, 7).positions, data.positions)
  })

  it('is 70% cat (tail first) and 30% starfield inside the shell', () => {
    assert.equal(data.catCount, 7_000)
    assert.deepEqual(data.tailSlice, { start: 0, count: 100 })
    for (let key = data.catCount; key < data.count; key++) {
      const o = key * 3
      assert.ok(Math.hypot(data.positions[o]!, data.positions[o + 1]!, data.positions[o + 2]!) <= STAR_OUTER_RADIUS + 1e-3)
    }
  })

  it('spawns the same entity for the same key', () => {
    const a: [Vec3, Vec3, Vec3] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    const b: [Vec3, Vec3, Vec3] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    data.spawnEntity(12_345, ...a)
    data.spawnEntity(12_345, ...b)
    assert.deepEqual(a, b)
  })

  it('keeps everything in view from the orbit, and ~5% from the deep zoom', () => {
    assert.equal(visibleFraction(data, overviewCamera()), 1)
    assert.equal(visibleFraction(data, orbitCamera(157)), 1)
    const zoom = visibleFraction(data, tightCamera(data, 0.05))
    assert.ok(zoom > 0.01 && zoom <= 0.08, `zoom keeps ${zoom}`)
  })

  it('places pick points inside NDC near the centre', () => {
    const points = pickPoints(50)
    assert.equal(points.length, 50)
    for (const [x, y] of points) assert.ok(Math.abs(x) < 0.3 && Math.abs(y) < 0.3)
  })
})

describe('LiveKeyPool', () => {
  it('removes the same keys for the same seed and never repeats one', () => {
    const a = new LiveKeyPool(100, 9)
    const b = new LiveKeyPool(100, 9)
    const removed = Array.from({ length: 60 }, () => a.takeRandom())
    assert.deepEqual(removed, Array.from({ length: 60 }, () => b.takeRandom()))
    assert.equal(new Set(removed).size, 60)
    assert.equal(a.size, 40)
  })

  it('spawns fresh keys after the initial range', () => {
    const pool = new LiveKeyPool(10, 1)
    assert.equal(pool.spawnKey(), 10)
    assert.equal(pool.spawnKey(), 11)
    assert.equal(pool.size, 12)
  })
})
