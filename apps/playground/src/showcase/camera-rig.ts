import type { SceneCameraMode, SceneTemplate } from '@engine/templates'

/** Eye distance: the 200-unit-tall cat fills ~75% of a 45 degree view. */
const EYE_DISTANCE = 320
/** Aim at the middle of the relief so orbits pivot through the cat's volume. */
const TARGET_DEPTH = 20
const ORTHO_HALF_HEIGHT = 118
const SWAY_AMPLITUDE_RAD = 0.55
const SWAY_PERIOD_S = 14
const INITIAL_ELEVATION_RAD = 0.12

/**
 * Camera presets for the showcase plus a gentle idle sway in 3D, which stops
 * for good once the user takes control.
 */
export class CameraRig {
  private swayOffset = 0
  private swaying = true
  /** When the current sway began, so it always starts from the preset angle. */
  private swayStart: number | null = null

  /** Resets the view for `mode`: front-on in 2D, slightly from above in 3D. */
  apply(scene: SceneTemplate, mode: SceneCameraMode): void {
    const camera = scene.getCameraController()
    scene.setCameraMode(mode)
    camera.setTarget(0, 0, mode === 'perspective3d' ? TARGET_DEPTH : 0)
    camera.setPosition(0, 0, EYE_DISTANCE)
    this.swayOffset = 0
    this.swayStart = null
    if (mode === 'ortho2d') {
      camera.setOrthoHalfHeight(ORTHO_HALF_HEIGHT)
    } else {
      camera.orbit(0, INITIAL_ELEVATION_RAD)
    }
  }

  /** Stops the idle sway (called on the first drag, pinch or wheel). */
  stopSway(): void {
    this.swaying = false
  }

  resumeSway(): void {
    this.swaying = true
  }

  /** Advances the idle sway; only moves a 3D camera. */
  update(scene: SceneTemplate, timeSeconds: number): void {
    const camera = scene.getCameraController()
    if (!this.swaying || camera.getMode() !== '3d') return
    this.swayStart ??= timeSeconds
    const phase = ((timeSeconds - this.swayStart) / SWAY_PERIOD_S) * 2 * Math.PI
    const next = Math.sin(phase) * SWAY_AMPLITUDE_RAD
    camera.orbit(next - this.swayOffset, 0)
    this.swayOffset = next
  }
}
