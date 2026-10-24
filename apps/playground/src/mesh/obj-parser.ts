import type { MeshGroup, ObjMesh } from './mesh.types.ts'

const DEFAULT_GROUP = 'mesh'

type FaceCorner = { vertex: number; normal: number | null }

/**
 * Parses Wavefront OBJ text into a triangle mesh.
 *
 * Supports `v` (with optional `r g b` vertex colours), `vn`, `vt`, faces in
 * every index form (`v`, `v/vt`, `v//vn`, `v/vt/vn`), negative (relative)
 * indices, polygons of any size (fan-triangulated), `o` / `g` / `usemtl`
 * sections and `\` line continuations. Anything malformed (bad numbers,
 * missing vertices) is skipped and counted, never thrown on.
 */
export function parseObj(text: string): ObjMesh {
  const positions: number[] = []
  const colors: number[] = []
  let everyVertexColored = true
  const normals: number[] = []
  const trianglesByGroup = new Map<string, { vertices: number[]; normals: number[] }>()
  let everyCornerHasNormal = true
  let group = DEFAULT_GROUP
  let skippedLines = 0

  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, '').trim()
    if (line === '') continue
    const [keyword, ...fields] = line.split(/\s+/)
    switch (keyword) {
      case 'v': {
        const values = fields.map(Number)
        if (values.length < 3 || !values.slice(0, 3).every(Number.isFinite)) {
          skippedLines++
          break
        }
        positions.push(values[0]!, values[1]!, values[2]!)
        const hasColor = values.length >= 6 && values.slice(3, 6).every(Number.isFinite)
        everyVertexColored &&= hasColor
        colors.push(...(hasColor ? normalizeColor(values.slice(3, 6)) : [1, 1, 1]))
        break
      }
      case 'vn': {
        const values = fields.slice(0, 3).map(Number)
        if (values.length === 3 && values.every(Number.isFinite)) normals.push(...values)
        else {
          skippedLines++
          normals.push(0, 0, 0)
        }
        break
      }
      case 'f': {
        const corners = parseFace(fields, positions.length / 3, normals.length / 3)
        if (!corners) {
          skippedLines++
          break
        }
        const bucket = trianglesByGroup.get(group) ?? { vertices: [], normals: [] }
        trianglesByGroup.set(group, bucket)
        for (let i = 1; i < corners.length - 1; i++) {
          for (const corner of [corners[0]!, corners[i]!, corners[i + 1]!]) {
            bucket.vertices.push(corner.vertex)
            if (corner.normal === null) everyCornerHasNormal = false
            bucket.normals.push(corner.normal ?? 0)
          }
        }
        break
      }
      case 'o':
      case 'g':
      case 'usemtl':
        group = fields.join(' ') || DEFAULT_GROUP
        break
      default:
        // vt, s, mtllib, l, p, curves...: not needed for point sampling.
        break
    }
  }

  // Concatenate per group so every group is one contiguous triangle range.
  // Typed-array `set` (not `push(...)`) keeps multi-million-triangle files
  // from overflowing the call stack.
  const cornerCount = [...trianglesByGroup.values()].reduce((sum, b) => sum + b.vertices.length, 0)
  const triangles = new Uint32Array(cornerCount)
  const normalIndices = new Uint32Array(cornerCount)
  const groups: MeshGroup[] = []
  let offset = 0
  for (const [name, bucket] of trianglesByGroup) {
    triangles.set(bucket.vertices, offset)
    normalIndices.set(bucket.normals, offset)
    groups.push({ name, start: offset / 3, end: (offset + bucket.vertices.length) / 3 })
    offset += bucket.vertices.length
  }

  const hasNormals = everyCornerHasNormal && cornerCount > 0 && normals.length > 0
  return {
    positions: Float32Array.from(positions),
    vertexColors: everyVertexColored && positions.length > 0 ? Float32Array.from(colors) : null,
    triangles,
    cornerNormals: hasNormals ? gatherNormals(normals, normalIndices) : null,
    groups,
    skippedLines,
  }
}

/** Resolves one face's corners, or `null` if it is not a valid polygon. */
function parseFace(fields: string[], vertexCount: number, normalCount: number): FaceCorner[] | null {
  if (fields.length < 3) return null
  const corners: FaceCorner[] = []
  for (const field of fields) {
    const [v, , vn] = field.split('/')
    const vertex = resolveIndex(v, vertexCount)
    if (vertex === null) return null
    const normal = vn ? resolveIndex(vn, normalCount) : null
    corners.push({ vertex, normal })
  }
  return corners
}

/** OBJ indices are 1-based; negative ones count back from the latest element. */
function resolveIndex(text: string | undefined, count: number): number | null {
  const index = Number(text)
  if (!Number.isInteger(index) || index === 0) return null
  const resolved = index > 0 ? index - 1 : count + index
  return resolved >= 0 && resolved < count ? resolved : null
}

function gatherNormals(normals: number[], indices: Uint32Array): Float32Array {
  const out = new Float32Array(indices.length * 3)
  for (let corner = 0; corner < indices.length; corner++) {
    const from = indices[corner]! * 3
    out[corner * 3] = normals[from]!
    out[corner * 3 + 1] = normals[from + 1]!
    out[corner * 3 + 2] = normals[from + 2]!
  }
  return out
}

/** Vertex colours are usually `0..1`, but some exporters write `0..255`. */
function normalizeColor(rgb: number[]): number[] {
  const divisor = rgb.some((c) => c > 1) ? 255 : 1
  return rgb.map((c) => Math.min(1, Math.max(0, c / divisor)))
}
