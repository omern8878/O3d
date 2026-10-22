import type { BenchCamera, IBenchmarkCompetitor, SceneDataset } from '../competitor.types.ts'
import { orbitCamera, overviewCamera, pickPoints, tightCamera } from '../dataset/benchmark-cameras.ts'
import type { GpuUploadCounter } from '../instrumentation/gpu-upload-counter.ts'
import type { CompetitorWorkloadResult, WorkloadKey } from '../report/benchmark-report.types.ts'
import { summarize } from '../stats/sample-summary.ts'
import { measureFrames, yieldToEventLoop, type FramePlan } from './frame-harness.ts'

/** Everything a workload needs besides the engine. */
export type WorkloadContext = {
  data: SceneDataset
  plan: FramePlan
  pickPlan: FramePlan
  counter: GpuUploadCounter
  /** Entities despawned and spawned per churn frame. */
  churnPerFrame: number
  /** The two jittered deep-zoom cameras, alternated frame by frame. */
  zoomCameras: [BenchCamera, BenchCamera]
}

type WorkloadMeasurement = Omit<CompetitorWorkloadResult, 'competitor' | 'label'>

export type WorkloadDefinition = {
  key: WorkloadKey
  title: string
  describe(ctx: WorkloadContext): string
  run(competitor: IBenchmarkCompetitor, ctx: WorkloadContext): Promise<WorkloadMeasurement>
}

/** Frames per second the partial-mutation wave is timed against. */
const WAVE_FPS = 60

/** The five workloads, in the order they run. */
export const WORKLOADS: readonly WorkloadDefinition[] = [
  {
    key: 'static-orbit',
    title: '1. Static scene, orbiting camera',
    describe: () => 'No entity changes; the camera orbits the whole scene every frame.',
    run: (c, ctx) => measureFrames(c, ctx.plan, ctx.counter, (frame) => c.renderStaticFrame(orbitCamera(frame))),
  },
  {
    key: 'partial-mutation',
    title: '2. Localized animation (1% contiguous slice)',
    describe: (ctx) => `${ctx.data.tailSlice.count.toLocaleString('en-US')} contiguous tail entities move every frame.`,
    run: (c, ctx) => {
      c.renderStaticFrame(overviewCamera())
      const { start, count } = ctx.data.tailSlice
      return measureFrames(c, ctx.plan, ctx.counter, (frame) =>
        c.renderPartialMutationFrame(start, count, frame / WAVE_FPS))
    },
  },
  {
    key: 'churn',
    title: '3. Entity churn (despawn + spawn)',
    describe: (ctx) => `${ctx.churnPerFrame.toLocaleString('en-US')} random entities despawned and as many spawned every frame.`,
    run: (c, ctx) => {
      c.renderStaticFrame(overviewCamera())
      return measureFrames(c, ctx.plan, ctx.counter, () => c.renderChurnFrame(ctx.churnPerFrame, ctx.churnPerFrame))
    },
  },
  {
    key: 'deep-zoom',
    title: '4. Deep zoom into the eye (frustum culling)',
    describe: () => 'Camera tight on the cat\'s eye, jittered by 0.002 units each frame so culling reruns.',
    run: (c, ctx) =>
      measureFrames(c, ctx.plan, ctx.counter, (frame) => c.renderZoomedFrame(ctx.zoomCameras[frame % 2]!)),
  },
  {
    key: 'picking',
    title: '5. Raycast picking',
    describe: (ctx) => `${ctx.pickPlan.measured} pointer queries against every entity (overview camera).`,
    run: runPicking,
  },
]

export function createZoomCameras(data: SceneDataset, visibleFraction: number): [BenchCamera, BenchCamera] {
  return [tightCamera(data, visibleFraction, 0), tightCamera(data, visibleFraction, 1)]
}

async function runPicking(c: IBenchmarkCompetitor, ctx: WorkloadContext): Promise<WorkloadMeasurement> {
  c.renderStaticFrame(overviewCamera())
  const points = pickPoints(ctx.pickPlan.measured)
  for (let i = 0; i < ctx.pickPlan.warmup; i++) {
    const [x, y] = points[i % points.length]!
    c.pickAtNdc(x, y)
  }
  await yieldToEventLoop()
  const times: number[] = []
  const pickedKeys: (number | null)[] = []
  for (const [x, y] of points) {
    const start = performance.now()
    pickedKeys.push(c.pickAtNdc(x, y))
    times.push(performance.now() - start)
  }
  return {
    cpuMs: summarize(times),
    gpuInclusiveMs: null,
    instanceBytesPerFrame: 0,
    measuredBytesPerFrame: null,
    drawnInstancesPerFrame: 0,
    heapDeltaBytes: null,
    pickedKeys,
  }
}
