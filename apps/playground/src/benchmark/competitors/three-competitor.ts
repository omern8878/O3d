import type * as Three from 'three'
import type {
  BenchCamera, FrameTelemetry, IBenchmarkCompetitor, SceneDataset, Vec3,
} from '../competitor.types.ts'
import { tailWaveOffset } from '../dataset/benchmark-cameras.ts'
import { LiveKeyPool } from '../dataset/live-key-pool.ts'

type WebGpuRenderer = { init(): Promise<unknown>; render(scene: Three.Scene, camera: Three.Camera): void; dispose(): void }

const FLOATS_PER_MATRIX = 16
const FLOATS_PER_COLOR = 3
const CANVAS_SIZE = { width: 640, height: 360 }

export type ThreeCompetitorOptions = {
  /**
   * `true`: the tuned path, flagging only the touched matrices with
   * `addUpdateRange` (Three's WebGPU backend then uploads just that range).
   * `false`: the idiomatic path, `needsUpdate = true`, which re-uploads the
   * whole attribute.
   */
  useUpdateRanges: boolean
  /** Shared WebGPU device, or `null` for a headless (CPU-only) run. */
  device: GPUDevice | null
}

/**
 * Three.js r186 with its fastest instancing path: one `InstancedMesh` (a
 * 1x1 plane) with per-instance `Matrix4`s and an `instanceColor` attribute,
 * drawn by `WebGPURenderer` on the shared device and picked with
 * `Raycaster.intersectObject`.
 */
export class ThreeCompetitor implements IBenchmarkCompetitor {
  readonly id: 'three-ranges' | 'three-naive'
  readonly label: string
  /** A 4x4 f32 matrix plus an RGB f32 colour. */
  readonly instanceBytesPerEntity = (FLOATS_PER_MATRIX + FLOATS_PER_COLOR) * 4

  private readonly options: ThreeCompetitorOptions
  private renderer: WebGpuRenderer | null = null
  private scene!: Three.Scene
  private camera!: Three.PerspectiveCamera
  private mesh!: Three.InstancedMesh
  private raycaster!: Three.Raycaster
  private data!: SceneDataset
  private pool!: LiveKeyPool
  private readonly slotOfKey = new Map<number, number>()
  private keyOfSlot: number[] = []
  private uploadedVersions = new Map<Three.BufferAttribute, number>()
  private matrix!: Three.Matrix4
  private position!: Three.Vector3
  private scale!: Three.Vector3
  private rotation!: Three.Quaternion
  private colorValue!: Three.Color
  private ndc!: Three.Vector2
  private readonly spawnPosition: Vec3 = [0, 0, 0]
  private readonly spawnScale: Vec3 = [0, 0, 0]
  private readonly spawnColor: Vec3 = [0, 0, 0]

  constructor(options: ThreeCompetitorOptions) {
    this.options = options
    this.id = options.useUpdateRanges ? 'three-ranges' : 'three-naive'
    this.label = options.useUpdateRanges
      ? 'Three.js InstancedMesh (+ addUpdateRange)'
      : 'Three.js InstancedMesh (needsUpdate)'
  }

