import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeCloud, CANONICAL_HALF_EXTENT } from '../cloud/normalize-cloud.ts'
import { chooseMeshCloud, meshToCloud } from './mesh-cloud.ts'
import { sampleMeshSurface } from './mesh-surface-sampler.ts'
import { meshVertexCloud } from './mesh-vertex-cloud.ts'
import { parseObj } from './obj-parser.ts'

/** Two triangles in the z = 0 plane: `small` has area 0.5, `large` area 1.5. */
const TWO_GROUPS = parseObj(`
  v 0 0 0
  v 1 0 0
  v 0 1 0
  v 10 0 0
  v 13 0 0
  v 10 1 0
  g small
  f 1 2 3
  g large
  f 4 5 6
`)

describe('mesh surface sampling', () => {
  it('produces exactly the requested count, split by area into contiguous layers', () => {
    const cloud = sampleMeshSurface(TWO_GROUPS, 4_000)
    assert.equal(cloud.count, 4_000)
    assert.deepEqual(cloud.layers.map((l) => [l.name, l.start, l.end]), [['small', 0, 1_000], ['large', 1_000, 4_000]])
  })

  it('places every point on its triangle (barycentric, inside the edges)', () => {
    const cloud = sampleMeshSurface(TWO_GROUPS, 2_000)
    for (let i = 0; i < cloud.count; i++) {
      const [x, y, z] = [cloud.positions[i * 3]!, cloud.positions[i * 3 + 1]!, cloud.positions[i * 3 + 2]!]
      assert.equal(z, 0)
      const local = i < 500 ? x : (x - 10) / 3
      assert.ok(local >= -1e-5 && y >= -1e-5 && local + y <= 1 + 1e-5, `point ${i} off its triangle`)
    }
  })

  it('weights triangles within a group by area', () => {
    // One group: a triangle of area 0.5 and one of area 1.5.
    const mesh = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 10 0 0\nv 13 0 0\nv 10 1 0\nf 1 2 3\nf 4 5 6')
    const cloud = sampleMeshSurface(mesh, 20_000)
    let onLarge = 0
    for (let i = 0; i < cloud.count; i++) if (cloud.positions[i * 3]! >= 9.99) onLarge++
    assert.ok(Math.abs(onLarge / cloud.count - 0.75) < 0.02, `large share ${onLarge / cloud.count}`)
  })

  it('shades faces and honours vertex colours', () => {
    const coloured = parseObj('v 0 0 0 1 0 0\nv 1 0 0 1 0 0\nv 0 1 0 1 0 0\nf 1 2 3')
    const cloud = sampleMeshSurface(coloured, 10)
    assert.deepEqual([...cloud.colors.subarray(0, 3)], [1, 0, 0])
    const plain = sampleMeshSurface(TWO_GROUPS, 10)
    assert.ok(plain.colors.every((c) => c > 0 && c <= 1))
  })

  it('sizes particles by sqrt(area / N): 4x the points, half the size', () => {
    const few = sampleMeshSurface(TWO_GROUPS, 1_000).scales[0]!
    const many = sampleMeshSurface(TWO_GROUPS, 4_000).scales[0]!
    assert.ok(Math.abs(few / many - 2) < 1e-6)
  })

  it('rejects a mesh with no area', () => {
    assert.throws(() => sampleMeshSurface(parseObj('v 0 0 0\nv 1 0 0\nv 2 0 0\nf 1 2 3'), 10), /no surface area/)
  })
})

describe('native vertex clouds', () => {
  it('maps vertices 1:1, grouped into contiguous layers, loose points last', () => {
    const mesh = parseObj('v 0 0 0\nv 9 9 9\nv 1 0 0\nv 0 1 0\ng a\nf 1 3 4')
    const cloud = meshVertexCloud(mesh)
    assert.equal(cloud.count, 4)
    assert.deepEqual(cloud.layers.map((l) => [l.name, l.start, l.end]), [['a', 0, 3], ['points', 3, 4]])
    assert.deepEqual([...cloud.positions.subarray(9, 12)], [9, 9, 9])
  })

  it('strides or repeats vertices to reach a requested count', () => {
    const points = parseObj('v 0 0 0\nv 1 0 0\nv 2 0 0\nv 3 0 0')
    assert.deepEqual([...meshVertexCloud(points, 2).positions].filter((_, i) => i % 3 === 0), [0, 2])
    assert.equal(meshVertexCloud(points, 10).count, 10)
  })
})

describe('chooseMeshCloud / meshToCloud', () => {
  it('auto: samples light meshes by complexity, keeps dense meshes native', () => {
    assert.deepEqual(chooseMeshCloud(TWO_GROUPS, 'auto'), { mode: 'surface-sampled', count: 50_000 })
    const dense = { ...TWO_GROUPS, positions: new Float32Array(3 * 60_000) }
    assert.deepEqual(chooseMeshCloud(dense, 'auto'), { mode: 'native-vertices', count: 60_000 })
    const pointsOnly = parseObj('v 0 0 0\nv 1 1 1')
    assert.deepEqual(chooseMeshCloud(pointsOnly, 'auto'), { mode: 'native-vertices', count: 2 })
  })

  it('an explicit count is exact and uncapped', () => {
    assert.equal(meshToCloud(TWO_GROUPS, 1_234).count, 1_234)
    assert.deepEqual(chooseMeshCloud(TWO_GROUPS, 2_000_000), { mode: 'surface-sampled', count: 2_000_000 })
  })

  it('rejects an OBJ without vertices', () => {
    assert.throws(() => meshToCloud(parseObj('# empty'), 'auto'), /no vertices/)
  })
})

describe('normalizeCloud', () => {
  it('centres the bounding box and fits the longest axis to [-10, 10], scaling sizes too', () => {
    const cloud = sampleMeshSurface(TWO_GROUPS, 3_000)
    const size = cloud.scales[0]!
    const transform = normalizeCloud(cloud)

    const extent = [0, 1, 2].map((axis) => {
      const values = cloud.positions.filter((_, i) => i % 3 === axis)
      return [Math.min(...values), Math.max(...values)]
    })
    assert.ok(Math.abs(extent[0]![0]! + CANONICAL_HALF_EXTENT) < 1e-3 && Math.abs(extent[0]![1]! - CANONICAL_HALF_EXTENT) < 1e-3)
    assert.ok(Math.abs(extent[1]![0]! + extent[1]![1]!) < 1e-3, 'y centred')
    assert.ok(Math.abs(cloud.scales[0]! - size * transform.scale) < 1e-6)
    assert.deepEqual(transform.apply(...transform.center), [0, 0, 0], 'the box centre maps to the origin')
    assert.ok(Math.abs(transform.center[0] - 6.5) < 0.05 && Math.abs(transform.center[1] - 0.5) < 0.05)
  })
})
