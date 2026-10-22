import type { Polyline } from './polyline.types.ts'

export type FillRule = 'nonzero' | 'evenodd'

/** Horizontal bands used to skip edges that cannot cross a scanline. */
const EDGE_BANDS = 64
/** Resolution (cells along the longer side) of the distance-to-edge grid. */
const DISTANCE_GRID_CELLS = 64
const AREA_GRID_CELLS = 96

/**
 * Fast geometric queries over one flattened SVG shape: containment under its
 * fill rule, area, perimeter, distance to the outline and evenly spaced
 * points along it.
 */
export class ShapeGeometry {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly perimeter: number

  private readonly polylines: readonly Polyline[]
  private readonly fillRule: FillRule
  /** Every fill edge as `x0, y0, x1, y1`; open sub-paths are closed for filling. */
  private readonly edges: Float64Array
  private readonly bands: number[][]
  private distanceGrid: Float32Array | null = null
  private distanceGridSize: [number, number] = [0, 0]
  private maxDistanceValue = 0
  private areaValue: number | null = null

  constructor(polylines: readonly Polyline[], fillRule: FillRule, closeForOutline: boolean) {
    this.polylines = polylines
    this.fillRule = fillRule
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const { points } of polylines) {
      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]!)
        maxX = Math.max(maxX, points[i]!)
        minY = Math.min(minY, points[i + 1]!)
        maxY = Math.max(maxY, points[i + 1]!)
      }
    }
    this.minX = minX
    this.minY = minY
    this.maxX = maxX
    this.maxY = maxY
    this.edges = collectEdges(polylines)
    this.bands = this.buildBands()
    this.perimeter = polylines.reduce(
      (sum, polyline) => sum + polylineLength(polyline, closeForOutline || polyline.closed),
      0,
    )
  }

  get width(): number {
    return this.maxX - this.minX
  }

  get height(): number {
    return this.maxY - this.minY
  }

  /** Filled area, estimated on a grid so self-overlaps and holes count correctly. */
  get area(): number {
    if (this.areaValue === null) {
      const cell = Math.max(this.width, this.height) / AREA_GRID_CELLS
      if (!(cell > 0)) return (this.areaValue = 0)
      let inside = 0
      for (let y = this.minY + cell / 2; y < this.maxY; y += cell) {
        for (let x = this.minX + cell / 2; x < this.maxX; x += cell) {
          if (this.contains(x, y)) inside++
        }
      }
      this.areaValue = inside * cell * cell
    }
    return this.areaValue
  }

  /** Point-in-shape test honouring the shape's fill rule. */
  contains(x: number, y: number): boolean {
    if (x < this.minX || x > this.maxX || y < this.minY || y > this.maxY) return false
    const edges = this.edges
    let winding = 0
    for (const edgeIndex of this.bands[this.bandOf(y)]!) {
      const offset = edgeIndex * 4
      const y0 = edges[offset + 1]!
      const y1 = edges[offset + 3]!
      if (y0 <= y === y1 <= y) continue
      const x0 = edges[offset]!
      const x1 = edges[offset + 2]!
      const crossX = x0 + ((y - y0) / (y1 - y0)) * (x1 - x0)
      if (crossX > x) winding += y1 > y0 ? 1 : -1
    }
    return this.fillRule === 'evenodd' ? winding % 2 !== 0 : winding !== 0
  }

  /** Approximate distance from `(x, y)` to the nearest outline edge. */
  distanceToOutline(x: number, y: number): number {
    const grid = this.ensureDistanceGrid()
    const [cols, rows] = this.distanceGridSize
    const gx = ((x - this.minX) / Math.max(this.width, 1e-9)) * (cols - 1)
    const gy = ((y - this.minY) / Math.max(this.height, 1e-9)) * (rows - 1)
    const x0 = clampIndex(Math.floor(gx), cols - 1)
    const y0 = clampIndex(Math.floor(gy), rows - 1)
    const x1 = Math.min(x0 + 1, cols - 1)
    const y1 = Math.min(y0 + 1, rows - 1)
    const tx = Math.min(Math.max(gx - x0, 0), 1)
    const ty = Math.min(Math.max(gy - y0, 0), 1)
    const top = grid[y0 * cols + x0]! * (1 - tx) + grid[y0 * cols + x1]! * tx
    const bottom = grid[y1 * cols + x0]! * (1 - tx) + grid[y1 * cols + x1]! * tx
    return top * (1 - ty) + bottom * ty
  }

  /** The largest {@link ShapeGeometry.distanceToOutline} inside the shape. */
  get maxDistance(): number {
    this.ensureDistanceGrid()
    return this.maxDistanceValue
  }

  /**
   * `count` points spread evenly by arc length along every sub-path, as
   * `[x, y, nx, ny]` with `n` the unit normal (for offsetting across a stroke).
   */
  sampleOutline(count: number, closeOpenPaths: boolean): [number, number, number, number][] {
    const samples: [number, number, number, number][] = []
    if (count <= 0 || this.perimeter <= 0) return samples
    const spacing = this.perimeter / count
    let carry = spacing / 2
    for (const polyline of this.polylines) {
      const pts = polyline.points
      const closed = closeOpenPaths || polyline.closed
      const segmentCount = pts.length / 2 - (closed ? 0 : 1)
      for (let s = 0; s < segmentCount && samples.length < count; s++) {
        const i0 = (s * 2) % pts.length
        const i1 = ((s + 1) * 2) % pts.length
        const ax = pts[i0]!, ay = pts[i0 + 1]!
        const bx = pts[i1]!, by = pts[i1 + 1]!
        const length = Math.hypot(bx - ax, by - ay)
        if (length === 0) continue
        const nx = -(by - ay) / length
        const ny = (bx - ax) / length
        while (carry <= length && samples.length < count) {
          const t = carry / length
          samples.push([ax + (bx - ax) * t, ay + (by - ay) * t, nx, ny])
          carry += spacing
        }
        carry -= length
      }
    }
    return samples
  }

  private bandOf(y: number): number {
    const t = (y - this.minY) / Math.max(this.height, 1e-9)
    return clampIndex(Math.floor(t * EDGE_BANDS), EDGE_BANDS - 1)
  }

  private buildBands(): number[][] {
    const bands: number[][] = Array.from({ length: EDGE_BANDS }, () => [])
    for (let e = 0; e < this.edges.length / 4; e++) {
      const y0 = this.edges[e * 4 + 1]!
      const y1 = this.edges[e * 4 + 3]!
      const first = this.bandOf(Math.min(y0, y1))
      const last = this.bandOf(Math.max(y0, y1))
      for (let band = first; band <= last; band++) bands[band]!.push(e)
    }
    return bands
  }

  private ensureDistanceGrid(): Float32Array {
    if (this.distanceGrid) return this.distanceGrid
    const longest = Math.max(this.width, this.height, 1e-9)
    const cols = Math.max(2, Math.round((this.width / longest) * DISTANCE_GRID_CELLS))
    const rows = Math.max(2, Math.round((this.height / longest) * DISTANCE_GRID_CELLS))
    const grid = new Float32Array(cols * rows)
    let maxDistance = 0
    for (let row = 0; row < rows; row++) {
      const y = this.minY + (row / (rows - 1)) * this.height
      for (let col = 0; col < cols; col++) {
        const x = this.minX + (col / (cols - 1)) * this.width
        const distance = distanceToEdges(this.edges, x, y)
        grid[row * cols + col] = distance
        if (distance > maxDistance && this.contains(x, y)) maxDistance = distance
      }
    }
    this.distanceGrid = grid
    this.distanceGridSize = [cols, rows]
    this.maxDistanceValue = maxDistance
    return grid
  }
}

