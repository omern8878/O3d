import type { PointCloud, PointLayer } from '../cloud/point-cloud.types.ts'
import { surfaceParticleSize } from '../cloud/particle-size.ts'
import { allocateByWeight } from '../vector/point-budget.ts'
import { createSeededRandom } from '../vector/seeded-random.ts'
import type { Rgb } from '../vector/svg-color.ts'
import type { ObjMesh } from './mesh.types.ts'
import { groupColor, shade } from './mesh-shading.ts'

/** Total surface area of the mesh's triangles. */
export function meshSurfaceArea(mesh: ObjMesh): number {
  let area = 0
  for (let t = 0; t < mesh.triangles.length / 3; t++) area += triangleArea(mesh, t)
  return area
}

/**
 * Samples exactly `count` points uniformly over the mesh surface: groups get
 * points in proportion to their area, triangles are chosen by area
 * (cumulative-area binary search) and points placed with uniform
 * barycentric coordinates. Colours come from vertex colours when present,
 * otherwise from a per-group palette with Lambert shading, so the result
 * reads as a solid. Each group becomes one contiguous layer.
 *
 * @throws {Error} if the mesh has no surface area to sample.
 */
export function sampleMeshSurface(mesh: ObjMesh, count: number, seed = 11): PointCloud {
  const areas = new Float64Array(mesh.triangles.length / 3)
  for (let t = 0; t < areas.length; t++) areas[t] = triangleArea(mesh, t)
  const groupAreas = mesh.groups.map((g) => sumRange(areas, g.start, g.end))
  const totalArea = groupAreas.reduce((sum, a) => sum + a, 0)
  if (!(totalArea > 0)) throw new Error('The mesh has no surface area to sample.')

  const random = createSeededRandom(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3).fill(surfaceParticleSize(totalArea, count))
  const layers: PointLayer[] = []
  const color: Rgb = [0, 0, 0]
  const counts = allocateByWeight(count, groupAreas)
  let written = 0

  mesh.groups.forEach((group, groupIndex) => {
    const wanted = counts[groupIndex]!
    if (wanted === 0) return
    const cumulative = cumulativeAreas(areas, group.start, group.end)
    const groupTotal = cumulative[cumulative.length - 1]!
    const start = written
    for (let i = 0; i < wanted; i++, written++) {
      const triangle = group.start + upperBound(cumulative, random() * groupTotal)
      const r1 = Math.sqrt(random())
      const r2 = random()
      const weights: Rgb = [1 - r1, r1 * (1 - r2), r1 * r2]
      writePoint(mesh, triangle, weights, groupIndex, positions, colors, written, color)
    }
    layers.push({ name: group.name, start, end: written, color: groupColor(groupIndex) })
  })

  return { count, positions, scales, colors, layers }
}

function writePoint(
  mesh: ObjMesh, triangle: number, weights: Rgb, groupIndex: number,
  positions: Float32Array, colors: Float32Array, index: number, scratch: Rgb,
): void {
  const { positions: p, triangles, vertexColors, cornerNormals } = mesh
  const corners = [triangles[triangle * 3]!, triangles[triangle * 3 + 1]!, triangles[triangle * 3 + 2]!]
  for (let axis = 0; axis < 3; axis++) {
    positions[index * 3 + axis] =
      weights[0] * p[corners[0]! * 3 + axis]! + weights[1] * p[corners[1]! * 3 + axis]! + weights[2] * p[corners[2]! * 3 + axis]!
  }
  if (vertexColors) {
    for (let c = 0; c < 3; c++) {
      colors[index * 3 + c] = weights[0] * vertexColors[corners[0]! * 3 + c]! +
        weights[1] * vertexColors[corners[1]! * 3 + c]! + weights[2] * vertexColors[corners[2]! * 3 + c]!
    }
    return
  }
  const [nx, ny, nz] = cornerNormals
    ? [0, 1, 2].map((axis) => weights[0] * cornerNormals[triangle * 9 + axis]! +
      weights[1] * cornerNormals[triangle * 9 + 3 + axis]! + weights[2] * cornerNormals[triangle * 9 + 6 + axis]!)
    : faceNormal(mesh, triangle)
  shade(groupColor(groupIndex), nx!, ny!, nz!, scratch)
  colors.set(scratch, index * 3)
}

/** Unnormalized face normal (its length is twice the area). */
export function faceNormal(mesh: ObjMesh, triangle: number): [number, number, number] {
  const { positions: p, triangles } = mesh
  const a = triangles[triangle * 3]! * 3, b = triangles[triangle * 3 + 1]! * 3, c = triangles[triangle * 3 + 2]! * 3
  const ux = p[b]! - p[a]!, uy = p[b + 1]! - p[a + 1]!, uz = p[b + 2]! - p[a + 2]!
  const vx = p[c]! - p[a]!, vy = p[c + 1]! - p[a + 1]!, vz = p[c + 2]! - p[a + 2]!
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
}

function triangleArea(mesh: ObjMesh, triangle: number): number {
  const area = 0.5 * Math.hypot(...faceNormal(mesh, triangle))
  return Number.isFinite(area) ? area : 0
}

function sumRange(values: Float64Array, start: number, end: number): number {
  let sum = 0
  for (let i = start; i < end; i++) sum += values[i]!
  return sum
}

function cumulativeAreas(areas: Float64Array, start: number, end: number): Float64Array {
  const cumulative = new Float64Array(end - start)
  let sum = 0
  for (let i = start; i < end; i++) cumulative[i - start] = sum += areas[i]!
  return cumulative
}

/** First index whose cumulative value exceeds `target` (zero-area triangles are never chosen). */
function upperBound(cumulative: Float64Array, target: number): number {
  let low = 0, high = cumulative.length - 1
  while (low < high) {
    const mid = (low + high) >>> 1
    if (cumulative[mid]! > target) high = mid
    else low = mid + 1
  }
  return low
}
