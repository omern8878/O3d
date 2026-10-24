import { SceneTemplate, type GpuContext, type SceneCameraMode, type ShapeMode } from '@engine/templates'
import type { PointCloud, PointLayer } from '../cloud/point-cloud.types.ts'
import type { BuiltScene } from '../import/scene-source.types.ts'
import type { ParticleSnapshot } from './animation/morph-transition.ts'

/**
 * A `SceneTemplate` filled from a built source in one bulk `addNodes`, so
 * view index `i` is cloud point `i`, and picked node IDs map back to layers.
 */
export class ShowcaseScene {
  readonly scene: SceneTemplate
  readonly built: BuiltScene
  private readonly ids: Uint32Array
  /** A fresh scene hands out consecutive IDs; then `id - firstId` is the point index. */
  private readonly firstId: number
  private readonly consecutive: boolean
  /** Radius of a sphere around the origin containing every particle (including its size). */
  readonly boundingRadius: number

  constructor(gpuContext: GpuContext, built: BuiltScene, cameraMode: SceneCameraMode, shapeMode: ShapeMode) {
    this.built = built
    const { cloud } = built
    this.scene = new SceneTemplate(gpuContext, { initialCapacity: cloud.count, cameraMode, shapeMode })
    this.ids = this.scene.addNodes({ positions: cloud.positions, scales: cloud.scales, colors: cloud.colors })
    this.firstId = this.ids[0] ?? 0
    this.consecutive = this.ids.length === 0 || this.ids[this.ids.length - 1]! - this.firstId === this.ids.length - 1
    this.boundingRadius = boundingRadius(cloud)
  }

  get cloud(): PointCloud {
    return this.built.cloud
  }

  /** The layer a picked node belongs to. */
  layerOf(id: number): PointLayer | null {
    const point = this.consecutive ? id - this.firstId : this.ids.indexOf(id)
    if (point < 0 || point >= this.ids.length) return null
    let low = 0, high = this.cloud.layers.length - 1
    while (low <= high) {
      const mid = (low + high) >>> 1
      const layer = this.cloud.layers[mid]!
      if (point < layer.start) high = mid - 1
      else if (point >= layer.end) low = mid + 1
      else return layer
    }
    return null
  }

  /** A copy of what is on screen now, for morphing to the next scene. */
  snapshot(): ParticleSnapshot {
    const views = this.scene.getNodeViews()
    return {
      count: this.scene.getActiveCount(),
      positions: views.positions.slice(),
      scales: views.scales.slice(),
      colors: views.colors.slice(),
    }
  }

  destroy(): void {
    this.scene.destroy()
  }
}

function boundingRadius({ positions, scales, count }: PointCloud): number {
  let radius = 0
  for (let i = 0; i < count * 3; i += 3) {
    const reach = Math.hypot(positions[i]!, positions[i + 1]!, positions[i + 2]!) + 0.5 * scales[i]!
    if (reach > radius) radius = reach
  }
  return radius || 1
}
