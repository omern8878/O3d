import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createHeadlessGpuContext, initEngine } from '@engine/templates'
import type { CompetitorBenchmarkReport, WorkloadKey, WorkloadReport } from './report/benchmark-report.types.ts'
import type { CompetitorId } from './competitor.types.ts'

const COUNT = 4_000
const SLICE = COUNT * 0.01
const CHURN = COUNT * 0.02
const VEC3 = 12
const MATRIX = 64

describe('CompetitorBenchmarkSuite (headless, every adapter)', () => {
  let report: CompetitorBenchmarkReport
  let progress: number[]
  const workload = (key: WorkloadKey): WorkloadReport =>
    report.scales[0]!.workloads.find((w) => w.key === key)!
  const result = (key: WorkloadKey, id: CompetitorId) =>
    workload(key).results.find((r) => r.competitor === id)!

  before(async () => {
    const wasm = readFileSync(fileURLToPath(import.meta.resolve('@engine/core/pkg/engine_bg.wasm')))
    await initEngine({ module_or_path: wasm })
    const { CompetitorBenchmarkSuite } = await import('./competitor-benchmark-suite.ts')
    const { O3dCompetitor } = await import('./competitors/o3d-competitor.ts')
    const { ThreeCompetitor } = await import('./competitors/three-competitor.ts')
    const { JsAosCompetitor } = await import('./competitors/js-aos-competitor.ts')
    const gpu = createHeadlessGpuContext()
    progress = []
    report = await new CompetitorBenchmarkSuite([
      () => new O3dCompetitor(gpu, false),
      () => new O3dCompetitor(gpu, false, false),
      () => new ThreeCompetitor({ useUpdateRanges: true, device: null }),
      () => new ThreeCompetitor({ useUpdateRanges: false, device: null }),
      () => new JsAosCompetitor(gpu, false),
    ], 'headless').run(
      { counts: [COUNT], warmupFrames: 2, measuredFrames: 6, pickWarmupQueries: 2, pickQueries: 20 },
      ({ fraction }) => progress.push(fraction),
    )
  })

  it('runs all five workloads for all five engines, reporting monotonic progress', () => {
    const scale = report.scales[0]!
    assert.equal(scale.entityCount, COUNT)
    assert.deepEqual(scale.workloads.map((w) => w.key), ['static-orbit', 'partial-mutation', 'churn', 'deep-zoom', 'picking'])
    for (const w of scale.workloads) {
      assert.deepEqual(w.results.map((r) => r.competitor), ['o3d', 'o3d-no-culling', 'three-ranges', 'three-naive', 'js-aos'])
    }
    assert.deepEqual(progress, [...progress].sort((a, b) => a - b))
    assert.equal(progress.at(-1), 1)
    assert.equal(report.environment.backend, 'headless')
  })

  it('reports finite, ordered percentiles for every measurement', () => {
    for (const w of report.scales[0]!.workloads) {
      for (const r of w.results) {
        const { p50, p95, p99, max, samples } = r.cpuMs
        assert.ok([p50, p95, p99, max].every((v) => Number.isFinite(v) && v >= 0), `${w.key}/${r.competitor}`)
        assert.ok(p50 <= p95 && p95 <= p99 && p99 <= max)
        assert.equal(samples, w.key === 'picking' ? 20 : 6)
        assert.equal(r.gpuInclusiveMs, null, 'headless runs have no GPU timing')
      }
    }
  })

  it('static orbit: only the JS scene graph re-uploads instance data', () => {
    assert.equal(result('static-orbit', 'o3d').instanceBytesPerFrame, 0)
    assert.equal(result('static-orbit', 'o3d-no-culling').instanceBytesPerFrame, 0)
    assert.equal(result('static-orbit', 'three-ranges').instanceBytesPerFrame, 0)
    assert.equal(result('static-orbit', 'three-naive').instanceBytesPerFrame, 0)
    assert.equal(result('static-orbit', 'js-aos').instanceBytesPerFrame, COUNT * 36)
    for (const r of workload('static-orbit').results) assert.equal(r.drawnInstancesPerFrame, COUNT)
  })

  it('partial mutation: O3d sends 12 B per moved entity, ranged Three.js 64 B, the rest everything', () => {
    assert.equal(result('partial-mutation', 'o3d').instanceBytesPerFrame, SLICE * VEC3)
    assert.equal(result('partial-mutation', 'o3d-no-culling').instanceBytesPerFrame, SLICE * VEC3)
    assert.equal(result('partial-mutation', 'three-ranges').instanceBytesPerFrame, SLICE * MATRIX)
    assert.equal(result('partial-mutation', 'three-naive').instanceBytesPerFrame, COUNT * MATRIX)
    assert.equal(result('partial-mutation', 'js-aos').instanceBytesPerFrame, COUNT * 36)
  })

  it('churn: every engine keeps the entity count constant', () => {
    for (const r of workload('churn').results) assert.equal(r.drawnInstancesPerFrame, COUNT, r.competitor)
    assert.equal(result('churn', 'three-naive').instanceBytesPerFrame, COUNT * (MATRIX + VEC3))
    assert.ok(result('churn', 'o3d').instanceBytesPerFrame > 0)
    assert.ok(CHURN > 0)
  })

  it('deep zoom: only O3d culls, drawing a small visible share', () => {
    const o3d = result('deep-zoom', 'o3d')
    const zoomVisible = report.scales[0]!.zoomVisibleFraction
    assert.ok(o3d.drawnInstancesPerFrame > 0 && o3d.drawnInstancesPerFrame < COUNT * 0.15)
    assert.ok(Math.abs(o3d.drawnInstancesPerFrame / COUNT - zoomVisible) < 0.02, 'O3d agrees with the JS frustum test')
    assert.equal(o3d.instanceBytesPerFrame, o3d.drawnInstancesPerFrame * 36)
    for (const id of ['o3d-no-culling', 'three-ranges', 'three-naive', 'js-aos'] as const) {
      assert.equal(result('deep-zoom', id).drawnInstancesPerFrame, COUNT)
    }
  })

  it('picking: deterministic keys; O3d and the JS graph test the same spheres', () => {
    const o3d = result('picking', 'o3d').pickedKeys!
    const js = result('picking', 'js-aos').pickedKeys!
    assert.equal(o3d.length, 20)
    assert.ok(o3d.some((key) => key !== null), 'some queries hit the cat')
    const agreeing = o3d.filter((key, i) => key === js[i]).length
    assert.ok(agreeing >= 18, `O3d and JS agree on ${agreeing}/20`)
    assert.deepEqual(result('picking', 'three-ranges').pickedKeys, result('picking', 'three-naive').pickedKeys)
    assert.match(workload('picking').notes[0]!, /Same entity as O3d/)
  })

  it('reports per-entity instance footprints', () => {
    const bytes = Object.fromEntries(report.scales[0]!.footprints.map((f) => [f.competitor, f.instanceBytesPerEntity]))
    assert.deepEqual(bytes, { o3d: 36, 'o3d-no-culling': 36, 'three-ranges': 76, 'three-naive': 76, 'js-aos': 36 })
  })
})
