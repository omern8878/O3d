import { allocateByWeight } from './point-budget.ts'
import type { PointLayer, SvgPointCloud } from './point-cloud.types.ts'
import { ReliefHeightmap } from './relief-heightmap.ts'
import { createSeededRandom } from './seeded-random.ts'
import { ShapeGeometry } from './shape-geometry.ts'
import { mixRgb, type Rgb } from './svg-color.ts'
import { parseSvgDocument, type SvgDocument, type SvgShape } from './svg-document-parser.ts'

export type SampleOptions = {
  /** Exact number of points to produce. */
  count: number
  /** Height of the drawing in world units. Default `200`. */
  worldHeight?: number
  /** Share of points placed on outlines rather than inside fills. Default `0.3`. */
  outlineShare?: number
  /** Dome height of a filled layer relative to its inner radius. Default `0.9`. */
  reliefStrength?: number
  /** Seed for jitter, so the same input always gives the same cloud. Default `7`. */
  seed?: number
}

const DEFAULTS = { worldHeight: 200, outlineShare: 0.3, reliefStrength: 0.9, seed: 7 }
/** Vertical gap (world units) between stacked layers. */
const LAYER_GAP = 1.2
const FILL_POINT_SIZE = 1.35
const OUTLINE_POINT_SIZE = 0.75
const STROKE_POINT_SIZE = 0.8
/** Rims are lightened toward white so silhouettes read as crisp neon edges. */
const RIM_LIGHTEN = 0.45
const DARK_LUMINANCE = 0.1
const SHADE_BASE = 0.78
const SHADE_RANGE = 0.32
const COLOR_JITTER = 0.04
/** R2 low-discrepancy sequence constants (plastic number). */
const R2_A1 = 0.7548776662466927
const R2_A2 = 0.5698402909980532
/**
 * Small fills (eyes, pupils, nose) below this share of the total area get
 * `DETAIL_DENSITY` times the points, so fine details read as solid shapes.
 */
const DETAIL_AREA_SHARE = 0.03
const DETAIL_DENSITY = 2.5
/** Rejection sampling gives up after this many tries per wanted fill point. */
const MAX_TRIES_PER_POINT = 64

type PreparedShape = {
  shape: SvgShape
  geometry: ShapeGeometry
  fillCount: number
  outlineCount: number
}

/** Parses an SVG string and samples it; see {@link samplePointCloud}. */
export function sampleSvgPointCloud(svg: string, options: SampleOptions): SvgPointCloud {
  return samplePointCloud(parseSvgDocument(svg), options)
}

/**
 * Turns vector shapes into exactly `options.count` particles.
 *
 * Every layer contributes dense outline points (razor-sharp edges) and
 * evenly spread interior points (low-discrepancy, so fills look solid), in
 * proportion to its perimeter and area. Points keep SVG draw order and each
 * named layer occupies one contiguous index range, so a layer can be animated
 * by touching a single slice. `z` stacks every layer on the ones below it and
 * domes it by distance from its outline: flat in an orthographic view,
 * volumetric when orbited.
 *
 * @throws {Error} if the SVG contains nothing paintable.
 */
export function samplePointCloud(document: SvgDocument, options: SampleOptions): SvgPointCloud {
  const settings = { ...DEFAULTS, ...options }
  const count = Math.max(0, Math.floor(settings.count))
  const viewBox = document.viewBox
  if (!viewBox || document.shapes.length === 0) {
    throw new Error('The SVG contains no paintable shapes.')
  }

  const worldScale = settings.worldHeight / Math.max(viewBox.height, viewBox.width * 0.75)
  const centerX = viewBox.x + viewBox.width / 2
  const centerY = viewBox.y + viewBox.height / 2
  const toWorld = (x: number, y: number): [number, number] => [
    (x - centerX) * worldScale,
    -(y - centerY) * worldScale,
  ]

  const prepared = budgetShapes(document.shapes, count, settings.outlineShare)
  // Point size follows the main (non-detail) density, which the largest fill sets.
  const largest = prepared.reduce<PreparedShape | null>(
    (best, p) => (p.fillCount > 0 && (!best || p.geometry.area > best.geometry.area) ? p : best),
    null,
  )
  const fillSpacing = largest
    ? Math.sqrt(largest.geometry.area / largest.fillCount)
    : Math.max(viewBox.width, viewBox.height) / Math.sqrt(Math.max(count, 1))

  const writer = new PointWriter(count, worldScale, toWorld)
  const heightmap = new ReliefHeightmap(viewBox.x, viewBox.y, viewBox.width, viewBox.height)
  const random = createSeededRandom(settings.seed)
  const layers: PointLayer[] = []

  for (const item of prepared) {
    const start = writer.count
    sampleShape(item, writer, heightmap, random, fillSpacing, settings.reliefStrength)
    appendLayer(layers, item.shape, start, writer.count)
  }
  writer.padTo(count)
  const lastLayer = layers[layers.length - 1]
  if (lastLayer) lastLayer.end = count

  return { count, ...writer.buffers(), layers, toWorld }
}

