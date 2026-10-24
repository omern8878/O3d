import type { SceneCameraMode, SceneTemplate } from '@engine/templates'

/** Half the engine camera's 45 degree vertical field of view. */
const HALF_FOV_Y = Math.PI / 8
/** Breathing room around the scene's bounding sphere. */
const FIT_MARGIN = 1.08
/** Sources are normalized into [-10, 10], so this is the radius when none is given. */
const DEFAULT_RADIUS = 10
const SWAY_AMPLITUDE_RAD = 0.5
const SWAY_PERIOD_S = 14
const TURNTABLE_RAD_PER_S = 0.45

/** Starting view angles for a 3D camera, in radians. */
export type OrbitAngles = { azimuth: number; elevation: number }

export const DEFAULT_3D_ANGLES: OrbitAngles = { azimuth: 0, elevation: 0.12 }
/** The view a dropped 3D model opens with, so its depth reads immediately. */
export const MODEL_3D_ANGLES: OrbitAngles = { azimuth: 0.6, elevation: 0.35 }

/**
 * Camera presets for canonical space, a gentle idle sway in 3D (which stops
 * once the user takes control) and a turntable mode.
 */
export class CameraRig {
  private swayOffset = 0
  private swaying = true
  private swayStart: number | null = null

  /**
   * Resets the view for `mode`, framing a scene of bounding-sphere `radius`
   * around the origin: front-on in 2D, at `angles` in 3D. A view that
   * contains the whole sphere also lets the engine skip per-entity culling.
   */
  apply(
    scene: SceneTemplate,
    mode: SceneCameraMode,
    angles: OrbitAngles = DEFAULT_3D_ANGLES,
    radius = DEFAULT_RADIUS,
  ): void {
    const camera = scene.getCameraController()
    const distance = (radius * FIT_MARGIN) / Math.sin(HALF_FOV_Y)
    scene.setCameraMode(mode)
    camera.setTarget(0, 0, 0)
    camera.setPosition(0, 0, distance)
    this.swayOffset = 0
    this.swayStart = null
    if (mode === 'ortho2d') camera.setOrthoHalfHeight(radius * FIT_MARGIN)
    else camera.orbit(angles.azimuth, angles.elevation)
  }

  stopSway(): void {
    this.swaying = false
  }

  resumeSway(): void {
    this.swaying = true
  }

  /** Idle sway: a slow back-and-forth orbit, 3D only. */
  update(scene: SceneTemplate, timeSeconds: number): void {
    const camera = scene.getCameraController()
    if (!this.swaying || camera.getMode() !== '3d') return
    this.swayStart ??= timeSeconds
    const next = Math.sin(((timeSeconds - this.swayStart) / SWAY_PERIOD_S) * 2 * Math.PI) * SWAY_AMPLITUDE_RAD
    camera.orbit(next - this.swayOffset, 0)
    this.swayOffset = next
  }

  /** Turntable: a steady orbit (2D views turn into 3D). Moves only the camera: 0 instance bytes. */
  turntable(scene: SceneTemplate, deltaSeconds: number, radius = DEFAULT_RADIUS): void {
    const camera = scene.getCameraController()
    if (camera.getMode() !== '3d') this.apply(scene, 'perspective3d', DEFAULT_3D_ANGLES, radius)
    camera.orbit(TURNTABLE_RAD_PER_S * deltaSeconds, 0)
  }
}
