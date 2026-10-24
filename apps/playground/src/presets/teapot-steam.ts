import { appendCloud } from '../cloud/append-layer.ts'
import type { PointCloud } from '../cloud/point-cloud.types.ts'
import { createSeededRandom } from '../vector/seeded-random.ts'
import { TEAPOT_SPOUT_TIP } from './teapot-model.ts'

/** Share of the particles spent on steam. */
const STEAM_SHARE = 0.04
const STEAM_HEIGHT = 1.8
const STEAM_COLOR = [0.86, 0.92, 1] as const

/** Appends a wispy `steam` column above the spout (model space). */
export function addTeapotSteam(cloud: PointCloud): PointCloud {
  const count = Math.max(1, Math.round(cloud.count * STEAM_SHARE))
  const random = createSeededRandom(9)
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random())
  const size = (cloud.scales[0] ?? 0.05) * 1.3
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  const scales = new Float32Array(count * 3).fill(size)
  const [tipX, tipY, tipZ] = TEAPOT_SPOUT_TIP
  for (let i = 0; i < count; i++) {
    const h = random()
    const spread = 0.06 + 0.22 * h
    positions.set([tipX + gaussian() * spread + h * 0.2, tipY + 0.12 + h * STEAM_HEIGHT, tipZ + gaussian() * spread], i * 3)
    const fade = 1 - 0.55 * h
    colors.set(STEAM_COLOR.map((c) => c * fade), i * 3)
  }
  return appendCloud(cloud, {
    count, positions, scales, colors,
    layers: [{ name: 'steam', start: 0, end: count, color: [...STEAM_COLOR] }],
  })
}
