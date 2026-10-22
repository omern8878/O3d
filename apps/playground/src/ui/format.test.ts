import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatBytes, formatCount, formatMs } from './format.ts'

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
})