function collectEdges(polylines: readonly Polyline[]): Float64Array {
  const edges: number[] = []
  for (const { points } of polylines) {
    const n = points.length / 2
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      edges.push(points[i * 2]!, points[i * 2 + 1]!, points[j * 2]!, points[j * 2 + 1]!)
    }
  }
  return Float64Array.from(edges)
}

function polylineLength({ points }: Polyline, closed: boolean): number {
  let length = 0
  const n = points.length / 2
  const segments = closed ? n : n - 1
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % n
    length += Math.hypot(points[j * 2]! - points[i * 2]!, points[j * 2 + 1]! - points[i * 2 + 1]!)
  }
  return length
}

function distanceToEdges(edges: Float64Array, x: number, y: number): number {
  let best = Infinity
  for (let o = 0; o < edges.length; o += 4) {
    const ax = edges[o]!, ay = edges[o + 1]!
    const dx = edges[o + 2]! - ax, dy = edges[o + 3]! - ay
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / lengthSq))
    const distanceSq = (ax + dx * t - x) ** 2 + (ay + dy * t - y) ** 2
    if (distanceSq < best) best = distanceSq
  }
  return Math.sqrt(best)
}

function clampIndex(value: number, max: number): number {
  return Math.min(Math.max(value, 0), max)
}
