import type { Rgb } from '../vector/svg-color.ts'

/** Distinct, bright base colours for mesh groups without vertex colours. */
const GROUP_PALETTE: readonly Rgb[] = [
  [0.55, 0.62, 1.0], [0.15, 0.96, 0.63], [1.0, 0.56, 0.72], [1.0, 0.78, 0.35],
  [0.45, 0.85, 1.0], [0.8, 0.55, 1.0], [1.0, 0.45, 0.4], [0.75, 0.95, 0.45],
]
/** Key light from the upper right front, so surfaces read as volumes. */
const LIGHT = normalize([0.45, 0.75, 0.5])
const AMBIENT = 0.32

export function groupColor(groupIndex: number): Rgb {
  return GROUP_PALETTE[groupIndex % GROUP_PALETTE.length]!
}

/** Two-sided Lambert shading: `base * (ambient + diffuse * |n . light|)`. */
export function shade(base: Rgb, nx: number, ny: number, nz: number, out: Rgb): Rgb {
  const length = Math.hypot(nx, ny, nz) || 1
  const diffuse = Math.abs((nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) / length)
  const light = AMBIENT + (1 - AMBIENT) * diffuse
  out[0] = Math.min(1, base[0] * light)
  out[1] = Math.min(1, base[1] * light)
  out[2] = Math.min(1, base[2] * light)
  return out
}

function normalize([x, y, z]: Rgb): Rgb {
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}
