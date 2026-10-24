type Vec3 = [number, number, number]

/**
 * Writes Wavefront OBJ text for procedural models (lathes and tubes), so
 * built-in presets go through exactly the same importer as dropped files.
 */
export class ObjBuilder {
  private readonly lines: string[] = []
  private vertexCount = 0

  group(name: string): this {
    this.lines.push(`g ${name}`)
    return this
  }

  /** Adds a vertex and returns its 1-based OBJ index. */
  vertex([x, y, z]: Vec3): number {
    this.lines.push(`v ${x.toFixed(5)} ${y.toFixed(5)} ${z.toFixed(5)}`)
    return ++this.vertexCount
  }

  face(...indices: number[]): this {
    this.lines.push(`f ${indices.join(' ')}`)
    return this
  }

  /**
   * A surface of revolution around +Y: `profile` lists `[radius, y]` from
   * bottom to top, swept through `segments` steps.
   */
  lathe(profile: readonly [number, number][], segments: number): this {
    const rings = profile.map(([radius, y]) =>
      Array.from({ length: segments }, (_, s) => {
        const angle = (s / segments) * Math.PI * 2
        return this.vertex([Math.cos(angle) * radius, y, Math.sin(angle) * radius])
      }))
    this.stitchRings(rings, true)
    return this
  }

  /**
   * A tube along `path` with radius `radiusAt(t)` (`t` in `0..1`), using
   * parallel-transported frames so it does not twist or pinch.
   */
  tube(path: readonly Vec3[], radiusAt: (t: number) => number, segments: number): this {
    let normal = perpendicular(tangentAt(path, 0))
    const rings = path.map((point, i) => {
      const tangent = tangentAt(path, i)
      normal = normalize(sub(normal, scale(tangent, dot(normal, tangent))))
      const binormal = cross(tangent, normal)
      const radius = radiusAt(i / (path.length - 1))
      return Array.from({ length: segments }, (_, s) => {
        const angle = (s / segments) * Math.PI * 2
        const offset = add(scale(normal, Math.cos(angle) * radius), scale(binormal, Math.sin(angle) * radius))
        return this.vertex(add(point, offset))
      })
    })
    this.stitchRings(rings, true)
    return this
  }

  toString(): string {
    return `${this.lines.join('\n')}\n`
  }

  /** Quads between consecutive rings of equal size. */
  private stitchRings(rings: number[][], wrap: boolean): void {
    for (let r = 0; r + 1 < rings.length; r++) {
      const [a, b] = [rings[r]!, rings[r + 1]!]
      const count = wrap ? a.length : a.length - 1
      for (let s = 0; s < count; s++) {
        const next = (s + 1) % a.length
        this.face(a[s]!, a[next]!, b[next]!, b[s]!)
      }
    }
  }
}

function tangentAt(path: readonly Vec3[], i: number): Vec3 {
  const before = path[Math.max(0, i - 1)]!
  const after = path[Math.min(path.length - 1, i + 1)]!
  return normalize(sub(after, before))
}

function perpendicular(v: Vec3): Vec3 {
  const axis: Vec3 = Math.abs(v[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  return normalize(cross(v, axis))
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
