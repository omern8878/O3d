import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CAT_SVG, CAT_TAIL_LAYER } from './cat-vector-svg.ts'
import { sampleSvgPointCloud } from './svg-point-sampler.ts'

const SQUARE_SVG = `<svg viewBox="0 0 100 100"><rect id="square" x="0" y="0" width="100" height="100" fill="#ff0000"/></svg>`

describe('sampleSvgPointCloud', () => {
  it('produces exactly the requested number of points for every showcase size', () => {
    for (const count of [20_000, 50_000, 100_000]) {
      const cloud = sampleSvgPointCloud(CAT_SVG, { count })
      assert.equal(cloud.count, count)
      assert.equal(cloud.positions.length, count * 3)
      assert.equal(cloud.scales.length, count * 3)
      assert.equal(cloud.colors.length, count * 3)
    }
  })

  it('keeps every named cat layer in one contiguous slice, tail first', () => {
    const cloud = sampleSvgPointCloud(CAT_SVG, { count: 50_000 })
    const names = cloud.layers.map((layer) => layer.name)

    assert.equal(new Set(names).size, names.length, 'each layer appears once')
    assert.deepEqual(names.slice(0, 4), [CAT_TAIL_LAYER, 'ear-left', 'ear-right', 'body'])
    for (const expected of ['chest', 'eyes', 'pupils', 'nose', 'whiskers', 'ear-inner-left']) {
      assert.ok(names.includes(expected), `missing ${expected}`)
    }

    // Layers tile [0, count) with no gaps or overlaps.
    let cursor = 0
    for (const layer of cloud.layers) {
      assert.equal(layer.start, cursor)
      assert.ok(layer.end > layer.start)
      cursor = layer.end
    }
    assert.equal(cursor, cloud.count)

    const tail = cloud.layers[0]!
    assert.equal(tail.start, 0)
    assert.ok(tail.end - tail.start > 1_000, 'the tail is a sizeable slice')
  })

  it('produces finite world data with colors in 0..1 and positive sizes', () => {
    const cloud = sampleSvgPointCloud(CAT_SVG, { count: 20_000 })
    assert.ok(cloud.positions.every(Number.isFinite))
    assert.ok(cloud.scales.every((s) => s > 0 && Number.isFinite(s)))
    assert.ok(cloud.colors.every((c) => c >= 0 && c <= 1))
  })

  it('fits the drawing to the requested world height, centered, with +Y up', () => {
    const cloud = sampleSvgPointCloud(SQUARE_SVG, { count: 4_000, worldHeight: 50 })
    let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity
    for (let i = 0; i < cloud.count; i++) {
      minX = Math.min(minX, cloud.positions[i * 3]!)
      maxX = Math.max(maxX, cloud.positions[i * 3]!)
      minY = Math.min(minY, cloud.positions[i * 3 + 1]!)
      maxY = Math.max(maxY, cloud.positions[i * 3 + 1]!)
    }
    assert.ok(maxY <= 25.01 && minY >= -25.01)
    assert.ok(maxY - minY > 49 && maxX - minX > 49)
    // SVG y = 0 (top) maps to the top of the world.
    assert.deepEqual(cloud.toWorld(50, 0), [0, 25])
  })

  it('puts the configured share of points on the outline', () => {
    const cloud = sampleSvgPointCloud(SQUARE_SVG, { count: 10_000, outlineShare: 0.3 })
    let onEdge = 0
    for (let i = 0; i < cloud.count; i++) {
      const x = Math.abs(cloud.positions[i * 3]!)
      const y = Math.abs(cloud.positions[i * 3 + 1]!)
      if (Math.abs(Math.max(x, y) - 100) < 1e-3) onEdge++
    }
    assert.ok(Math.abs(onEdge / cloud.count - 0.3) < 0.01, `edge share ${onEdge / cloud.count}`)
  })

  it('domes fills: interior points sit higher than outline points', () => {
    const cloud = sampleSvgPointCloud(SQUARE_SVG, { count: 10_000 })
    let edgeZ = 0, centerZ = 0
    for (let i = 0; i < cloud.count; i++) {
      const r = Math.max(Math.abs(cloud.positions[i * 3]!), Math.abs(cloud.positions[i * 3 + 1]!))
      const z = cloud.positions[i * 3 + 2]!
      if (r > 99.99) edgeZ = Math.max(edgeZ, z)
      if (r < 10) centerZ = Math.max(centerZ, z)
    }
    assert.ok(centerZ > edgeZ + 10, `center ${centerZ} vs edge ${edgeZ}`)
  })

  it('is deterministic for a seed', () => {
    const a = sampleSvgPointCloud(CAT_SVG, { count: 5_000, seed: 3 })
    const b = sampleSvgPointCloud(CAT_SVG, { count: 5_000, seed: 3 })
    assert.deepEqual(a.positions, b.positions)
    assert.deepEqual(a.colors, b.colors)
  })

  it('samples arbitrary uploaded SVGs: groups, transforms, styles, strokes and holes', () => {
    const custom = `<?xml version="1.0"?>
      <!-- an uploaded logo -->
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="100">
        <defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>
        <g transform="translate(100 50) scale(2)" style="fill: rgb(0, 128, 255)">
          <path d="M-20-20h40v40h-40z M-10-10v20h20v-20z" fill-rule="evenodd"/>
        </g>
        <polyline points="10,90 50,60 90,90" fill="none" stroke="gold" stroke-width="4"/>
        <circle cx="180" cy="20" r="10" fill="none"/>
      </svg>`
    const cloud = sampleSvgPointCloud(custom, { count: 3_000 })

    assert.equal(cloud.count, 3_000)
    assert.deepEqual(cloud.layers.map((l) => l.name), ['path-1', 'polyline-2'])
    assert.deepEqual(cloud.layers[0]!.color, [0, 128 / 255, 1])

    // The evenodd hole (|x|,|y| < 20 in SVG units around the center) stays empty.
    const [holeX, holeY] = cloud.toWorld(100, 50)
    const [edgeX] = cloud.toWorld(118, 50)
    const holeRadius = Math.abs(edgeX - holeX)
    for (let i = cloud.layers[0]!.start; i < cloud.layers[0]!.end; i++) {
      const dx = Math.abs(cloud.positions[i * 3]! - holeX)
      const dy = Math.abs(cloud.positions[i * 3 + 1]! - holeY)
      assert.ok(Math.max(dx, dy) > holeRadius, 'no fill point inside the hole')
    }
  })

  it('rejects an SVG with nothing to paint', () => {
    assert.throws(() => sampleSvgPointCloud('<svg viewBox="0 0 10 10"></svg>', { count: 10 }), /no paintable/)
    assert.throws(() => sampleSvgPointCloud('not an svg', { count: 10 }), /no paintable/)
  })
})
