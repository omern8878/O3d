import type { CompetitorId } from '../competitor.types.ts'
import type { SampleSummary } from '../stats/sample-summary.ts'

export type WorkloadKey = 'static-orbit' | 'partial-mutation' | 'churn' | 'deep-zoom' | 'picking'

/** One engine's measurements on one workload. */
export type CompetitorWorkloadResult = {
  competitor: CompetitorId
  label: string
  /** CPU time per frame (per query for picking), in ms. */
  cpuMs: SampleSummary
  /** Frame time until the GPU finished the submitted work, in ms; `null` when headless. */
  gpuInclusiveMs: SampleSummary | null
  /** Mean instance bytes uploaded per frame, by the engine's own accounting. */
  instanceBytesPerFrame: number
  /** Mean bytes per frame through `GPUQueue.writeBuffer` (all buffers, uniforms included); `null` when headless. */
  measuredBytesPerFrame: number | null
  /** Mean instances submitted to the draw per frame. */
  drawnInstancesPerFrame: number
  /**
   * Retained JS heap growth over the measured frames, after a forced GC at
   * both ends (Chromium only). Short-lived garbage shows up in P95 / P99.
   */
  heapDeltaBytes: number | null
  /** Picking only: the dataset key each query returned. */
  pickedKeys?: (number | null)[]
}

export type WorkloadReport = {
  key: WorkloadKey
  title: string
  description: string
  results: CompetitorWorkloadResult[]
  notes: string[]
}

/** Memory each engine holds per entity. */
export type FootprintReport = {
  competitor: CompetitorId
  label: string
  /** Per-instance GPU data bytes. */
  instanceBytesPerEntity: number
  /**
   * Retained JS heap growth during setup divided by entities (Chromium with
   * `--expose-gc`): the median over the scale's fresh setups. Includes each
   * adapter's key bookkeeping, which has the same shape for every engine.
   */
  setupHeapBytesPerEntity: number | null
}

export type ScaleReport = {
  entityCount: number
  /** Share of entities the deep-zoom camera keeps in view. */
  zoomVisibleFraction: number
  workloads: WorkloadReport[]
  footprints: FootprintReport[]
}

export type CompetitorBenchmarkReport = {
  createdAt: string
  environment: {
    userAgent: string
    backend: 'webgpu' | 'headless'
    warmupFrames: number
    measuredFrames: number
    pickWarmupQueries: number
    pickQueries: number
  }
  scales: ScaleReport[]
}
