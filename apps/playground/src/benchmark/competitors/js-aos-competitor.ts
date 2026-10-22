import type { GpuContext } from '@engine/templates'
import type {
  BenchCamera, FrameTelemetry, IBenchmarkCompetitor, SceneDataset, Vec3,
} from '../competitor.types.ts'
import { tailWaveOffset } from '../dataset/benchmark-cameras.ts'
import { LiveKeyPool } from '../dataset/live-key-pool.ts'
import { invert, transformPoint, viewProjection, normalize, sub, type Mat4 } from '../math/camera-math.ts'
import { FLOATS_PER_NODE, JsAosRenderer } from './js-aos-renderer.ts'

/** A scene node the idiomatic JS way: one heap object per entity. */
type SceneNode = {
  id: number
  position: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  color: { r: number; g: number; b: number }
  visible: boolean
}

const PICK_RADIUS_PER_SCALE = 0.5

/**
 * The idiomatic JavaScript scene graph: nodes are objects in a `Map` keyed
 * by ID (O(1) insert and delete), with no change tracking and no culling, so
 * every frame repacks all visible nodes and uploads the whole buffer.
 */
export class JsAosCompetitor implements IBenchmarkCompetitor {
  readonly id = 'js-aos' as const
  readonly label = 'JS scene graph (AoS objects)'
  readonly instanceBytesPerEntity = FLOATS_PER_NODE * 4

  private readonly gpuContext: GpuContext
  private readonly hasGpu: boolean
  private renderer: JsAosRenderer | null = null
  private readonly nodes = new Map<number, SceneNode>()
  private packed = new Float32Array(0)
  private data!: SceneDataset
  private pool!: LiveKeyPool
  private viewProj: Mat4 = new Float64Array(16)
  private readonly spawnPosition: Vec3 = [0, 0, 0]
  private readonly spawnScale: Vec3 = [0, 0, 0]
  private readonly spawnColor: Vec3 = [0, 0, 0]

  constructor(gpuContext: GpuContext, hasGpu: boolean) {
    this.gpuContext = gpuContext
    this.hasGpu = hasGpu
  }

  async setup(count: number, data: SceneDataset): Promise<void> {
    this.data = data
    this.pool = new LiveKeyPool(count, data.churnSeed)
    this.nodes.clear()
    const { positions: p, scales: s, colors: c } = data
    for (let key = 0; key < count; key++) {
      const o = key * 3
      this.nodes.set(key, {
        id: key,
        position: { x: p[o]!, y: p[o + 1]!, z: p[o + 2]! },
        scale: { x: s[o]!, y: s[o + 1]!, z: s[o + 2]! },
        color: { r: c[o]!, g: c[o + 1]!, b: c[o + 2]! },
        visible: true,
      })
    }
    this.packed = new Float32Array(count * FLOATS_PER_NODE)
    this.renderer = new JsAosRenderer(this.gpuContext, count)
  }

  renderStaticFrame(camera: BenchCamera): FrameTelemetry {
    this.setCamera(camera)
    return this.render()
  }

  renderPartialMutationFrame(sliceStart: number, sliceCount: number, time: number): FrameTelemetry {
    const { positions } = this.data
    for (let key = sliceStart; key < sliceStart + sliceCount; key++) {
      this.nodes.get(key)!.position.y = positions[key * 3 + 1]! + tailWaveOffset(key, time)
    }
    return this.render()
  }

  renderChurnFrame(removeCount: number, spawnCount: number): FrameTelemetry {
    for (let i = 0; i < removeCount; i++) this.nodes.delete(this.pool.takeRandom())
    for (let i = 0; i < spawnCount; i++) {
      const key = this.pool.spawnKey()
      const [p, s, c] = [this.spawnPosition, this.spawnScale, this.spawnColor]
      this.data.spawnEntity(key, p, s, c)
      this.nodes.set(key, {
        id: key,
        position: { x: p[0], y: p[1], z: p[2] },
        scale: { x: s[0], y: s[1], z: s[2] },
        color: { r: c[0], g: c[1], b: c[2] },
        visible: true,
      })
    }
    return this.render()
  }

  renderZoomedFrame(tightCamera: BenchCamera): FrameTelemetry {
    this.setCamera(tightCamera)
    return this.render()
  }

  /** Unprojects through the JS-inverted view-projection and ray-tests every node object. */
  pickAtNdc(ndcX: number, ndcY: number): number | null {
    const inverse = invert(this.viewProj)
    if (!inverse) return null
    const origin = transformPoint(inverse, ndcX, ndcY, 0)
    const direction = normalize(sub(transformPoint(inverse, ndcX, ndcY, 1), origin))
    let bestKey: number | null = null
    let bestDistance = Infinity
    for (const node of this.nodes.values()) {
      const radius = PICK_RADIUS_PER_SCALE * Math.max(Math.abs(node.scale.x), Math.abs(node.scale.y), Math.abs(node.scale.z))
      const ox = origin[0] - node.position.x
      const oy = origin[1] - node.position.y
      const oz = origin[2] - node.position.z
      const b = ox * direction[0] + oy * direction[1] + oz * direction[2]
      const disc = b * b - (ox * ox + oy * oy + oz * oz - radius * radius)
      if (disc < 0) continue
      const root = Math.sqrt(disc)
      const t = -b - root >= 0 ? -b - root : -b + root
      if (t >= 0 && t < bestDistance) {
        bestDistance = t
        bestKey = node.id
      }
    }
    return bestKey
  }

  gpuDevice(): GPUDevice | null {
    return this.hasGpu ? this.gpuContext.device : null
  }

  dispose(): void {
    this.renderer?.destroy()
    this.renderer = null
    this.nodes.clear()
  }

  private setCamera(camera: BenchCamera): void {
    this.viewProj = viewProjection(camera)
    this.renderer!.writeCamera(Float32Array.from(this.viewProj))
  }

  /** Repacks every visible node and uploads them all. */
  private render(): FrameTelemetry {
    if (this.packed.length < this.nodes.size * FLOATS_PER_NODE) {
      this.packed = new Float32Array(this.nodes.size * 2 * FLOATS_PER_NODE)
    }
    const packed = this.packed
    let offset = 0
    for (const node of this.nodes.values()) {
      if (!node.visible) continue
      packed[offset++] = node.position.x
      packed[offset++] = node.position.y
      packed[offset++] = node.position.z
      packed[offset++] = node.scale.x
      packed[offset++] = node.scale.y
      packed[offset++] = node.scale.z
      packed[offset++] = node.color.r
      packed[offset++] = node.color.g
      packed[offset++] = node.color.b
    }
    const drawn = offset / FLOATS_PER_NODE
    return { instanceBytes: this.renderer!.draw(packed, drawn), drawnInstances: drawn }
  }
}
