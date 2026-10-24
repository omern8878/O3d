import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseObj } from './obj-parser.ts'

const tri = (mesh: ReturnType<typeof parseObj>) => [...mesh.triangles]

describe('parseObj', () => {
  it('reads every face index form', () => {
    const mesh = parseObj(`
      v 0 0 0
      v 1 0 0
      v 0 1 0
      vt 0 0
      vn 0 0 1
      f 1 2 3
      f 1/1 2/1 3/1
      f 1//1 2//1 3//1
      f 1/1/1 2/1/1 3/1/1
    `)
    assert.equal(mesh.positions.length, 9)
    assert.deepEqual(tri(mesh), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2])
    assert.equal(mesh.cornerNormals, null, 'normals only when every corner has one')
  })

  it('resolves negative (relative) indices against the vertices so far', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\nv 5 5 5\nf -4 -1 -2')
    assert.deepEqual(tri(mesh), [0, 1, 2, 0, 3, 2])
  })

  it('fan-triangulates quads and n-gons', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nv -1 0.5 0\nf 1 2 3 4\nf 1 2 3 4 5')
    assert.deepEqual(tri(mesh), [0, 1, 2, 0, 2, 3, 0, 1, 2, 0, 2, 3, 0, 3, 4])
  })

  it('keeps per-corner normals when every face has them', () => {
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 1\nvn 0 1 0\nf 1//1 2//2 3//-1')
    assert.deepEqual([...mesh.cornerNormals!], [0, 0, 1, 0, 1, 0, 0, 1, 0])
  })

  it('makes every o / g / usemtl section one contiguous group, even when revisited', () => {
    const mesh = parseObj(`
      v 0 0 0
      v 1 0 0
      v 0 1 0
      f 1 2 3
      g lid
      f 1 2 3
      usemtl spout
      f 1 2 3
      g lid
      f 3 2 1
    `)
    assert.deepEqual(mesh.groups, [
      { name: 'mesh', start: 0, end: 1 },
      { name: 'lid', start: 1, end: 3 },
      { name: 'spout', start: 3, end: 4 },
    ])
    assert.deepEqual(tri(mesh).slice(3, 9), [0, 1, 2, 2, 1, 0])
  })

  it('reads vertex colours in 0..1 or 0..255, only when every vertex has one', () => {
    assert.deepEqual([...parseObj('v 0 0 0 1 0.5 0\nv 1 1 1 0 0 1').vertexColors!], [1, 0.5, 0, 0, 0, 1])
    assert.deepEqual([...parseObj('v 0 0 0 255 0 51').vertexColors!], [1, 0, Math.fround(0.2)])
    assert.equal(parseObj('v 0 0 0 1 0 0\nv 1 1 1').vertexColors, null)
  })

  it('skips malformed lines and bad references instead of throwing', () => {
    const mesh = parseObj(`
      # comment
      v 0 0 0
      v 1 0 0 # trailing comment
      v 0 1 \\
        0
      v nope 1 2
      f 1 2
      f 1 2 9
      f 0 1 2
      f 1 2 3
      mtllib model.mtl
      s off
    `)
    assert.equal(mesh.positions.length, 9, 'the continued line is one vertex')
    assert.deepEqual(tri(mesh), [0, 1, 2])
    assert.equal(mesh.skippedLines, 4)
  })

  it('accepts a points-only OBJ and empty input', () => {
    assert.equal(parseObj('v 1 2 3\nv 4 5 6').triangles.length, 0)
    assert.equal(parseObj('').positions.length, 0)
  })
})
