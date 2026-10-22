import type { CompetitorBenchmarkReport, ScaleReport, WorkloadReport } from './benchmark-report.types.ts'
import { bytesPerFrame, isFrameWorkload, isO3dVariant, speedupVsO3d } from './report-comparisons.ts'

const ms = (value: number) => `${value < 10 ? value.toFixed(2) : value.toFixed(1)} ms`
const count = (value: number) => Math.round(value).toLocaleString('en-US')
function bytes(value: number): string {
  if (value < 1024) return `${Math.round(value)} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(2)} MB`
}

/** The whole report as GitHub-flavoured Markdown tables. */
export function renderBenchmarkMarkdown(report: CompetitorBenchmarkReport): string {
  const { environment: env } = report
  const lines = [
    `_${env.backend === 'webgpu' ? 'Real WebGPU device' : 'Headless (CPU only; uploads counted, not sent)'} · ` +
      `${env.warmupFrames} warm-up + ${env.measuredFrames} measured frames per workload ` +
      `(picking: ${env.pickWarmupQueries} + ${env.pickQueries} queries) · ${env.userAgent}_`,
    '',
  ]
  for (const scale of report.scales) lines.push(...renderScale(scale), '')
  return lines.join('\n').trimEnd() + '\n'
}

function renderScale(scale: ScaleReport): string[] {
  const lines = [`### ${count(scale.entityCount)} entities`, '']
  for (const workload of scale.workloads) lines.push(...renderWorkload(workload), '')
  lines.push(
    '**Memory per entity**', '',
    '| Engine | Instance data | JS heap at setup |',
    '|---|---:|---:|',
    ...scale.footprints.map((f) =>
      `| ${f.label} | ${f.instanceBytesPerEntity} B | ${f.setupHeapBytesPerEntity === null ? 'n/a' : `${Math.round(f.setupHeapBytesPerEntity)} B`} |`),
  )
  return lines
}

function renderWorkload(workload: WorkloadReport): string[] {
  const frames = isFrameWorkload(workload)
  const header = frames
    ? '| Engine | CPU P50 | P95 | P99 | GPU-incl. P50 | Bytes / frame | Drawn | O3d vs. engine |\n|---|---:|---:|---:|---:|---:|---:|---:|'
    : '| Engine | Latency P50 | P95 | P99 | O3d vs. engine |\n|---|---:|---:|---:|---:|'
  const rows = workload.results.map((r) => {
    const speedup = r.competitor === 'o3d' ? '—' : isO3dVariant(r) ? 'same engine' : formatSpeedup(speedupVsO3d(workload, r))
    const name = r.competitor === 'o3d' ? `**${r.label}**` : r.label
    const timing = `${ms(r.cpuMs.p50)} | ${ms(r.cpuMs.p95)} | ${ms(r.cpuMs.p99)}`
    if (!frames) return `| ${name} | ${timing} | ${speedup} |`
    const gpu = r.gpuInclusiveMs ? ms(r.gpuInclusiveMs.p50) : 'n/a'
    return `| ${name} | ${timing} | ${gpu} | ${bytes(bytesPerFrame(r))} | ${count(r.drawnInstancesPerFrame)} | ${speedup} |`
  })
  return [`**${workload.title}**: ${workload.description}`, '', header, ...rows, ...workload.notes.map((n) => `\n_${n}_`)]
}

function formatSpeedup(ratio: number | null): string {
  if (ratio === null) return '—'
  return ratio >= 1 ? `${ratio.toFixed(1)}× faster` : `${(1 / ratio).toFixed(1)}× slower`
}
