import { PathDataScanner } from './path-data-scanner.ts'
import type { Polyline } from './polyline.types.ts'

/** Curves are split so each straight segment is at most this long (SVG units). */
const DEFAULT_SEGMENT_LENGTH = 2
const MIN_CURVE_SEGMENTS = 2
const MAX_CURVE_SEGMENTS = 96

/**
 * Converts SVG path data into polylines, flattening every curve (cubic,
 * quadratic, smooth variants and elliptical arcs) into short line segments.
 * Malformed trailing data is ignored rather than thrown on.
 */
export function flattenPathData(
  d: string,
  segmentLength: number = DEFAULT_SEGMENT_LENGTH,
): Polyline[] {
  return new PathFlattener(segmentLength).flatten(d)
}

class PathFlattener {
  private readonly segmentLength: number
  private readonly polylines: Polyline[] = []
  private current: Polyline | null = null
  private x = 0
  private y = 0
  private startX = 0
  private startY = 0
  /** Reflected control point for `S` / `T`, or `null` after other commands. */
  private lastCubicControl: [number, number] | null = null
  private lastQuadControl: [number, number] | null = null

  constructor(segmentLength: number) {
    this.segmentLength = Math.max(segmentLength, 1e-3)
  }

  flatten(d: string): Polyline[] {
    const scanner = new PathDataScanner(d)
    let command: string | null = null
    while (!scanner.isDone()) {
      const next = scanner.readCommand()
      if (next !== null) {
        command = next
      } else if (command === null || command === 'Z' || command === 'z' || !scanner.hasNumber()) {
        // Numbers after Z (which takes none) or stray characters are skipped.
        scanner.skipCharacter()
        continue
      }
      if (!this.runCommand(command!, scanner)) break
      // After a moveto, further coordinate pairs are implicit linetos.
      if (command === 'M') command = 'L'
      if (command === 'm') command = 'l'
    }
    this.finishPolyline()
    return this.polylines
  }

  /** Executes one command; returns `false` when its arguments are malformed. */
  private runCommand(command: string, s: PathDataScanner): boolean {
    const relative = command === command.toLowerCase()
    const ox = relative ? this.x : 0
    const oy = relative ? this.y : 0
    const upper = command.toUpperCase()

    if (upper === 'Z') {
      if (this.current) {
        this.current.closed = true
        this.finishPolyline()
      }
      this.x = this.startX
      this.y = this.startY
      this.resetControls()
      return true
    }

    const args = readArgs(s, upper)
    if (args === null) return false
    switch (upper) {
      case 'M':
        this.finishPolyline()
        this.x = this.startX = ox + args[0]!
        this.y = this.startY = oy + args[1]!
        this.current = { points: [this.x, this.y], closed: false }
        this.resetControls()
        return true
      case 'L':
        this.lineTo(ox + args[0]!, oy + args[1]!)
        return true
      case 'H':
        this.lineTo(ox + args[0]!, this.y)
        return true
      case 'V':
        this.lineTo(this.x, (relative ? this.y : 0) + args[0]!)
        return true
      case 'C':
        this.cubicTo(ox + args[0]!, oy + args[1]!, ox + args[2]!, oy + args[3]!, ox + args[4]!, oy + args[5]!)
        return true
      case 'S': {
        const [c1x, c1y] = this.reflect(this.lastCubicControl)
        this.cubicTo(c1x, c1y, ox + args[0]!, oy + args[1]!, ox + args[2]!, oy + args[3]!)
        return true
      }
      case 'Q':
        this.quadTo(ox + args[0]!, oy + args[1]!, ox + args[2]!, oy + args[3]!)
        return true
      case 'T': {
        const [cx, cy] = this.reflect(this.lastQuadControl)
        this.quadTo(cx, cy, ox + args[0]!, oy + args[1]!)
        return true
      }
      case 'A':
        this.arcTo(args, ox, oy)
        return true
      default:
        return false
    }
  }

  private lineTo(x: number, y: number): void {
    this.ensurePolyline()
    this.current!.points.push(x, y)
    this.x = x
    this.y = y
    this.resetControls()
  }

