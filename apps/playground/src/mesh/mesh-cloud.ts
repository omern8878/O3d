import type { ParticleRequest, PointCloud } from '../cloud/point-cloud.types.ts'
import type { ObjMesh } from './mesh.types.ts'
import { meshSurfaceArea, sampleMeshSurface } from './mesh-surface-sampler.ts'
import { meshVertexCloud } from './mesh-vertex-cloud.ts'

/** Meshes with at least this many vertices render their vertices 1:1 in auto mode. */
export const AUTO_NATIVE_VERTEX_THRESHOLD = 50_000
/** Auto mode samples smaller meshes at this many points per triangle... */
const AUTO_POINTS_PER_TRIANGLE = 4
/** ...within these bounds, so tiny meshes still look solid. */
const AUTO_MIN_POINTS = 50_000
const AUTO_MAX_SAMPLED_POINTS = 300_000

export type MeshCloudMode = 'native-vertices' | 'surface-sampled'

/**
 * Picks how to turn a mesh into particles.
 *
 * `'auto'`: dense meshes (>= 50,000 vertices) show their native vertices
 * 1:1, however many that is; lighter meshes are surface-sampled in
 * proportion to their complexity (4 points per triangle, 50k-300k). A fixed
 * count always gives exactly that many points: surface-sampled when the
 * mesh has area, otherwise strided over the vertices (point-cloud OBJs).
 */
export function chooseMeshCloud(mesh: ObjMesh, request: ParticleRequest): { mode: MeshCloudMode; count: number } {
  const vertexCount = mesh.positions.length / 3
  const triangleCount = mesh.triangles.length / 3
  const hasArea = triangleCount > 0 && meshSurfaceArea(mesh) > 0
  if (request === 'auto') {
    if (!hasArea || vertexCount >= AUTO_NATIVE_VERTEX_THRESHOLD) return { mode: 'native-vertices', count: vertexCount }
    const count = Math.min(AUTO_MAX_SAMPLED_POINTS, Math.max(AUTO_MIN_POINTS, triangleCount * AUTO_POINTS_PER_TRIANGLE))
    return { mode: 'surface-sampled', count }
  }
  const count = Math.max(1, Math.floor(request))
  return { mode: hasArea ? 'surface-sampled' : 'native-vertices', count }
}

/**
 * Converts a mesh to particles per {@link chooseMeshCloud}.
 *
 * @throws {Error} if the mesh has no vertices at all.
 */
export function meshToCloud(mesh: ObjMesh, request: ParticleRequest, seed?: number): PointCloud {
  if (mesh.positions.length === 0) throw new Error('The OBJ file contains no vertices.')
  const { mode, count } = chooseMeshCloud(mesh, request)
  return mode === 'surface-sampled' ? sampleMeshSurface(mesh, count, seed) : meshVertexCloud(mesh, count)
}
