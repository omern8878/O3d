import type { BenchCamera, Vec3 } from '../competitor.types.ts'

/** Column-major 4x4 matrix, element `(row, col)` at `m[col * 4 + row]`. */
export type Mat4 = Float64Array

/**
 * `projection * view` for a {@link BenchCamera}, built exactly like the
 * engine's Rust camera: right-handed, WebGPU `[0, 1]` depth.
 */
export function viewProjection(camera: BenchCamera): Mat4 {
  return multiply(
    perspectiveRhZo(camera.fovY, camera.aspect, camera.near, camera.far),
    lookAtRh(camera.eye, camera.target, [0, 1, 0]),
  )
}

export function perspectiveRhZo(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2)
  const m = new Float64Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = far / (near - far)
  m[11] = -1
  m[14] = (near * far) / (near - far)
  return m
}

export function lookAtRh(eye: Vec3, target: Vec3, up: Vec3): Mat4 {
  const f = normalize(sub(target, eye))
  const s = normalize(cross(f, up))
  const u = cross(s, f)
  const m = new Float64Array(16)
  m[0] = s[0]; m[4] = s[1]; m[8] = s[2]
  m[1] = u[0]; m[5] = u[1]; m[9] = u[2]
  m[2] = -f[0]; m[6] = -f[1]; m[10] = -f[2]
  m[12] = -dot(s, eye)
  m[13] = -dot(u, eye)
  m[14] = dot(f, eye)
  m[15] = 1
  return m
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16)
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!
      out[col * 4 + row] = sum
    }
  }
  return out
}

/** Cofactor inverse, or `null` when singular. */
export function invert(a: Mat4): Mat4 | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] =
    a as unknown as number[]
  const b00 = a00! * a11! - a01! * a10!, b01 = a00! * a12! - a02! * a10!
  const b02 = a00! * a13! - a03! * a10!, b03 = a01! * a12! - a02! * a11!
  const b04 = a01! * a13! - a03! * a11!, b05 = a02! * a13! - a03! * a12!
  const b06 = a20! * a31! - a21! * a30!, b07 = a20! * a32! - a22! * a30!
  const b08 = a20! * a33! - a23! * a30!, b09 = a21! * a32! - a22! * a31!
  const b10 = a21! * a33! - a23! * a31!, b11 = a22! * a33! - a23! * a32!
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
  if (!Number.isFinite(det) || det === 0) return null
  const k = 1 / det
  return Float64Array.of(
    (a11! * b11 - a12! * b10 + a13! * b09) * k, (a02! * b10 - a01! * b11 - a03! * b09) * k,
    (a31! * b05 - a32! * b04 + a33! * b03) * k, (a22! * b04 - a21! * b05 - a23! * b03) * k,
    (a12! * b08 - a10! * b11 - a13! * b07) * k, (a00! * b11 - a02! * b08 + a03! * b07) * k,
    (a32! * b02 - a30! * b05 - a33! * b01) * k, (a20! * b05 - a22! * b02 + a23! * b01) * k,
    (a10! * b10 - a11! * b08 + a13! * b06) * k, (a01! * b08 - a00! * b10 - a03! * b06) * k,
    (a30! * b04 - a31! * b02 + a33! * b00) * k, (a21! * b02 - a20! * b04 - a23! * b00) * k,
    (a11! * b07 - a10! * b09 - a12! * b06) * k, (a00! * b09 - a01! * b07 + a02! * b06) * k,
    (a31! * b01 - a30! * b03 - a32! * b00) * k, (a20! * b03 - a21! * b01 + a22! * b00) * k,
  )
}

/** Applies `m` to `(x, y, z, 1)` and divides by `w`. */
export function transformPoint(m: Mat4, x: number, y: number, z: number): Vec3 {
  const w = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!
  return [
    (m[0]! * x + m[4]! * y + m[8]! * z + m[12]!) / w,
    (m[1]! * x + m[5]! * y + m[9]! * z + m[13]!) / w,
    (m[2]! * x + m[6]! * y + m[10]! * z + m[14]!) / w,
  ]
}

/**
 * The six frustum planes `(a, b, c, d)` (normalized, inside >= 0) extracted
 * Gribb-Hartmann style for `[0, 1]` depth: near = row 2, far = row 3 - row 2.
 */
export function frustumPlanes(m: Mat4): Float64Array {
  const row = (r: number) => [m[r]!, m[4 + r]!, m[8 + r]!, m[12 + r]!]
  const [r0, r1, r2, r3] = [row(0), row(1), row(2), row(3)]
  const combos = [
    r3.map((v, i) => v + r0[i]!), r3.map((v, i) => v - r0[i]!),
    r3.map((v, i) => v + r1[i]!), r3.map((v, i) => v - r1[i]!),
    r2, r3.map((v, i) => v - r2[i]!),
  ]
  const planes = new Float64Array(24)
  combos.forEach((p, i) => {
    const length = Math.hypot(p[0]!, p[1]!, p[2]!)
    for (let k = 0; k < 4; k++) planes[i * 4 + k] = p[k]! / length
  })
  return planes
}

export function sphereInFrustum(planes: Float64Array, x: number, y: number, z: number, radius: number): boolean {
  for (let p = 0; p < 24; p += 4) {
    if (planes[p]! * x + planes[p + 1]! * y + planes[p + 2]! * z + planes[p + 3]! < -radius) return false
  }
  return true
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}
