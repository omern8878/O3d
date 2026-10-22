import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summarize } from './sample-summary.ts'

describe('summarize', () => {
  it('computes nearest-rank percentiles, mean and max', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)
    assert.deepEqual(summarize(values.reverse()), { p50: 50, p95: 95, p99: 99, mean: 50.5, max: 100, samples: 100 })
  })

  it('exposes a single spike in P99 but not P50', () => {
    const values = [...Array(99).fill(1), 40]
    const { p50, p99, max } = summarize(values)
    assert.deepEqual([p50, p99, max], [1, 1, 40])
    assert.equal(summarize([...Array(98).fill(1), 40, 40]).p99, 40)
  })

  it('handles empty input', () => {
    assert.equal(summarize([]).samples, 0)
  })
})
