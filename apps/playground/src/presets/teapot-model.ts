import { ObjBuilder } from './obj-builder.ts'

type Vec3 = [number, number, number]

const SEGMENTS = 72
const TUBE_SEGMENTS = 20
const PATH_STEPS = 48

/** Body silhouette `[radius, y]`, bottom to rim. */
const BODY: [number, number][] = [
  [0, 0], [0.9, 0], [1.2, 0.1], [1.42, 0.38], [1.5, 0.72], [1.45, 1.02],
  [1.3, 1.26], [1.1, 1.42], [0.95, 1.5],
]
/** Lid and knob, rim to tip. */
const LID: [number, number][] = [
  [0.98, 1.5], [0.9, 1.6], [0.62, 1.72], [0.3, 1.8], [0.14, 1.86],
  [0.2, 1.96], [0.18, 2.06], [0, 2.1],
]

/** Where the spout's opening is, for placing the steam (model units). */
export const TEAPOT_SPOUT_TIP: Vec3 = [2.55, 1.55, 0]

/**
 * A procedural teapot (lathe body and lid, tube spout and handle) as OBJ
 * text with groups `body`, `lid`, `spout` and `handle`. Not the Newell
 * patch data: an original model in its spirit.
 */
export function teapotObj(): string {
  const builder = new ObjBuilder()
  builder.group('body').lathe(BODY, SEGMENTS)
  builder.group('lid').lathe(LID, SEGMENTS)
  builder.group('spout').tube(
    curve([1.3, 0.55, 0], [2.0, 0.65, 0], [2.15, 1.35, 0], TEAPOT_SPOUT_TIP),
    (t) => 0.3 - 0.17 * t,
    TUBE_SEGMENTS,
  )
  builder.group('handle').tube(
    curve([-1.35, 1.2, 0], [-2.35, 1.35, 0], [-2.3, 0.35, 0], [-1.42, 0.45, 0]),
    () => 0.11,
    TUBE_SEGMENTS,
  )
  return builder.toString()
}

/** Points along a cubic Bezier curve. */
function curve(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3): Vec3[] {
  return Array.from({ length: PATH_STEPS + 1 }, (_, i) => {
    const t = i / PATH_STEPS
    const u = 1 - t
    const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return [0, 1, 2].map((axis) =>
      w[0]! * p0[axis]! + w[1]! * p1[axis]! + w[2]! * p2[axis]! + w[3]! * p3[axis]!) as Vec3
  })
}
