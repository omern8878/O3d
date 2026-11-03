/** Camera projection used when deciding drag vs pan. */
export type PanCameraMode = '2d' | '3d'

/** Modifier and button state that can force a 3D drag to pan. */
export type PanPointerModifiers = {
  shiftKey: boolean
  /** Windows / Linux Control key. */
  ctrlKey: boolean
  /** macOS Command key (`metaKey` on `PointerEvent`). */
  metaKey: boolean
  /** Bitmask from `PointerEvent.buttons` (2 = secondary / right). */
  buttons: number
}

const SECONDARY_BUTTON = 2

/**
 * Whether a pointer drag should pan the camera instead of orbiting.
 *
 * Always pans in 2D. In 3D, pan when Shift, Ctrl (Windows/Linux), Cmd (macOS),
 * or the secondary mouse button is held.
 */
export function shouldPanCamera(mode: PanCameraMode, modifiers: PanPointerModifiers): boolean {
  if (mode === '2d') return true
  return (
    modifiers.shiftKey ||
    modifiers.ctrlKey ||
    modifiers.metaKey ||
    (modifiers.buttons & SECONDARY_BUTTON) !== 0
  )
}
