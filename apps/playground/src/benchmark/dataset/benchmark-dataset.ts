import { CAT_SVG, CAT_TAIL_LAYER } from '../../vector/cat-vector-svg.ts'
import { createSeededRandom } from '../../vector/seeded-random.ts'
import { sampleSvgPointCloud } from '../../vector/svg-point-sampler.ts'
import type { SceneDataset, Vec3 } from '../competitor.types.ts'

/** Share of entities in the cat; the rest form the starfield around it. */
const CAT_SHARE = 0.7
/** Share of all entities animated by the partial-mutation workload. */
const TAIL_SHARE = 0.01
/** The cat's relief spans z = 0..~70; centering it keeps orbits balanced. */
const CAT_Z_OFFSET = -30
/** Starfield shell, sized so the overview camera sees every entity (far plane 1000). */
export const STAR_INNER_RADIUS = 150
export const STAR_OUTER_RADIUS = 250
const STAR_SIZE = 1.6
const DEFAULT_SEED = 2024

/**
 * The shared benchmark scene: the sampled vector cat (a dense focal cluster
 * for picking and the tail animation) inside a spherical starfield shell (a
 * wide distribution for frustum culling). The same `count` and `seed` always
 * give byte-identical data.
 *
 * @throws {Error} if `count` is too small to hold a 1% tail slice.
 */
export function createBenchmarkDataset(count: number, seed = DEFAULT_SEED): SceneDataset {
  const catCount = Math.round(count * CAT_SHARE)
  const cat = sampleSvgPointCloud(CAT_SVG, { count: catCount, seed })
  const tail = cat.layers.find((layer) => layer.name === CAT_TAIL_LAYER)
  const tailCount = Math.max(1, Math.round(count * TAIL_SHARE))
  if (!tail || tail.start !== 0 || tail.end < tailCount) {
    throw new Error(`Dataset of ${count} entities cannot hold a ${tailCount}-entity tail slice.`)
  }

  const positions = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  positions.set(cat.positions)
  scales.set(cat.scales)
  colors.set(cat.colors)
  for (let i = 0; i < catCount; i++) positions[i * 3 + 2]! += CAT_Z_OFFSET

  const position: Vec3 = [0, 0, 0], scale: Vec3 = [0, 0, 0], color: Vec3 = [0, 0, 0]
  for (let key = catCount; key < count; key++) {
    writeStar(createSeededRandom(seed ^ (key * 0x9e3779b1)), position, scale, color)
    positions.set(position, key * 3)
    scales.set(scale, key * 3)
    colors.set(color, key * 3)
  }

  const eyes = cat.layers.find((layer) => layer.name === 'eyes')!
  const [eyeX, eyeY] = cat.toWorld(160, 148)
  let eyeZ = 0
  for (let i = eyes.start; i < eyes.end; i++) eyeZ = Math.max(eyeZ, positions[i * 3 + 2]!)

  return {
    count,
    positions,
    scales,
    colors,
    catCount,
    tailSlice: { start: 0, count: tailCount },
    zoomFocus: [eyeX, eyeY, eyeZ],
    churnSeed: seed + 1,
    spawnEntity: (key, p, s, c) => writeStar(createSeededRandom(seed ^ (key * 0x9e3779b1)), p, s, c),
  }
}

/** A star: uniform direction, radius within the shell, cool white-blue tint. */
function writeStar(random: () => number, position: Vec3, scale: Vec3, color: Vec3): void {
  const z = random() * 2 - 1
  const angle = random() * Math.PI * 2
  const ring = Math.sqrt(1 - z * z)
  const radius = STAR_INNER_RADIUS + random() * (STAR_OUTER_RADIUS - STAR_INNER_RADIUS)
  position[0] = Math.cos(angle) * ring * radius
  position[1] = Math.sin(angle) * ring * radius
  position[2] = z * radius
  const size = STAR_SIZE * (0.6 + random() * 0.8)
  scale[0] = scale[1] = scale[2] = size
  const warmth = random()
  color[0] = 0.7 + 0.3 * warmth
  color[1] = 0.78 + 0.2 * warmth
  color[2] = 1
}
