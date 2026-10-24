import type { PointCloud, PointLayer } from '../cloud/point-cloud.types.ts'
import { volumeParticleSize } from '../cloud/particle-size.ts'
import { createSeededRandom } from '../vector/seeded-random.ts'
import type { Rgb } from '../vector/svg-color.ts'

const RADIUS = 10
const ARMS = 3
/** How tightly the logarithmic arms wind. */
const WINDING = 2.6
const SHARES = { core: 0.18, arms: 0.64, halo: 0.18 } as const
const CORE_COLOR: Rgb = [1, 0.82, 0.55]
const ARM_COLOR: Rgb = [0.62, 0.74, 1]
const NEBULA_COLOR: Rgb = [1, 0.45, 0.7]
const HALO_COLOR: Rgb = [0.75, 0.8, 0.95]

/**
 * A procedural spiral galaxy: a warm `core` bulge, three blue logarithmic
 * `arms` sprinkled with pink nebulae, and a faint spherical `halo`, each a
 * contiguous layer. The disc lies in the XZ plane.
 */
export function galaxyCloud(count: number, seed = 42): PointCloud {
  const random = createSeededRandom(seed)
  // Clamped to 3 sigma: a few far outliers would otherwise set the normalization
  // scale and shrink the whole galaxy.
  const gaussian = () =>
    Math.max(-3, Math.min(3, Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())))
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3)
  const size = volumeParticleSize(RADIUS, count)
  const layers: PointLayer[] = []
  let i = 0

  const emit = (x: number, y: number, z: number, color: Rgb, sizeFactor: number) => {
    positions.set([x, y, z], i * 3)
    const brightness = 0.75 + 0.35 * random()
    colors.set(color.map((c) => Math.min(1, c * brightness)), i * 3)
    scales.fill(size * sizeFactor, i * 3, i * 3 + 3)
    i++
  }
  const layer = (name: string, share: number, color: Rgb, emitOne: () => void) => {
    const start = i
    const end = name === 'halo' ? count : Math.min(count, start + Math.round(count * share))
    while (i < end) emitOne()
    layers.push({ name, start, end, color })
  }

  layer('core', SHARES.core, CORE_COLOR, () => {
    const r = Math.abs(gaussian()) * 1.4
    const [x, y, z] = randomDirection(random)
    emit(x * r, y * r * 0.6, z * r, CORE_COLOR, 1.1)
  })
  layer('arms', SHARES.arms, ARM_COLOR, () => {
    const r = Math.min(RADIUS * 0.92, 0.8 + -Math.log(1 - random() * 0.97) * 2.4)
    const arm = Math.floor(random() * ARMS)
    const angle = (arm / ARMS) * Math.PI * 2 + Math.log(r) * WINDING + gaussian() * 0.22
    const spread = gaussian() * 0.07 * r
    const nebula = random() < 0.06
    emit(Math.cos(angle) * r + spread, gaussian() * 0.18, Math.sin(angle) * r + spread,
      nebula ? NEBULA_COLOR : ARM_COLOR, nebula ? 1.4 : 1)
  })
  layer('halo', SHARES.halo, HALO_COLOR, () => {
    const r = RADIUS * Math.cbrt(random())
    const [x, y, z] = randomDirection(random)
    emit(x * r, y * r * 0.5, z * r, HALO_COLOR, 0.8)
  })

  return { count, positions, scales, colors, layers: layers.filter((l) => l.end > l.start) }
}

function randomDirection(random: () => number): [number, number, number] {
  const z = random() * 2 - 1
  const angle = random() * Math.PI * 2
  const ring = Math.sqrt(1 - z * z)
  return [Math.cos(angle) * ring, z, Math.sin(angle) * ring]
}
