import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { before, describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { CameraController, initEngine } from '@engine/templates'
import type { BenchCamera } from '../competitor.types.ts'
import { frustumPlanes, invert, multiply, sphereInFrustum, transformPoint, viewProjection } from './camera-math.ts'

const CAMERA: BenchCamera = { eye: [30, 40, 300], target: [5, -10, 0], fovY: Math.PI / 4, aspect: 16 / 9, near: 0.1, far: 1000 }

describe('camera math', () => {
  before(async () => {
    await initEngine({ module_or_path: readFileSync(fileURLToPath(import.meta.resolve('@engine/core/pkg/engine_bg.wasm'))) })
  })

  it("matches the engine's Wasm view-projection matrix", () => {
    const engine = new CameraController({ mode: '3d', aspect: CAMERA.aspect })
    engine.setTarget(...CAMERA.target)
    engine.setPosition(...CAMERA.eye)
    const ours = viewProjection(CAMERA)
    const theirs = engine.getViewProjection()
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(ours[i]! - theirs[i]!) < 1e-4, `m[${i}]`)
  })

  it('maps the target to the screen centre and depth into [0, 1]', () => {
    const [x, y, z] = transformPoint(viewProjection(CAMERA), ...CAMERA.target)
    assert.ok(Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9)
    assert.ok(z > 0 && z < 1)
  })

  it('inverts to the identity and rejects singular matrices', () => {
    const m = viewProjection(CAMERA)
    const identity = multiply(m, invert(m)!)
    identity.forEach((v, i) => assert.ok(Math.abs(v - (i % 5 === 0 ? 1 : 0)) < 1e-9))
    assert.equal(invert(new Float64Array(16)), null)
  })

  it('tests spheres against the frustum', () => {
    const planes = frustumPlanes(viewProjection(CAMERA))
    assert.equal(sphereInFrustum(planes, ...CAMERA.target, 1), true)
    assert.equal(sphereInFrustum(planes, 0, 0, 5000, 1), false, 'behind the camera')
    assert.equal(sphereInFrustum(planes, 10_000, 0, 0, 1), false, 'far to the side')
  })
})
