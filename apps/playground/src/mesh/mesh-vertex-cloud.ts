import type { PointCloud, PointLayer } from '../cloud/point-cloud.types.ts'
import { surfaceParticleSize, volumeParticleSize } from '../cloud/particle-size.ts'
import type { Rgb } from '../vector/svg-color.ts'
import type { ObjMesh } from './mesh.types.ts'
import { groupColor, shade } from './mesh-shading.ts'
import { faceNormal, meshSurfaceArea } from './mesh-surface-sampler.ts'

const LOOSE_POINTS_GROUP = 'points'

/**
 * The mesh's own vertices as particles, 1:1 (or `count` of them, repeating
 * or striding evenly through the vertex list). Vertices are ordered by the
 * first group that uses them, so groups stay contiguous layers; unused
 * vertices (point-cloud OBJs) form a trailing `points` layer. Shading uses
 * the area-weighted average of adjacent face normals.
 */
export function meshVertexCloud(mesh: ObjMesh, count = mesh.positions.length / 3): PointCloud {
  const vertexCount = mesh.positions.length / 3
  const order = vertexOrder(mesh)
  const normals = vertexNormals(mesh)
  const area = meshSurfaceArea(mesh)
  const size = area > 0 ? surfaceParticleSize(area, count) : volumeParticleSize(halfExtent(mesh), count)

  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3).fill(size)
  const layers: PointLayer[] = []
  const scratch: Rgb = [0, 0, 0]

  for (let i = 0; i < count; i++) {
    const { vertex, groupIndex } = order[Math.floor((i * vertexCount) / count)]!
    positions.set(mesh.positions.subarray(vertex * 3, vertex * 3 + 3), i * 3)
    if (mesh.vertexColors) colors.set(mesh.vertexColors.subarray(vertex * 3, vertex * 3 + 3), i * 3)
    else colors.set(shade(groupColor(groupIndex), normals[vertex * 3]!, normals[vertex * 3 + 1]!, normals[vertex * 3 + 2]! || 1, scratch), i * 3)

    const name = mesh.groups[groupIndex]?.name ?? LOOSE_POINTS_GROUP
    const last = layers[layers.length - 1]
    if (last?.name === name) last.end = i + 1
    else layers.push({ name, start: i, end: i + 1, color: groupColor(groupIndex) })
  }
  return { count, positions, scales, colors, layers }
}

/** Each vertex once, ordered by the first group whose triangles reference it. */
function vertexOrder(mesh: ObjMesh): { vertex: number; groupIndex: number }[] {
  const vertexCount = mesh.positions.length / 3
  const groupOf = new Int32Array(vertexCount).fill(-1)
  mesh.groups.forEach((group, groupIndex) => {
    for (let corner = group.start * 3; corner < group.end * 3; corner++) {
      const vertex = mesh.triangles[corner]!
      if (groupOf[vertex] === -1) groupOf[vertex] = groupIndex
    }
  })
  const order = Array.from({ length: vertexCount }, (_, vertex) => ({
    vertex,
    groupIndex: groupOf[vertex]! >= 0 ? groupOf[vertex]! : mesh.groups.length,
  }))
  return order.sort((a, b) => a.groupIndex - b.groupIndex || a.vertex - b.vertex)
}

function vertexNormals(mesh: ObjMesh): Float32Array {
  const normals = new Float32Array(mesh.positions.length)
  for (let t = 0; t < mesh.triangles.length / 3; t++) {
    const n = faceNormal(mesh, t)
    for (let corner = 0; corner < 3; corner++) {
      const vertex = mesh.triangles[t * 3 + corner]!
      for (let axis = 0; axis < 3; axis++) normals[vertex * 3 + axis]! += n[axis]!
    }
  }
  return normals
}

function halfExtent(mesh: ObjMesh): number {
  let extent = 0
  for (let axis = 0; axis < 3; axis++) {
    let min = Infinity, max = -Infinity
    for (let i = axis; i < mesh.positions.length; i += 3) {
      min = Math.min(min, mesh.positions[i]!)
      max = Math.max(max, mesh.positions[i]!)
    }
    if (max > min) extent = Math.max(extent, (max - min) / 2)
  }
  return extent || 1
}
