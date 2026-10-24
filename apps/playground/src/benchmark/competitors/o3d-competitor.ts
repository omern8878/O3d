import { SceneTemplate, type GpuContext } from '@engine/templates'
import type {
  BenchCamera, FrameTelemetry, IBenchmarkCompetitor, SceneDataset, Vec3,
} from '../competitor.types.ts'
import { tailWaveOffset } from '../dataset/benchmark-cameras.ts'
import { LiveKeyPool } from '../dataset/live-key-pool.ts'

/**
 * O3d through its public `SceneTemplate` API: Wasm SoA storage, sparse-set
 * swap-and-pop, dirty sub-slice uploads, Wasm picking, and (unless
 * `culling` is off) Wasm frustum culling. The no-culling variant isolates
 * the data path from the culling trade-off: culling costs an O(n) CPU pass
 * whenever the camera or entities change, and saves GPU work.
 */
export class O3dCompetitor implements IBenchmarkCompetitor {
  readonly id: 'o3d' | 'o3d-no-culling'
  readonly label: string
  /** position + scale + colour, three f32 each. */
  readonly instanceBytesPerEntity = 36

  private readonly gpuContext: GpuContext
  private readonly hasGpu: boolean
  private readonly culling: boolean
  private scene: SceneTemplate | null = null
  private data!: SceneDataset
  private pool!: LiveKeyPool
  private readonly idOfKey = new Map<number, number>()
  private keyOfId: number[] = []
  private readonly position: Vec3 = [0, 0, 0]
  private readonly scale: Vec3 = [0, 0, 0]
  private readonly color: Vec3 = [0, 0, 0]

  /** `hasGpu` says whether `gpuContext` is a real device (for GPU-inclusive timing). */
  constructor(gpuContext: GpuContext, hasGpu: boolean, culling = true) {
    this.gpuContext = gpuContext
    this.hasGpu = hasGpu
    this.culling = culling
    this.id = culling ? 'o3d' : 'o3d-no-culling'
    this.label = culling ? 'O3d (Rust/Wasm SoA + WebGPU)' : 'O3d, culling off'
  }

  async setup(count: number, data: SceneDataset): Promise<void> {
    this.data = data
    this.pool = new LiveKeyPool(count, data.churnSeed)
    this.scene = new SceneTemplate(this.gpuContext, {
      initialCapacity: count,
      cameraMode: 'perspective3d',
      shapeMode: 'circle',
      enableCulling: this.culling,
    })
    this.idOfKey.clear()
    this.keyOfId = []
    const { positions, scales, colors } = data
    for (let key = 0; key < count; key++) {
      const o = key * 3
      this.add(key,
        [positions[o]!, positions[o + 1]!, positions[o + 2]!],
        [scales[o]!, scales[o + 1]!, scales[o + 2]!],
        [colors[o]!, colors[o + 1]!, colors[o + 2]!])
    }
  }

  renderStaticFrame(camera: BenchCamera): FrameTelemetry {
    this.applyCamera(camera)
    return this.render()
  }

  renderPartialMutationFrame(sliceStart: number, sliceCount: number, time: number): FrameTelemetry {
    const scene = this.scene!
    const { positions } = this.data
    const position = this.position
    for (let key = sliceStart; key < sliceStart + sliceCount; key++) {
      const o = key * 3
      position[0] = positions[o]!
      position[1] = positions[o + 1]! + tailWaveOffset(key, time)
      position[2] = positions[o + 2]!
      scene.updateNodePosition(this.idOfKey.get(key)!, position)
    }
    return this.render()
  }

  /** Batched: one `removeNodes` and one `addNodes` per frame, two Wasm calls in all. */
  renderChurnFrame(removeCount: number, spawnCount: number): FrameTelemetry {
    const scene = this.scene!
    const removed = this.scratchIds(removeCount)
    for (let i = 0; i < removeCount; i++) {
      const key = this.pool.takeRandom()
      removed[i] = this.idOfKey.get(key)!
      this.idOfKey.delete(key)
    }
    scene.removeNodes(removed)

    const batch = this.spawnBatch(spawnCount)
    for (let i = 0; i < spawnCount; i++) {
      const key = this.pool.spawnKey()
      batch.keys[i] = key
      this.data.spawnEntity(key, this.position, this.scale, this.color)
      batch.positions.set(this.position, i * 3)
      batch.scales.set(this.scale, i * 3)
      batch.colors.set(this.color, i * 3)
    }
    const ids = scene.addNodes(batch)
    for (let i = 0; i < spawnCount; i++) {
      this.idOfKey.set(batch.keys[i]!, ids[i]!)
      this.keyOfId[ids[i]!] = batch.keys[i]!
    }
    return this.render()
  }

  renderZoomedFrame(tightCamera: BenchCamera): FrameTelemetry {
    this.applyCamera(tightCamera)
    return this.render()
  }

  pickAtNdc(ndcX: number, ndcY: number): number | null {
    const id = this.scene!.pickNodeByNdc(ndcX, ndcY)
    return id === null ? null : this.keyOfId[id] ?? null
  }

  gpuDevice(): GPUDevice | null {
    return this.hasGpu ? this.gpuContext.device : null
  }

  dispose(): void {
    this.scene?.destroy()
    this.scene = null
  }

  private removedIds = new Uint32Array(0)
  private batch = { keys: new Uint32Array(0), positions: new Float32Array(0), scales: new Float32Array(0), colors: new Float32Array(0) }

  /** Reused per-frame ID buffer, so churn allocates nothing per frame. */
  private scratchIds(count: number): Uint32Array {
    if (this.removedIds.length !== count) this.removedIds = new Uint32Array(count)
    return this.removedIds
  }

  /** Reused per-frame spawn arrays. */
  private spawnBatch(count: number) {
    if (this.batch.keys.length !== count) {
      this.batch = {
        keys: new Uint32Array(count),
        positions: new Float32Array(count * 3),
        scales: new Float32Array(count * 3),
        colors: new Float32Array(count * 3),
      }
    }
    return this.batch
  }

  private add(key: number, position: Vec3, scale: Vec3, color: Vec3): void {
    const id = this.scene!.addNode(position, scale, color)
    this.idOfKey.set(key, id)
    this.keyOfId[id] = key
  }

  private applyCamera({ eye, target, aspect }: BenchCamera): void {
    const camera = this.scene!.getCameraController()
    camera.resize(aspect, 1)
    camera.setTarget(target[0], target[1], target[2])
    camera.setPosition(eye[0], eye[1], eye[2])
  }

  private render(): FrameTelemetry {
    const scene = this.scene!
    scene.renderFrame()
    const stats = scene.getFrameStats()
    return { instanceBytes: stats.uploadedBytes, drawnInstances: stats.drawnCount }
  }
}
