import type { ShapeGeometry } from './shape-geometry.ts'

const DEFAULT_RESOLUTION = 256

/**
 * A height field over the drawing that grows as layers are stacked, so each
 * layer's relief sits on top of whatever was painted beneath it (eyes on the
 * head, the head over the tail) instead of sinking into it.
 */
export class ReliefHeightmap {
  private readonly heights: Float32Array
  private readonly cols: number
  private readonly rows: number
  private readonly minX: number
  private readonly minY: number
  private readonly cellSize: number

  constructor(minX: number, minY: number, width: number, height: number, resolution = DEFAULT_RESOLUTION) {
    this.cellSize = Math.max(width, height, 1e-9) / resolution
    this.cols = Math.max(2, Math.ceil(width / this.cellSize) + 1)
    this.rows = Math.max(2, Math.ceil(height / this.cellSize) + 1)
    this.minX = minX
    this.minY = minY
    this.heights = new Float32Array(this.cols * this.rows)
  }

  /** Bilinearly interpolated height at a drawing-space point. */
  heightAt(x: number, y: number): number {
    const gx = clamp((x - this.minX) / this.cellSize, 0, this.cols - 1)
    const gy = clamp((y - this.minY) / this.cellSize, 0, this.rows - 1)
    const x0 = Math.min(Math.floor(gx), this.cols - 2)
    const y0 = Math.min(Math.floor(gy), this.rows - 2)
    const tx = gx - x0
    const ty = gy - y0
    const h = this.heights
    const i = y0 * this.cols + x0
    const top = h[i]! * (1 - tx) + h[i + 1]! * tx
    const bottom = h[i + this.cols]! * (1 - tx) + h[i + this.cols + 1]! * tx
    return top * (1 - ty) + bottom * ty
  }

  /**
   * Raises every cell inside `shape` by `surface(previousHeight, x, y)`'s
   * result, i.e. stacks the shape on top of what is already there.
   */
  stack(shape: ShapeGeometry, surface: (baseHeight: number, x: number, y: number) => number): void {
    const firstCol = Math.max(0, Math.floor((shape.minX - this.minX) / this.cellSize))
    const lastCol = Math.min(this.cols - 1, Math.ceil((shape.maxX - this.minX) / this.cellSize))
    const firstRow = Math.max(0, Math.floor((shape.minY - this.minY) / this.cellSize))
    const lastRow = Math.min(this.rows - 1, Math.ceil((shape.maxY - this.minY) / this.cellSize))
    for (let row = firstRow; row <= lastRow; row++) {
      const y = this.minY + row * this.cellSize
      for (let col = firstCol; col <= lastCol; col++) {
        const x = this.minX + col * this.cellSize
        if (shape.contains(x, y)) {
          const index = row * this.cols + col
          this.heights[index] = surface(this.heights[index]!, x, y)
        }
      }
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
