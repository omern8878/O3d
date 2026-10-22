import type { SceneTemplate } from '@engine/templates'

/** Movement (CSS px) below which a press-and-release counts as a tap. */
const TAP_SLOP_PX = 5
const ORBIT_RAD_PER_PX = 0.008
const WHEEL_ZOOM_PER_PIXEL = 0.0015

export type PointerControlHandlers = {
  /** A tap or click that did not drag. */
  onTap(clientX: number, clientY: number): void
  /** The user started steering the camera. */
  onCameraInteraction(): void
}

/**
 * Mouse and touch camera controls: drag to orbit (3D) or pan (2D, or with
 * Shift / right button in 3D), wheel or pinch to zoom, tap to pick.
 */
export class PointerControls {
  private readonly canvas: HTMLCanvasElement
  private readonly getScene: () => SceneTemplate
  private readonly handlers: PointerControlHandlers
  private readonly pointers = new Map<number, { x: number; y: number }>()
  private pressStart: { x: number; y: number } | null = null
  private dragged = false
  private pinchDistance = 0

  constructor(canvas: HTMLCanvasElement, getScene: () => SceneTemplate, handlers: PointerControlHandlers) {
    this.canvas = canvas
    this.getScene = getScene
    this.handlers = handlers
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)
    canvas.addEventListener('wheel', this.onWheel, { passive: false })
    canvas.addEventListener('contextmenu', (event) => event.preventDefault())
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    this.canvas.setPointerCapture(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (this.pointers.size === 1) {
      this.pressStart = { x: event.clientX, y: event.clientY }
      this.dragged = false
    } else {
      this.pressStart = null // a second finger turns a tap into a pinch
      this.pinchDistance = this.currentPinchDistance()
    }
  }

  private readonly onPointerMove = (event: PointerEvent) => {
    const previous = this.pointers.get(event.pointerId)
    if (!previous) return
    const dx = event.clientX - previous.x
    const dy = event.clientY - previous.y
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })

    if (this.pointers.size >= 2) {
      this.pinch()
      return
    }
    if (this.pressStart && !this.dragged) {
      const moved = Math.hypot(event.clientX - this.pressStart.x, event.clientY - this.pressStart.y)
      if (moved < TAP_SLOP_PX) return
      this.dragged = true
      this.handlers.onCameraInteraction()
    }
    const camera = this.getScene().getCameraController()
    const pan = camera.getMode() === '2d' || event.shiftKey || (event.buttons & 2) !== 0
    if (pan) camera.panByPixels(dx, dy, this.canvas.clientHeight)
    else camera.orbit(-dx * ORBIT_RAD_PER_PX, dy * ORBIT_RAD_PER_PX)
  }

  private readonly onPointerUp = (event: PointerEvent) => {
    const wasTap = this.pressStart !== null && !this.dragged && this.pointers.size === 1
    this.pointers.delete(event.pointerId)
    if (wasTap && event.type === 'pointerup') this.handlers.onTap(event.clientX, event.clientY)
    if (this.pointers.size === 0) this.pressStart = null
    else this.pinchDistance = this.currentPinchDistance()
  }

  private readonly onWheel = (event: WheelEvent) => {
    event.preventDefault()
    this.handlers.onCameraInteraction()
    this.getScene().getCameraController().zoom(Math.exp(event.deltaY * WHEEL_ZOOM_PER_PIXEL))
  }

  private pinch(): void {
    const distance = this.currentPinchDistance()
    if (this.pinchDistance > 0 && distance > 0) {
      this.handlers.onCameraInteraction()
      this.getScene().getCameraController().zoom(this.pinchDistance / distance)
    }
    this.pinchDistance = distance
  }

  private currentPinchDistance(): number {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }
}
