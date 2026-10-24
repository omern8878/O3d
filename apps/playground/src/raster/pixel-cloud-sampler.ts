import type { PointCloud } from '../cloud/point-cloud.types.ts'
import { surfaceParticleSize } from '../cloud/particle-size.ts'
import { createSeededRandom } from '../vector/seeded-random.ts'

/** Pixels at least this opaque (0-255) are part of the drawing. */
const MIN_ALPHA = 32
const BYTES_PER_PIXEL = 4
const RASTER_LAYER = 'raster'
/** Darker pixels are slightly recessed so the 3D view keeps a little relief. */
const RELIEF_DEPTH = 4

/** RGBA pixels, as in `ImageData`. */
export type PixelImage = { data: Uint8ClampedArray; width: number; height: number }

/**
 * Turns a rendered image into `count` particles: uniform random samples over
 * the visibly painted pixels (alpha >= 32), jittered within each pixel and
 * coloured by it. `+Y` is up; one pixel is one world unit before
 * normalization.
 *
 * @throws {Error} if no pixel is visibly painted.
 */
export function samplePixelCloud(image: PixelImage, count: number, seed = 5): PointCloud {
  const { data, width, height } = image
  const painted: number[] = []
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (data[pixel * BYTES_PER_PIXEL + 3]! >= MIN_ALPHA) painted.push(pixel)
  }
  if (painted.length === 0) throw new Error('The SVG renders nothing visible.')

  const random = createSeededRandom(seed)
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3).fill(surfaceParticleSize(painted.length, count))
  for (let i = 0; i < count; i++) {
    const pixel = painted[Math.floor(random() * painted.length)]!
    const o = pixel * BYTES_PER_PIXEL
    const [r, g, b] = [data[o]! / 255, data[o + 1]! / 255, data[o + 2]! / 255]
    positions[i * 3] = (pixel % width) + random()
    positions[i * 3 + 1] = -(Math.floor(pixel / width) + random())
    positions[i * 3 + 2] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * RELIEF_DEPTH
    colors[i * 3] = r
    colors[i * 3 + 1] = g
    colors[i * 3 + 2] = b
  }
  return {
    count,
    positions,
    scales,
    colors,
    layers: [{ name: RASTER_LAYER, start: 0, end: count, color: [1, 1, 1] }],
  }
}
