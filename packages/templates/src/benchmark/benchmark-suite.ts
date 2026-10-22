import { createHeadlessGpuContext } from "../renderer/headless-gpu-context.ts";
import type { GpuContext } from "../renderer/gpu-context.ts";
import { SceneTemplate } from "../templates/scene-template.ts";
import type {
  BenchmarkOptions,
  BenchmarkReport,
  WorkloadResult,
} from "../types/benchmark.types.ts";
import { ObjectGraphScene } from "./object-graph-scene.ts";
import { generatePointCloud } from "./point-cloud-generator.ts";
import { runLocalizedAnimationWorkload } from "./workloads/localized-animation.workload.ts";
import { runRaycastPickingWorkload } from "./workloads/raycast-picking.workload.ts";
import { runStaticOrbitWorkload } from "./workloads/static-orbit.workload.ts";
import type { WorkloadContext } from "./workloads/workload-context.ts";
import { runZoomedCullingWorkload } from "./workloads/zoomed-culling.workload.ts";

const DEFAULTS: Required<BenchmarkOptions> = {
  entityCount: 100_000,
  iterations: 30,
  warmupIterations: 5,
  animatedFraction: 0.01,
  targetVisibleFraction: 0.05,
  seed: 1,
};

const WORKLOADS: readonly ((ctx: WorkloadContext) => WorkloadResult)[] = [
  runStaticOrbitWorkload,
  runLocalizedAnimationWorkload,
  runZoomedCullingWorkload,
  runRaycastPickingWorkload,
];

/** Lets the browser paint (e.g. a progress message) between workloads. */
const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Reproducible head-to-head benchmark of O3d (`SceneTemplate`: Wasm SoA,
 * zero-copy views, dirty tracking, frustum culling, Wasm picking) against a
 * traditional JS object graph that repacks and re-uploads every node each
 * frame.
 *
 * Both scenes hold the same seeded point cloud and run four workloads:
 * a static orbit, a localized animation, a zoomed-in culling pass and raycast
 * picking. Pass a real WebGPU `GpuContext` to include the driver's upload cost;
 * by default uploads go to a headless context, which measures CPU work and
 * counts bytes. The Wasm module must be initialized first.
 */
export class BenchmarkSuite {
  private readonly gpuContext: GpuContext;
  private readonly backend: BenchmarkReport["backend"];

  constructor(gpuContext?: GpuContext) {
    this.gpuContext = gpuContext ?? createHeadlessGpuContext();
    this.backend = gpuContext ? "webgpu" : "headless";
  }

  /**
   * Builds both scenes, runs every workload and returns the report.
   * `onProgress` is called after each workload with the results so far.
   */
  async run(
    options: BenchmarkOptions = {},
    onProgress?: (completed: readonly WorkloadResult[]) => void,
  ): Promise<BenchmarkReport> {
    const settings = { ...DEFAULTS, ...options };
    const entityCount = Math.max(1, Math.floor(settings.entityCount));
    const points = generatePointCloud(entityCount, settings.seed);

    const scene = new SceneTemplate(this.gpuContext, {
      initialCapacity: entityCount,
      cameraMode: "perspective3d",
    });
    for (const { position, scale, color } of points) {
      scene.addNode(position, scale, color);
    }
    const baseline = new ObjectGraphScene(this.gpuContext.device, points);

    const sliceLength = Math.max(1, Math.round(entityCount * settings.animatedFraction));
    const context: WorkloadContext = {
      scene,
      baseline,
      points,
      iterations: Math.max(1, settings.iterations),
      warmup: Math.max(0, settings.warmupIterations),
      animatedSlice: { start: entityCount - sliceLength, end: entityCount },
      targetVisibleFraction: settings.targetVisibleFraction,
    };

    const results: WorkloadResult[] = [];
    try {
      for (const workload of WORKLOADS) {
        await yieldToEventLoop();
        results.push(workload(context));
        onProgress?.(results);
      }
    } finally {
      scene.destroy();
      baseline.destroy();
    }

    return {
      entityCount,
      iterations: context.iterations,
      backend: this.backend,
      workloads: results,
    };
  }
}
