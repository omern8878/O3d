/** Options for a `BenchmarkSuite` run. Every field is optional. */
export type BenchmarkOptions = {
  /** Entities in each scene. Default `100_000`. */
  entityCount?: number;
  /** Measured frames (or picks) per workload. Default `30`. */
  iterations?: number;
  /** Unmeasured frames run first so JIT and caches settle. Default `5`. */
  warmupIterations?: number;
  /** Share of entities in the contiguous animated slice (workload 2). Default `0.01`. */
  animatedFraction?: number;
  /** Share of entities the zoomed-in camera should keep visible (workload 3). Default `0.05`. */
  targetVisibleFraction?: number;
  /** Seed for the generated point cloud, for reproducible runs. Default `1`. */
  seed?: number;
};

/** One engine's numbers for a workload. */
export type EngineMetrics = {
  /** Median CPU time per frame (or per pick), in milliseconds. */
  readonly cpuMs: number;
  /** Instance bytes uploaded to the GPU per frame; `null` where nothing is drawn. */
  readonly bytesPerFrame: number | null;
  /** Instances drawn per frame; `null` where nothing is drawn. */
  readonly drawnInstances: number | null;
};

export type WorkloadId =
  | "static-orbit"
  | "localized-animation"
  | "zoomed-culling"
  | "raycast-picking";

/** O3d and the object-graph baseline measured on the same workload. */
export type WorkloadResult = {
  readonly id: WorkloadId;
  readonly title: string;
  /** What the workload does each iteration. */
  readonly description: string;
  readonly o3d: EngineMetrics;
  readonly baseline: EngineMetrics;
  /** Extra facts about the run, e.g. whether both pickers agreed. */
  readonly notes: readonly string[];
};

/** Everything a `BenchmarkSuite` run measured. */
export type BenchmarkReport = {
  readonly entityCount: number;
  readonly iterations: number;
  /** `'webgpu'` when uploads went to a real device, `'headless'` otherwise. */
  readonly backend: "webgpu" | "headless";
  readonly workloads: readonly WorkloadResult[];
};