  private cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    this.ensurePolyline()
    const { x: x0, y: y0 } = this
    const length = Math.hypot(c1x - x0, c1y - y0) + Math.hypot(c2x - c1x, c2y - c1y) + Math.hypot(x - c2x, y - c2y)
    const steps = this.stepsFor(length)
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const a = u * u * u
      const b = 3 * u * u * t
      const c = 3 * u * t * t
      const e = t * t * t
      this.current!.points.push(a * x0 + b * c1x + c * c2x + e * x, a * y0 + b * c1y + c * c2y + e * y)
    }
    this.x = x
    this.y = y
    this.lastCubicControl = [c2x, c2y]
    this.lastQuadControl = null
  }

  private quadTo(cx: number, cy: number, x: number, y: number): void {
    this.ensurePolyline()
    const { x: x0, y: y0 } = this
    const steps = this.stepsFor(Math.hypot(cx - x0, cy - y0) + Math.hypot(x - cx, y - cy))
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      this.current!.points.push(u * u * x0 + 2 * u * t * cx + t * t * x, u * u * y0 + 2 * u * t * cy + t * t * y)
    }
    this.x = x
    this.y = y
    this.lastQuadControl = [cx, cy]
    this.lastCubicControl = null
  }

  /** Elliptical arc via the SVG spec's endpoint-to-center conversion (F.6.5). */
  private arcTo(args: number[], ox: number, oy: number): void {
    const [rxIn, ryIn, rotationDeg, largeArc, sweep, xIn, yIn] = args as [
      number, number, number, number, number, number, number,
    ]
    const x = ox + xIn
    const y = oy + yIn
    let rx = Math.abs(rxIn)
    let ry = Math.abs(ryIn)
    if (rx === 0 || ry === 0 || (x === this.x && y === this.y)) {
      this.lineTo(x, y)
      return
    }

    const phi = (rotationDeg * Math.PI) / 180
    const cos = Math.cos(phi)
    const sin = Math.sin(phi)
    const dx = (this.x - x) / 2
    const dy = (this.y - y) / 2
    const x1 = cos * dx + sin * dy
    const y1 = -sin * dx + cos * dy

    const radiiScale = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
    if (radiiScale > 1) {
      rx *= Math.sqrt(radiiScale)
      ry *= Math.sqrt(radiiScale)
    }
    const numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
    const denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
    const sign = largeArc === sweep ? -1 : 1
    const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator))
    const cxp = (coefficient * rx * y1) / ry
    const cyp = (-coefficient * ry * x1) / rx
    const cx = cos * cxp - sin * cyp + (this.x + x) / 2
    const cy = sin * cxp + cos * cyp + (this.y + y) / 2

    const startAngle = Math.atan2((y1 - cyp) / ry, (x1 - cxp) / rx)
    let sweepAngle = Math.atan2((-y1 - cyp) / ry, (-x1 - cxp) / rx) - startAngle
    if (sweep && sweepAngle < 0) sweepAngle += 2 * Math.PI
    if (!sweep && sweepAngle > 0) sweepAngle -= 2 * Math.PI

    this.ensurePolyline()
    const steps = this.stepsFor(Math.abs(sweepAngle) * Math.max(rx, ry))
    for (let i = 1; i <= steps; i++) {
      const angle = startAngle + (sweepAngle * i) / steps
      const ex = rx * Math.cos(angle)
      const ey = ry * Math.sin(angle)
      this.current!.points.push(cos * ex - sin * ey + cx, sin * ex + cos * ey + cy)
    }
    this.x = x
    this.y = y
    this.resetControls()
  }

  private stepsFor(length: number): number {
    const steps = Math.ceil(length / this.segmentLength)
    return Math.min(MAX_CURVE_SEGMENTS, Math.max(MIN_CURVE_SEGMENTS, steps))
  }

  private reflect(control: [number, number] | null): [number, number] {
    return control ? [2 * this.x - control[0], 2 * this.y - control[1]] : [this.x, this.y]
  }

  private resetControls(): void {
    this.lastCubicControl = null
    this.lastQuadControl = null
  }

  /** Drawing without a preceding moveto (or after `Z`) starts at the current point. */
  private ensurePolyline(): void {
    if (!this.current) {
      this.current = { points: [this.x, this.y], closed: false }
    }
  }

  private finishPolyline(): void {
    if (this.current && this.current.points.length >= 4) {
      this.polylines.push(this.current)
    }
    this.current = null
  }
}

const ARG_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7 }

/** Reads one command's arguments, or `null` if any is missing or not finite. */
function readArgs(s: PathDataScanner, upper: string): number[] | null {
  const count = ARG_COUNTS[upper] ?? 0
  const args: number[] = []
  for (let i = 0; i < count; i++) {
    const isArcFlag = upper === 'A' && (i === 3 || i === 4)
    const value = isArcFlag ? (s.readFlag() ? 1 : 0) : s.readNumber()
    if (!Number.isFinite(value)) return null
    args.push(value)
  }
  return args
}
