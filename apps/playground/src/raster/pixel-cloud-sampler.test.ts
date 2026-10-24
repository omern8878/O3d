import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { samplePixelCloud, type PixelImage } from './pixel-cloud-sampler.ts'

/** A 4 x 2 image: only pixels (1, 0) red and (2, 1) blue are painted. */
function image(): PixelImage {
  const data = new Uint8ClampedArray(4 * 2 * 4)
  data.set([255, 0, 0, 255], (0 * 4 + 1) * 4)
  data.set([0, 0, 255, 200], (1 * 4 + 2) * 4)
  data.set([0, 255, 0, 10], (1 * 4 + 0) * 4) // nearly transparent: ignored
  return { data, width: 4, height: 2 }
}

describe('samplePixelCloud', () => {
  it('samples only painted pixels, with their colours, +Y up', () => {
    const cloud = samplePixelCloud(image(), 500)
    assert.equal(cloud.count, 500)
    for (let i = 0; i < cloud.count; i++) {
      const [x, y] = [cloud.positions[i * 3]!, cloud.positions[i * 3 + 1]!]
      const red = x >= 1 && x < 2 && y <= 0 && y > -1
      const blue = x >= 2 && x < 3 && y <= -1 && y > -2
      assert.ok(red || blue, `point ${i} at ${x}, ${y}`)
      assert.deepEqual([...cloud.colors.subarray(i * 3, i * 3 + 3)], red ? [1, 0, 0] : [0, 0, 1])
    }
    assert.deepEqual(cloud.layers, [{ name: 'raster', start: 0, end: 500, color: [1, 1, 1] }])
  })

  it('is deterministic and rejects an empty render', () => {
    assert.deepEqual(samplePixelCloud(image(), 50).positions, samplePixelCloud(image(), 50).positions)
    assert.throws(() => samplePixelCloud({ data: new Uint8ClampedArray(16), width: 2, height: 2 }, 10), /nothing visible/)
  })
})
