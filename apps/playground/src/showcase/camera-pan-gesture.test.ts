import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldPanCamera, type PanPointerModifiers } from './camera-pan-gesture.ts'

const free: PanPointerModifiers = {
  shiftKey: false,
  ctrlKey: false,
  metaKey: false,
  buttons: 1,
}

describe('shouldPanCamera', () => {
  it('always pans in 2D, even without modifiers', () => {
    assert.equal(shouldPanCamera('2d', free), true)
  })

  it('orbits in 3D with a primary-button drag and no modifiers', () => {
    assert.equal(shouldPanCamera('3d', free), false)
  })

  it('pans in 3D when Shift is held', () => {
    assert.equal(shouldPanCamera('3d', { ...free, shiftKey: true }), true)
  })

  it('pans in 3D when Ctrl is held (Windows / Linux)', () => {
    assert.equal(shouldPanCamera('3d', { ...free, ctrlKey: true }), true)
  })

  it('pans in 3D when Cmd is held (macOS metaKey)', () => {
    assert.equal(shouldPanCamera('3d', { ...free, metaKey: true }), true)
  })

  it('pans in 3D when the secondary (right) button is held', () => {
    assert.equal(shouldPanCamera('3d', { ...free, buttons: 2 }), true)
  })

  it('pans when primary and secondary buttons are both down', () => {
    assert.equal(shouldPanCamera('3d', { ...free, buttons: 1 | 2 }), true)
  })
})