  async setup(count: number, data: SceneDataset): Promise<void> {
    // `three/webgpu` re-exports every core class; importing `three` as well
    // would also pull in the unused WebGL renderer.
    const THREE = await import('three/webgpu')
    this.data = data
    this.pool = new LiveKeyPool(count, data.churnSeed)
    this.matrix = new THREE.Matrix4()
    this.position = new THREE.Vector3()
    this.scale = new THREE.Vector3()
    this.rotation = new THREE.Quaternion()
    this.colorValue = new THREE.Color()
    this.ndc = new THREE.Vector2()
    this.raycaster = new THREE.Raycaster()
    this.camera = new THREE.PerspectiveCamera()
    this.scene = new THREE.Scene()

    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), material, count)
    // Keep the default StaticDrawUsage: Three's WebGPU backend re-uploads a
    // DynamicDrawUsage attribute on every frame, changed or not.
    this.slotOfKey.clear()
    this.keyOfSlot = []
    const { positions, scales, colors } = data
    for (let key = 0; key < count; key++) {
      const o = key * 3
      this.writeInstance(key,
        [positions[o]!, positions[o + 1]!, positions[o + 2]!],
        [scales[o]!, scales[o + 1]!, scales[o + 2]!],
        [colors[o]!, colors[o + 1]!, colors[o + 2]!])
      this.slotOfKey.set(key, key)
      this.keyOfSlot[key] = key
    }
    this.scene.add(this.mesh)
    this.uploadedVersions = new Map()

    if (this.options.device) {
      const { WebGPURenderer } = THREE
      const canvas = Object.assign(document.createElement('canvas'), CANVAS_SIZE)
      const renderer = new WebGPURenderer({ canvas, device: this.options.device, antialias: false } as never) as unknown as WebGpuRenderer
      await renderer.init()
      this.renderer = renderer
    }
  }

  renderStaticFrame(camera: BenchCamera): FrameTelemetry {
    this.setCamera(camera)
    return this.render()
  }

  renderPartialMutationFrame(sliceStart: number, sliceCount: number, time: number): FrameTelemetry {
    const { positions, scales } = this.data
    for (let key = sliceStart; key < sliceStart + sliceCount; key++) {
      const o = key * 3
      this.position.set(positions[o]!, positions[o + 1]! + tailWaveOffset(key, time), positions[o + 2]!)
      this.scale.set(scales[o]!, scales[o + 1]!, scales[o + 2]!)
      this.matrix.compose(this.position, this.rotation, this.scale)
      this.mesh.setMatrixAt(this.slotOfKey.get(key)!, this.matrix)
    }
    const matrices = this.mesh.instanceMatrix
    if (this.options.useUpdateRanges) {
      // The slice occupies contiguous slots, so one range covers it.
      const first = this.slotOfKey.get(sliceStart)!
      matrices.addUpdateRange(first * FLOATS_PER_MATRIX, sliceCount * FLOATS_PER_MATRIX)
    }
    matrices.needsUpdate = true
    return this.render()
  }

  renderChurnFrame(removeCount: number, spawnCount: number): FrameTelemetry {
    const mesh = this.mesh
    for (let i = 0; i < removeCount; i++) {
      const key = this.pool.takeRandom()
      const slot = this.slotOfKey.get(key)!
      const last = mesh.count - 1
      if (slot !== last) {
        // Swap-and-pop: move the last instance into the freed slot.
        mesh.getMatrixAt(last, this.matrix)
        mesh.setMatrixAt(slot, this.matrix)
        mesh.getColorAt(last, this.colorValue)
        mesh.setColorAt(slot, this.colorValue)
        const movedKey = this.keyOfSlot[last]!
        this.keyOfSlot[slot] = movedKey
        this.slotOfKey.set(movedKey, slot)
      }
      this.slotOfKey.delete(key)
      mesh.count = last
    }
    for (let i = 0; i < spawnCount; i++) {
      const key = this.pool.spawnKey()
      this.data.spawnEntity(key, this.spawnPosition, this.spawnScale, this.spawnColor)
      const slot = mesh.count++
      this.writeInstance(slot, this.spawnPosition, this.spawnScale, this.spawnColor)
      this.slotOfKey.set(key, slot)
      this.keyOfSlot[slot] = key
    }
    // Scattered slots: both variants re-upload the whole attributes.
    mesh.instanceMatrix.needsUpdate = true
    mesh.instanceColor!.needsUpdate = true
    return this.render()
  }

  renderZoomedFrame(tightCamera: BenchCamera): FrameTelemetry {
    this.setCamera(tightCamera)
    return this.render()
  }

  pickAtNdc(ndcX: number, ndcY: number): number | null {
    this.ndc.set(ndcX, ndcY)
    this.raycaster.setFromCamera(this.ndc, this.camera)
    const [hit] = this.raycaster.intersectObject(this.mesh, false)
    return hit?.instanceId === undefined ? null : this.keyOfSlot[hit.instanceId] ?? null
  }

  gpuDevice(): GPUDevice | null {
    return this.renderer ? this.options.device : null
  }

  dispose(): void {
    this.mesh?.geometry.dispose()
    ;(this.mesh?.material as Three.Material | undefined)?.dispose()
    this.mesh?.dispose()
    this.renderer?.dispose()
    this.renderer = null
  }

  private writeInstance(slot: number, position: Vec3, scale: Vec3, color: Vec3): void {
    this.position.set(position[0], position[1], position[2])
    this.scale.set(scale[0], scale[1], scale[2])
    this.matrix.compose(this.position, this.rotation, this.scale)
    this.mesh.setMatrixAt(slot, this.matrix)
    this.mesh.setColorAt(slot, this.colorValue.setRGB(color[0], color[1], color[2]))
  }

  private setCamera({ eye, target, fovY, aspect, near, far }: BenchCamera): void {
    const camera = this.camera
    camera.fov = (fovY * 180) / Math.PI
    camera.aspect = aspect
    camera.near = near
    camera.far = far
    camera.updateProjectionMatrix()
    camera.position.set(eye[0], eye[1], eye[2])
    camera.lookAt(target[0], target[1], target[2])
    camera.updateMatrixWorld()
  }

  /**
   * Draws all `mesh.count` instances (Three culls the mesh as a whole, never
   * per instance) and returns the instance bytes Three uploads: changed
   * attributes in full, or just their update ranges.
   */
  private render(): FrameTelemetry {
    const instanceBytes = this.pendingAttributeBytes(this.mesh.instanceMatrix) +
      this.pendingAttributeBytes(this.mesh.instanceColor!)
    if (this.renderer) this.renderer.render(this.scene, this.camera)
    else {
      this.mesh.instanceMatrix.clearUpdateRanges()
      this.mesh.instanceColor!.clearUpdateRanges()
    }
    return { instanceBytes, drawnInstances: this.mesh.count }
  }

  /** Mirrors Three's WebGPU attribute upload rule for one attribute. */
  private pendingAttributeBytes(attribute: Three.BufferAttribute): number {
    if (this.uploadedVersions.get(attribute) === attribute.version) return 0
    this.uploadedVersions.set(attribute, attribute.version)
    const ranges = attribute.updateRanges
    if (ranges.length === 0) return attribute.array.byteLength
    return ranges.reduce((sum, range) => sum + range.count, 0) * attribute.array.BYTES_PER_ELEMENT
  }
}
