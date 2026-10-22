import { SceneTemplate, type GpuContext, type SceneCameraMode, type ShapeMode } from '@engine/templates'
import type { PointLayer, SvgPointCloud } from '../vector/point-cloud.types.ts'

/**
 * A `SceneTemplate` filled from a sampled point cloud, remembering which node
 * came from which point so picks map back to SVG layers.
 */
export class ShowcaseScene {
  readonly scene: SceneTemplate
  readonly cloud: SvgPointCloud
  /** Node ID of every cloud point, by point index. */
  readonly ids: Uint32Array
  private readonly pointOfId: Map<number, number>

  constructor(gpuContext: GpuContext, cloud: SvgPointCloud, cameraMode: SceneCameraMode, shapeMode: ShapeMode) {
    this.cloud = cloud
    this.scene = new SceneTemplate(gpuContext, { initialCapacity: cloud.count, cameraMode, shapeMode })
    this.ids = new Uint32Array(cloud.count)
    this.pointOfId = new Map()
    const { positions, scales, colors } = cloud
    for (let i = 0; i < cloud.count; i++) {
      const o = i * 3
      const id = this.scene.addNode(
        [positions[o]!, positions[o + 1]!, positions[o + 2]!],
        [scales[o]!, scales[o + 1]!, scales[o + 2]!],
        [colors[o]!, colors[o + 1]!, colors[o + 2]!],
      )
      this.ids[i] = id
      this.pointOfId.set(id, i)
    }
  }

  /** The layer a picked node belongs to. */
  layerOf(id: number): PointLayer | null {
    const point = this.pointOfId.get(id)
    if (point === undefined) return null
    return this.cloud.layers.find((layer) => point >= layer.start && point < layer.end) ?? null
  }

  destroy(): void {
    this.scene.destroy()
  }
}
