import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { summarize } from '../stats/sample-summary.ts'
import { renderBenchmarkMarkdown } from './benchmark-markdown.ts'
import type { CompetitorBenchmarkReport, CompetitorWorkloadResult } from './benchmark-report.types.ts'
import { speedupVsO3d } from './report-comparisons.ts'

const result = (competitor: 'o3d' | 'js-aos', ms: number, bytes: number): CompetitorWorkloadResult => ({
  competitor,
  label: competitor === 'o3d' ? 'O3d' : 'JS',
  cpuMs: summarize([ms]),
  gpuInclusiveMs: null,
  instanceBytesPerFrame: bytes,
  measuredBytesPerFrame: null,
  drawnInstancesPerFrame: 100,
  heapDeltaBytes: null,
})

const REPORT: CompetitorBenchmarkReport = {
  createdAt: '2026-10-22T00:00:00.000Z',
  environment: { userAgent: 'test', backend: 'headless', warmupFrames: 30, measuredFrames: 120, pickWarmupQueries: 10, pickQueries: 50 },
  scales: [{
    entityCount: 100_000,
    zoomVisibleFraction: 0.05,
    footprints: [{ competitor: 'o3d', label: 'O3d', instanceBytesPerEntity: 36, setupHeapBytesPerEntity: null }],
    workloads: [{
      key: 'static-orbit', title: '1. Static', description: 'desc', notes: ['a note'],
      results: [result('o3d', 0.5, 0), result('js-aos', 2, 3_600_000)],
    }],
  }],
}

describe('benchmark markdown', () => {
  it('renders a table per workload with speedups and bytes', () => {
    const md = renderBenchmarkMarkdown(REPORT)
    assert.match(md, /### 100,000 entities/)
    assert.match(md, /\| \*\*O3d\*\* \| 0\.50 ms \| 0\.50 ms \| 0\.50 ms \| n\/a \| 0 B \| 100 \| — \|/)
    assert.match(md, /\| JS \| 2\.00 ms .* 3\.43 MB \| 100 \| 4\.0× faster \|/)
    assert.match(md, /_a note_/)
    assert.match(md, /\| O3d \| 36 B \| n\/a \|/)
  })

  it('labels the culling-off O3d variant as the same engine, not a competitor', () => {
    const variant = { ...result('o3d', 0.1, 0), competitor: 'o3d-no-culling' as const, label: 'O3d, culling off' }
    const report = structuredClone(REPORT)
    report.scales[0]!.workloads[0]!.results.push(variant)
    assert.match(renderBenchmarkMarkdown(report), /\| O3d, culling off \| .* \| same engine \|/)
  })

  it('computes the speedup from P50 CPU time', () => {
    const workload = REPORT.scales[0]!.workloads[0]!
    assert.equal(speedupVsO3d(workload, workload.results[1]!), 4)
  })
})
