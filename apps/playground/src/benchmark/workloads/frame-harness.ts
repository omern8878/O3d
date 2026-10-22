import type { FrameTelemetry, IBenchmarkCompetitor } from '../competitor.types.ts'
import { readHeapBytes } from '../instrumentation/heap-probe.ts'
import type { GpuUploadCounter } from '../instrumentation/gpu-upload-counter.ts'
import type { CompetitorWorkloadResult } from '../report/benchmark-report.types.ts'
import { summarize } from '../stats/sample-summary.ts'

export type FramePlan = { warmup: number; measured: number }

export const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/**
 * Waits for the next animation frame (a macrotask outside browsers). Every
 * benchmark frame starts on its own tick, like a real render loop; this also
 * matters for Three.js, whose per-frame node updates (including instance
 * buffer syncs) advance only on animation-frame ticks.
 */
const nextAnimationFrame = () =>
  typeof requestAnimationFrame === 'function'
    ? new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    : yieldToEventLoop()

/**
 * Runs `plan.warmup` discarded frames, then `plan.measured` recorded ones,
 * one per animation frame. Each frame records CPU time (until `step`
 * returns) and, on a real GPU, the time until the queue drained, plus bytes
 * seen by the upload counter.
 */
export async function measureFrames(
  competitor: IBenchmarkCompetitor,
  plan: FramePlan,
  counter: GpuUploadCounter,
  step: (frame: number) => FrameTelemetry,
): Promise<Omit<CompetitorWorkloadResult, 'competitor' | 'label'>> {
  const device = competitor.gpuDevice()
  const cpu: number[] = []
  const gpu: number[] = []
  let instanceBytes = 0
  let measuredBytes = 0
  let drawn = 0
  let heapStart: number | null = null

  for (let frame = 0; frame < plan.warmup + plan.measured; frame++) {
    const recording = frame >= plan.warmup
    if (frame === plan.warmup) heapStart = readHeapBytes()
    await nextAnimationFrame()
    counter.reset()
    const start = performance.now()
    const telemetry = step(frame)
    const cpuEnd = performance.now()
    const bytes = counter.read()
    if (device) await device.queue.onSubmittedWorkDone()
    const gpuEnd = performance.now()

    if (!recording) continue
    cpu.push(cpuEnd - start)
    if (device) gpu.push(gpuEnd - start)
    instanceBytes += telemetry.instanceBytes
    measuredBytes += bytes ?? 0
    drawn += telemetry.drawnInstances
  }

  const heapEnd = readHeapBytes()
  const n = Math.max(plan.measured, 1)
  return {
    cpuMs: summarize(cpu),
    gpuInclusiveMs: device ? summarize(gpu) : null,
    instanceBytesPerFrame: instanceBytes / n,
    measuredBytesPerFrame: counter.read() === null ? null : measuredBytes / n,
    drawnInstancesPerFrame: drawn / n,
    heapDeltaBytes: heapStart !== null && heapEnd !== null ? heapEnd - heapStart : null,
  }
}
