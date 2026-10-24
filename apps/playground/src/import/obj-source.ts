import { normalizeCloud } from '../cloud/normalize-cloud.ts'
import type { ParticleRequest, PointCloud } from '../cloud/point-cloud.types.ts'
import { chooseMeshCloud, meshToCloud } from '../mesh/mesh-cloud.ts'
import type { ObjMesh } from '../mesh/mesh.types.ts'
import { parseObj } from '../mesh/obj-parser.ts'
import type { BuiltScene, SceneSource, SliceAnimationSpec } from './scene-source.types.ts'

export type ObjSourceOptions = {
  id: string
  label: string
  builtIn: boolean
  /** Layer to animate in sub-slice mode; by default the smallest group spins. */
  slice?: SliceAnimationSpec
  /** Adds extra particles (in model space) before normalization, e.g. steam. */
  decorate?: (cloud: PointCloud, mesh: ObjMesh) => PointCloud
  labels?: Readonly<Record<string, string>>
}

/**
 * A Wavefront OBJ as a scene source: parsed once, turned into particles per
 * request (native vertices or area-weighted surface samples, see
 * `chooseMeshCloud`), and fitted into canonical `[-10, 10]` space.
 */
export function createObjSource(text: string, options: ObjSourceOptions): SceneSource {
  let mesh: ObjMesh | null = null
  return {
    id: options.id,
    label: options.label,
    dimension: '3d',
    builtIn: options.builtIn,
    async build(request: ParticleRequest): Promise<BuiltScene> {
      mesh ??= parseObj(text)
      const { mode } = chooseMeshCloud(mesh, request)
      let cloud = meshToCloud(mesh, request)
      if (options.decorate) cloud = options.decorate(cloud, mesh)
      normalizeCloud(cloud)
      const vertices = mesh.positions.length / 3
      const triangles = mesh.triangles.length / 3
      const skipped = mesh.skippedLines > 0 ? `, ${mesh.skippedLines} bad lines skipped` : ''
      return {
        cloud,
        slice: options.slice ?? smallestGroupSpin(cloud),
        labels: options.labels ?? {},
        detail: `${mode === 'native-vertices' ? 'native vertices' : 'surface-sampled'} from ` +
          `${vertices.toLocaleString('en-US')} vertices / ${triangles.toLocaleString('en-US')} triangles${skipped}`,
      }
    },
  }
}

/** With several groups, the smallest one spins; a single-group mesh has no sub-slice. */
function smallestGroupSpin(cloud: PointCloud): SliceAnimationSpec | null {
  if (cloud.layers.length < 2) return null
  const smallest = cloud.layers.reduce((a, b) => (b.end - b.start < a.end - a.start ? b : a))
  return { layer: smallest.name, kind: 'spin' }
}
