import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatBytes, formatCount, formatMs, formatSavings } from './format.ts'

describe('format helpers', () => {
  it('formats byte counts', () => {
    assert.equal(formatBytes(0), '0 B')
    assert.equal(formatBytes(12_000), '11.7 KB')
    assert.equal(formatBytes(3_600_000), '3.43 MB')
  })

  it('formats counts and milliseconds', () => {
    assert.equal(formatCount(100000), '100,000')
    assert.equal(formatMs(0.5), '0.50 ms')
    assert.equal(formatMs(12.34), '12.3 ms')
  })

  it('describes savings without misleading rounding', () => {
    assert.equal(formatSavings(0, 3_600_000, 'amount'), '100% less')
    assert.equal(formatSavings(100_000, 100_000, 'amount'), 'same')
    assert.equal(formatSavings(4_502, 100_000, 'amount'), '95.5% less')
    assert.equal(formatSavings(0.5, 1.7, 'time'), '3.4× faster')
    assert.equal(formatSavings(2, 1, 'time'), '2.0× slower')
    assert.equal(formatSavings(1, 0, 'time'), '—')
  })
})