/** Splits the point budget across fills and outlines by area and perimeter. */
function budgetShapes(shapes: readonly SvgShape[], count: number, outlineShare: number): PreparedShape[] {
  const geometries = shapes.map(
    (shape) => new ShapeGeometry(shape.polylines, shape.fillRule, shape.fill !== null),
  )
  const totalArea = shapes.reduce((sum, s, i) => sum + (s.fill ? geometries[i]!.area : 0), 0)
  const totalPerimeter = geometries.reduce((sum, g) => sum + g.perimeter, 0)
  const share = Math.min(Math.max(outlineShare, 0.01), 0.99)
  // Scales perimeter into "area units" so outlines get `share` of all points.
  const perimeterWeight =
    totalArea > 0 && totalPerimeter > 0 ? ((share / (1 - share)) * totalArea) / totalPerimeter : 1

  const fillWeight = (area: number) =>
    area < totalArea * DETAIL_AREA_SHARE ? area * DETAIL_DENSITY : area
  const weights = shapes.flatMap((shape, i) => [
    shape.fill ? fillWeight(geometries[i]!.area) : 0,
    geometries[i]!.perimeter * perimeterWeight,
  ])
  const counts = allocateByWeight(count, weights)
  return shapes.map((shape, i) => ({
    shape,
    geometry: geometries[i]!,
    fillCount: counts[i * 2]!,
    outlineCount: counts[i * 2 + 1]!,
  }))
}

function sampleShape(
  { shape, geometry, fillCount, outlineCount }: PreparedShape,
  writer: PointWriter,
  heightmap: ReliefHeightmap,
  random: () => number,
  fillSpacing: number,
  reliefStrength: number,
): void {
  const maxDistance = Math.max(geometry.maxDistance, 1e-9)
  const reliefHeight = maxDistance * writer.worldScale * reliefStrength
  const dome = (x: number, y: number) =>
    Math.sqrt(Math.min(geometry.distanceToOutline(x, y) / maxDistance, 1))

  if (shape.fill) {
    const placed = sampleFill(geometry, fillCount, random, (x, y) => {
      const height = dome(x, y)
      const z = heightmap.heightAt(x, y) + LAYER_GAP + height * reliefHeight
      const color = jitter(shade(shape.fill!, height), random)
      writer.push(x, y, z, fillSpacing * FILL_POINT_SIZE, color)
    })
    // Tiny shapes can reject every candidate; give leftovers to the outline.
    outlineCount += fillCount - placed
  }

  const rim = shape.fill ? rimColor(shape.fill) : shape.stroke!
  const strokeWidth = shape.fill ? 0 : shape.strokeWidth
  const size = shape.fill
    ? fillSpacing * OUTLINE_POINT_SIZE
    : Math.max(strokeWidth * STROKE_POINT_SIZE, fillSpacing * OUTLINE_POINT_SIZE * 0.6)
  for (const [x, y, nx, ny] of geometry.sampleOutline(outlineCount, shape.fill !== null)) {
    const offset = (random() - 0.5) * strokeWidth
    const px = x + nx * offset
    const py = y + ny * offset
    writer.push(px, py, heightmap.heightAt(px, py) + LAYER_GAP, size, jitter(rim, random))
  }

  if (shape.fill) {
    heightmap.stack(geometry, (base, x, y) => base + LAYER_GAP + dome(x, y) * reliefHeight)
  }
}

