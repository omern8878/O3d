import { createHeadlessGpuContext, GpuContext } from '@engine/templates'
import {
  CompetitorBenchmarkSuite, type BenchmarkProgress, type CompetitorBenchmarkOptions, type CompetitorFactory,
} from './competitor-benchmark-suite.ts'
import { JsAosCompetitor } from './competitors/js-aos-competitor.ts'
import { O3dCompetitor } from './competitors/o3d-competitor.ts'
import { ThreeCompetitor } from './competitors/three-competitor.ts'
import { BENCH_ASPECT } from './dataset/benchmark-cameras.ts'
import type { CompetitorBenchmarkReport } from './report/benchmark-report.types.ts'

const CANVAS_HEIGHT = 360

/**
 * Runs the competitor suite on one shared WebGPU device (an offscreen canvas,
 * so nothing flashes on screen), or headless when `useGpu` is false.
 */
export async function runCompetitorBenchmark(
  useGpu: boolean,
  options: CompetitorBenchmarkOptions,
  onProgress: (progress: BenchmarkProgress) => void,
): Promise<CompetitorBenchmarkReport> {
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(CANVAS_HEIGHT * BENCH_ASPECT),
    height: CANVAS_HEIGHT,
  })
  const gpu = useGpu ? await GpuContext.create({ canvas }).catch(() => null) : null
  const context = gpu ?? createHeadlessGpuContext()
  const hasGpu = gpu !== null
  const device = gpu?.device ?? null

  const factories: CompetitorFactory[] = [
    () => new O3dCompetitor(context, hasGpu),
    () => new O3dCompetitor(context, hasGpu, false),
    () => new ThreeCompetitor({ useUpdateRanges: true, device }),
    () => new ThreeCompetitor({ useUpdateRanges: false, device }),
    () => new JsAosCompetitor(context, hasGpu),
  ]
  return new CompetitorBenchmarkSuite(factories, hasGpu ? 'webgpu' : 'headless').run(options, onProgress)
}

/**
 * Suite options from the page URL: `?benchScales=10000,50000,100000` and
 * `?benchFrames=30,120` (warm-up, measured). Defaults: 100k, 30 + 120.
 */
export function benchmarkOptionsFromUrl(search: string): CompetitorBenchmarkOptions {
  const params = new URLSearchParams(search)
  const counts = (params.get('benchScales') ?? '100000').split(',').map(Number).filter((n) => n >= 1000)
  const [warmupFrames, measuredFrames] = (params.get('benchFrames') ?? '30,120').split(',').map(Number)
  return {
    counts: counts.length > 0 ? counts : [100_000],
    warmupFrames: warmupFrames! >= 0 ? warmupFrames : 30,
    measuredFrames: measuredFrames! > 0 ? measuredFrames : 120,
  }
}
