const FPS_WINDOW_MS = 500
const SMOOTHING = 0.1

/** Frames per second (counted over half-second windows) and smoothed CPU frame time. */
export class FrameTelemetry {
  fps = 0
  frameMs = 0
  private windowStart = -1
  private framesInWindow = 0

  /** Call once per frame with the timestamp and the CPU time the frame took. */
  record(now: number, cpuMs: number): void {
    this.frameMs = this.frameMs === 0 ? cpuMs : this.frameMs + (cpuMs - this.frameMs) * SMOOTHING
    if (this.windowStart < 0) this.windowStart = now
    this.framesInWindow++
    const elapsed = now - this.windowStart
    if (elapsed >= FPS_WINDOW_MS) {
      this.fps = (this.framesInWindow * 1000) / elapsed
      this.windowStart = now
      this.framesInWindow = 0
    }
  }
}
