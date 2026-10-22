export type Vec3 = [number, number, number]

/** A perspective camera every engine reproduces exactly (WebGPU `[0, 1]` depth). */
export type BenchCamera = {
  eye: Vec3
  target: Vec3
  /** Vertical field of view in radians. */
  fovY: number
  aspect: number
  near: number
  far: number
}

/** What one frame cost on the GPU side, as the engine itself accounts it. */
export type FrameTelemetry = {
  /** Instance-data bytes the engine sent to the GPU this frame. */
  instanceBytes: number
  /** Instances submitted to the draw call. */
  drawnInstances: number
}

/** The scene every engine loads: identical, deterministic data. */
export type SceneDataset = {
  count: number
  /** `x, y, z` per entity. */
  positions: Float32Array
  /** `sx, sy, sz` per entity. */
  scales: Float32Array
  /** `r, g, b` per entity, each in `0..1`. */
  colors: Float32Array
  /** Entities `[0, catCount)` are the cat; the rest are the starfield. */
  catCount: number
  /** Contiguous entity keys animated by the partial-mutation workload (the tail). */
  tailSlice: { start: number; count: number }
  /** World position the deep-zoom camera aims at (the cat's left eye). */
  zoomFocus: Vec3
  /** Seed every engine uses to choose which entities churn removes. */
  churnSeed: number
  /** Writes the data of entity `key` spawned by churn (keys `>= count`). */
  spawnEntity(key: number, position: Vec3, scale: Vec3, color: Vec3): void
}

export type CompetitorId = 'o3d' | 'o3d-no-culling' | 'three-ranges' | 'three-naive' | 'js-aos'

/**
 * The lifecycle every engine under test implements, so all of them run the
 * exact same workloads. Entities are addressed by their dataset key
 * (`0 .. count - 1`, then spawn keys), never by engine-internal IDs.
 *
 * `renderPartialMutationFrame` and `renderChurnFrame` render with the camera
 * of the last `renderStaticFrame` / `renderZoomedFrame` call.
 */
export interface IBenchmarkCompetitor {
  readonly id: CompetitorId
  readonly label: string
  /** Bytes of per-instance GPU data each entity occupies. */
  readonly instanceBytesPerEntity: number
  setup(count: number, data: SceneDataset): Promise<void>
  renderStaticFrame(camera: BenchCamera): FrameTelemetry
  renderPartialMutationFrame(sliceStart: number, sliceCount: number, time: number): FrameTelemetry
  renderChurnFrame(removeCount: number, spawnCount: number): FrameTelemetry
  renderZoomedFrame(tightCamera: BenchCamera): FrameTelemetry
  /** The dataset key of the nearest entity under the NDC point, or `null`. */
  pickAtNdc(ndcX: number, ndcY: number): number | null
  /** The device to await for GPU-inclusive timing; `null` when headless. */
  gpuDevice(): GPUDevice | null
  dispose(): void
}
