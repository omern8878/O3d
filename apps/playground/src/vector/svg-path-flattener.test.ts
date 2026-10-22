import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { flattenPathData } from './svg-path-flattener.ts'

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

describe('flattenPathData', () => {
  it('handles absolute and relative lines, H/V and closepath', () => {
    const [square] = flattenPathData('M0 0 H10 v10 h-10 Z')
    assert.deepEqual(square, { points: [0, 0, 10, 0, 10, 10, 0, 10], closed: true })
  })

  it('treats extra moveto pairs as linetos and splits sub-paths', () => {
    const polylines = flattenPathData('M0 0 1 1 2 0 M5 5 l1 0')
    assert.equal(polylines.length, 2)
    assert.deepEqual(polylines[0]!.points, [0, 0, 1, 1, 2, 0])
    assert.deepEqual(polylines[1]!.points, [5, 5, 6, 5])
  })

  it('parses packed numbers like "1-2.5.5"', () => {
    const [line] = flattenPathData('M1-2.5.5 3')
    assert.deepEqual(line!.points, [1, -2.5, 0.5, 3])
  })

  it('flattens cubic and quadratic curves through their end points', () => {
    const [cubic] = flattenPathData('M0 0 C0 10 10 10 10 0', 0.5)
    assert.ok(cubic!.points.length > 10)
    assert.deepEqual(cubic!.points.slice(-2), [10, 0])
    // The cubic's midpoint is at (5, 7.5).
    assert.ok(cubic!.points.some((_, i) => i % 2 === 1 && close(cubic!.points[i]!, 7.5, 0.2)))

    const [quad] = flattenPathData('M0 0 Q5 10 10 0 T20 0')
    assert.deepEqual(quad!.points.slice(-2), [20, 0])
  })

  it('flattens arcs, including glued flags, onto the circle', () => {
    const [circle] = flattenPathData('M-10 0 A10 10 0 1 0 10 0 A10 10 0 1 0 -10 0Z')
    for (let i = 0; i < circle!.points.length; i += 2) {
      assert.ok(close(Math.hypot(circle!.points[i]!, circle!.points[i + 1]!), 10, 1e-6))
    }
    const [glued] = flattenPathData('M0 0a5 5 0 015 5')
    assert.deepEqual(glued!.points.slice(-2).map(Math.round), [5, 5])
  })

  it('ignores malformed data instead of throwing or looping', () => {
    assert.deepEqual(flattenPathData(''), [])
    assert.deepEqual(flattenPathData('M0 0 L'), [])
    assert.equal(flattenPathData('M0 0 L1 1 Z 5 5 ??').length, 1)
  })
})
