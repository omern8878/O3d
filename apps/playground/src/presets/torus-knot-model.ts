import { ObjBuilder } from './obj-builder.ts'

type Vec3 = [number, number, number]

const P = 2
const Q = 3
const STEPS = 480
const TUBE_SEGMENTS = 18
const TUBE_RADIUS = 0.42
/** Share of the knot's length in the separately animated `pulse` group. */
const PULSE_SHARE = 0.12

/**
 * A (2, 3) trefoil torus knot tube as OBJ text, in two groups: a short
 * `pulse` segment (animated on its own) and the rest of the `knot`.
 */
export function torusKnotObj(): string {
  const path = Array.from({ length: STEPS + 1 }, (_, i) => knotPoint((i / STEPS) * Math.PI * 2))
  const split = Math.round(STEPS * PULSE_SHARE)
  const builder = new ObjBuilder()
  builder.group('pulse').tube(path.slice(0, split + 1), () => TUBE_RADIUS, TUBE_SEGMENTS)
  builder.group('knot').tube(path.slice(split), () => TUBE_RADIUS, TUBE_SEGMENTS)
  return builder.toString()
}

function knotPoint(t: number): Vec3 {
  const radius = Math.cos(Q * t) + 2
  return [radius * Math.cos(P * t), -Math.sin(Q * t), radius * Math.sin(P * t)]
}