/**
 * Places up to `wanted` points inside the shape using an R2 low-discrepancy
 * sequence over its bounding box (even, blue-noise-like coverage).
 * Returns how many were placed.
 */
function sampleFill(
  geometry: ShapeGeometry,
  wanted: number,
  random: () => number,
  emit: (x: number, y: number) => void,
): number {
  if (wanted <= 0) return 0
  const offsetX = random()
  const offsetY = random()
  const maxTries = wanted * MAX_TRIES_PER_POINT
  let placed = 0
  for (let i = 0; i < maxTries && placed < wanted; i++) {
    const x = geometry.minX + ((offsetX + i * R2_A1) % 1) * geometry.width
    const y = geometry.minY + ((offsetY + i * R2_A2) % 1) * geometry.height
    if (geometry.contains(x, y)) {
      emit(x, y)
      placed++
    }
  }
  return placed
}

function appendLayer(layers: PointLayer[], shape: SvgShape, start: number, end: number): void {
  if (end === start) return
  const last = layers[layers.length - 1]
  if (last && last.name === shape.name && last.end === start) {
    last.end = end
    return
  }
  layers.push({ name: shape.name, start, end, color: shape.fill ?? shape.stroke! })
}

/** Lighter toward the dome's crest, like soft top lighting. */
function shade(color: Rgb, height: number): Rgb {
  const factor = SHADE_BASE + SHADE_RANGE * height
  return [Math.min(1, color[0] * factor), Math.min(1, color[1] * factor), Math.min(1, color[2] * factor)]
}

function rimColor(fill: Rgb): Rgb {
  const luminance = 0.2126 * fill[0] + 0.7152 * fill[1] + 0.0722 * fill[2]
  return luminance < DARK_LUMINANCE ? fill : mixRgb(fill, [1, 1, 1], RIM_LIGHTEN)
}

function jitter(color: Rgb, random: () => number): Rgb {
  const amount = 1 + (random() - 0.5) * 2 * COLOR_JITTER
  return [Math.min(1, color[0] * amount), Math.min(1, color[1] * amount), Math.min(1, color[2] * amount)]
}

/** Appends points to preallocated SoA arrays, converting to world space. */
class PointWriter {
  count = 0
  readonly worldScale: number
  private readonly positions: Float32Array
  private readonly scales: Float32Array
  private readonly colors: Float32Array
  private readonly toWorld: (x: number, y: number) => [number, number]

  constructor(capacity: number, worldScale: number, toWorld: (x: number, y: number) => [number, number]) {
    this.positions = new Float32Array(capacity * 3)
    this.scales = new Float32Array(capacity * 3)
    this.colors = new Float32Array(capacity * 3)
    this.worldScale = worldScale
    this.toWorld = toWorld
  }

  /** `x, y` in SVG space; `z` and `size` already in world units. */
  push(x: number, y: number, z: number, size: number, color: Rgb): void {
    if (this.count * 3 >= this.positions.length) return
    const o = this.count * 3
    const [wx, wy] = this.toWorld(x, y)
    this.positions.set([wx, wy, z], o)
    const worldSize = size * this.worldScale
    this.scales.set([worldSize, worldSize, worldSize], o)
    this.colors.set(color, o)
    this.count++
  }

  /** Repeats the last point so the cloud always holds exactly `count` points. */
  padTo(count: number): void {
    if (this.count === 0) return
    const last = (this.count - 1) * 3
    while (this.count < count) {
      const o = this.count * 3
      this.positions.copyWithin(o, last, last + 3)
      this.scales.copyWithin(o, last, last + 3)
      this.colors.copyWithin(o, last, last + 3)
      this.count++
    }
  }

  buffers(): Pick<SvgPointCloud, 'positions' | 'scales' | 'colors'> {
    return { positions: this.positions, scales: this.scales, colors: this.colors }
  }
}
