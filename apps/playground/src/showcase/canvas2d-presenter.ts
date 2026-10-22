import type { ReadonlyFloat32Array, ReadonlyRawEntityViews, ShapeMode } from '@engine/templates'

type Rgb = [number, number, number]

const OPAQUE_ALPHA = 0xff000000
/** Below this many pixels a disc is indistinguishable from a square. */
const MIN_CIRCLE_PIXELS = 3

/**
 * Software rasterizer for browsers without WebGPU: projects every particle
 * with the camera's `view_proj` and splats it into an `ImageData` in draw
 * order, so the preview matches the GPU path's painter's ordering.
 */
export class Canvas2dPresenter {
  private readonly canvas: HTMLCanvasElement
  private readonly context: CanvasRenderingContext2D
  private readonly background: number
  private image: ImageData | null = null

  constructor(canvas: HTMLCanvasElement, background: Rgb) {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas 2D is not available.')
    this.canvas = canvas
    this.context = context
    this.background = packColor(background[0], background[1], background[2])
  }

  present(views: ReadonlyRawEntityViews, viewProj: ReadonlyFloat32Array, shapeMode: ShapeMode): void {
    const { width, height } = this.canvas
    if (!this.image || this.image.width !== width || this.image.height !== height) {
      this.image = this.context.createImageData(width, height)
    }
    const pixels = new Uint32Array(this.image.data.buffer)
    pixels.fill(this.background)

    const m = viewProj
    const halfWidth = width / 2
    const halfHeight = height / 2
    // View-space units to pixels along the screen's x axis (before the 1/w
    // divide): the length of view_proj's first row, as in the WGSL billboard.
    const unitsToPixels = Math.hypot(m[0]!, m[4]!, m[8]!) * halfWidth
    const { positions, scales, colors } = views
    const count = positions.length / 3

    for (let i = 0; i < count; i++) {
      const x = positions[i * 3]!, y = positions[i * 3 + 1]!, z = positions[i * 3 + 2]!
      const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
      if (w <= 0) continue
      const depth = (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w
      if (depth < 0 || depth > 1) continue
      const sx = ((m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w) * halfWidth + halfWidth
      const sy = halfHeight - ((m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w) * halfHeight
      const size = Math.max(1, (scales[i * 3]! * unitsToPixels) / w)
      if (sx + size < 0 || sy + size < 0 || sx - size > width || sy - size > height) continue

      const color = packColor(colors[i * 3]!, colors[i * 3 + 1]!, colors[i * 3 + 2]!)
      const round = shapeMode === 'circle' && size >= MIN_CIRCLE_PIXELS
      splat(pixels, width, height, sx, sy, size, color, round)
    }
    this.context.putImageData(this.image, 0, 0)
  }
}

function splat(
  pixels: Uint32Array, width: number, height: number,
  cx: number, cy: number, size: number, color: number, round: boolean,
): void {
  const radius = size / 2
  const x0 = Math.max(0, Math.floor(cx - radius))
  const x1 = Math.min(width - 1, Math.ceil(cx + radius) - 1)
  const y0 = Math.max(0, Math.floor(cy - radius))
  const y1 = Math.min(height - 1, Math.ceil(cy + radius) - 1)
  const radiusSq = radius * radius
  for (let py = y0; py <= y1; py++) {
    const dy = py + 0.5 - cy
    for (let px = x0; px <= x1; px++) {
      if (round) {
        const dx = px + 0.5 - cx
        if (dx * dx + dy * dy > radiusSq) continue
      }
      pixels[py * width + px] = color
    }
  }
}

/** RGBA bytes in little-endian order, as `ImageData` stores them. */
function packColor(r: number, g: number, b: number): number {
  const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)))
  return (OPAQUE_ALPHA | (byte(b) << 16) | (byte(g) << 8) | byte(r)) >>> 0
}
