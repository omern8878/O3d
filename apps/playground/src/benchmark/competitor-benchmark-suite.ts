import type { CompetitorId, IBenchmarkCompetitor } from './competitor.types.ts'
import { createBenchmarkDataset } from './dataset/benchmark-dataset.ts'
import { visibleFraction } from './dataset/benchmark-cameras.ts'
import { GpuUploadCounter } from './instrumentation/gpu-upload-counter.ts'
import { readHeapBytes } from './instrumentation/heap-probe.ts'
import type {
  CompetitorBenchmarkReport, FootprintReport, ScaleReport, WorkloadReport,
} from './report/benchmark-report.types.ts'
import { yieldToEventLoop } from './workloads/frame-harness.ts'
import { createZoomCameras, WORKLOADS, type WorkloadContext } from './workloads/workload-definitions.ts'
import { describePickAgreement } from './report/pick-agreement.ts'
import { summarize } from './stats/sample-summary.ts'

export type CompetitorBenchmarkOptions = {
  /** Entity counts to run, e.g. `[10_000, 50_000, 100_000]`. */
  counts: number[]
  warmupFrames?: number
  measuredFrames?: number
  pickWarmupQueries?: number
  pickQueries?: number
  /** Share of entities churned per frame. Default `0.02` (2,000 at 100k). */
  churnFraction?: number
  /** Share of entities the deep-zoom camera keeps visible. Default `0.05`. */
  zoomVisibleFraction?: number
}

export type BenchmarkProgress = { fraction: number; message: string }

/** Builds a fresh engine instance; called once per workload so runs never share state. */
export type CompetitorFactory = () => IBenchmarkCompetitor

/**
 * Head-to-head benchmark: every competitor runs every workload at every
 * scale, each time freshly set up from the same deterministic dataset.
 */
export class CompetitorBenchmarkSuite {
  private readonly factories: readonly CompetitorFactory[]
  private readonly backend: 'webgpu' | 'headless'

  constructor(factories: readonly CompetitorFactory[], backend: 'webgpu' | 'headless') {
    this.factories = factories
    this.backend = backend
  }

  async run(
    options: CompetitorBenchmarkOptions,
    onProgress: (progress: BenchmarkProgress) => void = () => undefined,
  ): Promise<CompetitorBenchmarkReport> {
    const settings = {
      warmupFrames: 30, measuredFrames: 120, pickWarmupQueries: 10, pickQueries: 50,
      churnFraction: 0.02, zoomVisibleFraction: 0.05, ...options,
    }
    const counter = new GpuUploadCounter()
    const totalSteps = settings.counts.length * WORKLOADS.length * this.factories.length
    let completedSteps = 0
    const scales: ScaleReport[] = []

    for (const count of settings.counts) {
      onProgress({ fraction: completedSteps / totalSteps, message: `Sampling ${count.toLocaleString('en-US')}-entity dataset…` })
      await yieldToEventLoop()
      const data = createBenchmarkDataset(count)
      const zoomCameras = createZoomCameras(data, settings.zoomVisibleFraction)
      const ctx: WorkloadContext = {
        data,
        plan: { warmup: settings.warmupFrames, measured: settings.measuredFrames },
        pickPlan: { warmup: settings.pickWarmupQueries, measured: settings.pickQueries },
        counter,
        churnPerFrame: Math.max(1, Math.round(count * settings.churnFraction)),
        zoomCameras,
      }
      const footprints = new Map<CompetitorId, FootprintReport>()
      const setupHeapSamples = new Map<CompetitorId, number[]>()
      const workloads: WorkloadReport[] = []

      for (const workload of WORKLOADS) {
        const report: WorkloadReport = {
          key: workload.key, title: workload.title, description: workload.describe(ctx), results: [], notes: [],
        }
        for (const factory of this.factories) {
          const competitor = factory()
          onProgress({
            fraction: completedSteps / totalSteps,
            message: `${count.toLocaleString('en-US')} · ${workload.title} · ${competitor.label}`,
          })
          await yieldToEventLoop()
          const heapBefore = readHeapBytes()
          await competitor.setup(count, data)
          const heapAfter = readHeapBytes()
          footprints.set(competitor.id, {
            competitor: competitor.id,
            label: competitor.label,
            instanceBytesPerEntity: competitor.instanceBytesPerEntity,
            setupHeapBytesPerEntity: null,
          })
          if (heapBefore !== null && heapAfter !== null) {
            const samples = setupHeapSamples.get(competitor.id) ?? []
            samples.push((heapAfter - heapBefore) / count)
            setupHeapSamples.set(competitor.id, samples)
          }
          try {
            const measurement = await workload.run(competitor, ctx)
            report.results.push({ competitor: competitor.id, label: competitor.label, ...measurement })
          } finally {
            competitor.dispose()
          }
          completedSteps++
        }
        if (workload.key === 'picking') report.notes.push(describePickAgreement(report.results))
        workloads.push(report)
      }
      // The median of the fresh setups drops one-time costs (module load, renderer init).
      for (const [id, samples] of setupHeapSamples) footprints.get(id)!.setupHeapBytesPerEntity = summarize(samples).p50
      scales.push({
        entityCount: count,
        zoomVisibleFraction: visibleFraction(data, zoomCameras[0]),
        workloads,
        footprints: [...footprints.values()],
      })
    }
    onProgress({ fraction: 1, message: 'Done' })

    return {
      createdAt: new Date().toISOString(),
      environment: {
        userAgent: typeof navigator === 'undefined' ? `Node ${process.version}` : navigator.userAgent,
        backend: this.backend,
        warmupFrames: settings.warmupFrames,
        measuredFrames: settings.measuredFrames,
        pickWarmupQueries: settings.pickWarmupQueries,
        pickQueries: settings.pickQueries,
      },
      scales,
    }
  }
}
