import type { BenchCamera, SceneDataset, Vec3 } from '../competitor.types.ts'
import { frustumPlanes, sphereInFrustum, viewProjection } from '../math/camera-math.ts'
import { STAR_OUTER_RADIUS } from './benchmark-dataset.ts'

/** Matches the engine camera: 45 degree FOV, near 0.1, far 1000. */
const FOV_Y = Math.PI / 4
const NEAR = 0.1
const FAR = 1000
export const BENCH_ASPECT = 16 / 9
/** `radius / sin(fov / 2)` plus margin: the whole starfield stays in view while orbiting. */
const OVERVIEW_DISTANCE = (STAR_OUTER_RADIUS / Math.sin(FOV_Y / 2)) * 1.07
const ORBIT_ELEVATION = 0.25
/** Radians per frame of the workload-1 orbit. */
const ORBIT_STEP = 0.01
/** Tiny alternating offset so a fixed camera still forces a fresh cull each frame. */
const ZOOM_JITTER = 0.002

function camera(eye: Vec3, target: Vec3): BenchCamera {
  return { eye, target, fovY: FOV_Y, aspect: BENCH_ASPECT, near: NEAR, far: FAR }
}

/** The overview: every entity inside the frustum. */
export function overviewCamera(): BenchCamera {
  return orbitCamera(0)
}

/** Frame `frame` of a smooth orbit around the scene at overview distance. */
export function orbitCamera(frame: number): BenchCamera {
  const azimuth = frame * ORBIT_STEP
  const ring = Math.cos(ORBIT_ELEVATION) * OVERVIEW_DISTANCE
  return camera(
    [Math.sin(azimuth) * ring, Math.sin(ORBIT_ELEVATION) * OVERVIEW_DISTANCE, Math.cos(azimuth) * ring],
    [0, 0, 0],
  )
}

/**
 * The deep-zoom camera: in front of the cat's eye, pulled in until at most
 * `targetFraction` of entities (tested as bounding spheres, like the engine's
 * culler) remain inside the frustum. `frame` adds a sub-pixel jitter.
 */
export function tightCamera(data: SceneDataset, targetFraction: number, frame = 0): BenchCamera {
  const [fx, fy, fz] = data.zoomFocus
  let distance = 200
  let best = camera([fx, fy, fz + distance], data.zoomFocus)
  while (distance > 1 && visibleFraction(data, best) > targetFraction) {
    distance *= 0.9
    best = camera([fx, fy, fz + distance], data.zoomFocus)
  }
  const jitter = frame % 2 === 0 ? ZOOM_JITTER : -ZOOM_JITTER
  return camera([best.eye[0] + jitter, best.eye[1], best.eye[2]], best.target)
}

/** Share of dataset entities whose bounding sphere intersects the frustum. */
export function visibleFraction(data: SceneDataset, cam: BenchCamera): number {
  const planes = frustumPlanes(viewProjection(cam))
  let visible = 0
  for (let i = 0; i < data.count; i++) {
    const o = i * 3
    const radius = 0.5 * Math.hypot(data.scales[o]!, data.scales[o + 1]!, data.scales[o + 2]!)
    if (sphereInFrustum(planes, data.positions[o]!, data.positions[o + 1]!, data.positions[o + 2]!, radius)) {
      visible++
    }
  }
  return visible / data.count
}

/** 50 pointer positions (NDC) spiralling over the cat in the overview framing. */
export function pickPoints(count = 50): [number, number][] {
  const points: [number, number][] = []
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) / count
    const radius = 0.03 + 0.12 * Math.sqrt(t)
    const angle = i * 2.399963 // golden angle
    points.push([Math.cos(angle) * radius / BENCH_ASPECT * 1.6, Math.sin(angle) * radius])
  }
  return points
}

/** Vertical travel of the tail wave, in world units. */
const WAVE_AMPLITUDE = 6
/** The tail-wave displacement of entity `key` at `time` (seconds); identical for every engine. */
export function tailWaveOffset(key: number, time: number): number {
  return Math.sin(time * 3 + key * 0.02) * WAVE_AMPLITUDE
}
