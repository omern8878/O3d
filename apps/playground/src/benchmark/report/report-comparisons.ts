import type { CompetitorWorkloadResult, WorkloadReport } from './benchmark-report.types.ts'

/** O3d variants are the same engine; comparing against them is not a competitor result. */
export function isO3dVariant(result: CompetitorWorkloadResult): boolean {
  return result.competitor === 'o3d' || result.competitor === 'o3d-no-culling'
}

/** The fewest bytes per frame any non-O3d engine uploaded on this workload. */
export function bestRivalBytes(workload: WorkloadReport): number | null {
  const rivals = workload.results.filter((r) => !isO3dVariant(r)).map(bytesPerFrame)
  return rivals.length > 0 ? Math.min(...rivals) : null
}

/** How many times slower `other` is than O3d (P50 CPU); > 1 means O3d is faster. */
export function speedupVsO3d(workload: WorkloadReport, other: CompetitorWorkloadResult): number | null {
  const o3d = workload.results.find((r) => r.competitor === 'o3d')
  if (!o3d || o3d.cpuMs.p50 <= 0 || other.cpuMs.p50 <= 0) return null
  return other.cpuMs.p50 / o3d.cpuMs.p50
}

/** The bytes a result is judged by: measured at the driver when available, else the engine's own count. */
export function bytesPerFrame(result: CompetitorWorkloadResult): number {
  return result.measuredBytesPerFrame ?? result.instanceBytesPerFrame
}

/** Workloads that draw (picking does not). */
export function isFrameWorkload(workload: WorkloadReport): boolean {
  return workload.key !== 'picking'
}
