import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { clientToNdc, wheelZoomFactor } from './wheel-zoom.ts'

describe('wheelZoomFactor', () => {
  it('returns 1 for a zero or non-finite delta', () => {
    assert.equal(wheelZoomFactor(0, 0), 1)
    assert.equal(wheelZoomFactor(Number.NaN, 0), 1)
  })

  it('zooms out for positive pixel deltas and in for negative', () => {
    assert.ok(wheelZoomFactor(40, 0) > 1)
    assert.ok(wheelZoomFactor(-40, 0) < 1)
  })

  it('treats line-mode deltas as 16px ticks', () => {
    assert.equal(wheelZoomFactor(1, 1), wheelZoomFactor(16, 0))
  })

  it('clamps huge trackpad spikes so one event cannot jump the view', () => {
    assert.equal(wheelZoomFactor(10_000, 0), wheelZoomFactor(80, 0))
    assert.equal(wheelZoomFactor(-10_000, 0), wheelZoomFactor(-80, 0))
  })
})

describe('clientToNdc', () => {
  const rect = { left: 100, top: 50, width: 200, height: 100 }

  it('maps the canvas centre to the origin', () => {
    const { ndcX, ndcY } = clientToNdc(200, 100, rect)
    assert.equal(ndcX, 0)
    assert.equal(ndcY, 0)
  })

  it('maps the top-left corner to (-1, 1) with Y up', () => {
    assert.deepEqual(clientToNdc(100, 50, rect), { ndcX: -1, ndcY: 1 })
  })
})
