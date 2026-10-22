/** A 2D affine transform `[a, b, c, d, e, f]`, as in SVG's `matrix(...)`. */
export type Affine = [number, number, number, number, number, number]

export const IDENTITY: Affine = [1, 0, 0, 1, 0, 0]

const FUNCTION_PATTERN = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g
const DEG_TO_RAD = Math.PI / 180

/** `outer ∘ inner`: applies `inner` first, then `outer`. */
export function multiply(outer: Affine, inner: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = outer
  const [a2, b2, c2, d2, e2, f2] = inner
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

export function applyAffine(m: Affine, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

/** Parses an SVG `transform` attribute; unknown or malformed parts are skipped. */
export function parseTransform(value: string | undefined): Affine {
  if (!value) return IDENTITY
  let result = IDENTITY
  for (const [, name, rawArgs] of value.matchAll(FUNCTION_PATTERN)) {
    const args = (rawArgs!.match(/-?[\d.]+(?:e-?\d+)?/gi) ?? []).map(Number)
    const step = transformFunction(name!, args)
    if (step) result = multiply(result, step)
  }
  return result
}

function transformFunction(name: string, args: number[]): Affine | null {
  const [p0 = 0, p1, p2, p3 = 0, p4 = 0, p5 = 0] = args
  switch (name) {
    case 'matrix':
      return args.length === 6 ? [p0, p1!, p2!, p3, p4, p5] : null
    case 'translate':
      return [1, 0, 0, 1, p0, p1 ?? 0]
    case 'scale':
      return [p0, 0, 0, p1 ?? p0, 0, 0]
    case 'rotate': {
      const angle = p0 * DEG_TO_RAD
      const rotation: Affine = [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]
      if (p1 === undefined || p2 === undefined) return rotation
      return multiply(multiply([1, 0, 0, 1, p1, p2], rotation), [1, 0, 0, 1, -p1, -p2])
    }
    case 'skewX':
      return [1, 0, Math.tan(p0 * DEG_TO_RAD), 1, 0, 0]
    case 'skewY':
      return [1, Math.tan(p0 * DEG_TO_RAD), 0, 1, 0, 0]
    default:
      return null
  }
}
