import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PointCloud } from '../cloud/point-cloud.types.ts'
import { createPresets } from '../presets/preset-catalog.ts'
import type { PixelImage } from '../raster/pixel-cloud-sampler.ts'
import { CAT_SVG } from '../vector/cat-vector-svg.ts'
import { parseSvgDocument } from '../vector/svg-document-parser.ts'
import { createObjSource } from './obj-source.ts'
import { liftDarkDrawing } from './svg-contrast.ts'
import { createSvgSource } from './svg-source.ts'
import { detectImportKind, sourceFromFile } from './source-from-file.ts'

/** A fake browser rasterizer: a 2 x 1 image with one red pixel. */
let rasterCalls = 0
const fakeRasterize = async (): Promise<PixelImage> => {
  rasterCalls++
  return { data: new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), width: 2, height: 1 }
}

function assertCanonical(cloud: PointCloud): void {
  let extent = 0
  for (const value of cloud.positions) {
    assert.ok(Number.isFinite(value))
    extent = Math.max(extent, Math.abs(value))
  }
  assert.ok(extent > 9.5 && extent <= 10.001, `largest coordinate ${extent}`)
}

describe('SVG sources', () => {
  it('samples vector SVGs into canonical space with a tail sway at the given pivot', async () => {
    const source = createSvgSource(CAT_SVG, { id: 'cat', label: 'Cat', builtIn: true, tailPivot: { x: 308, y: 430 } }, fakeRasterize)
    const built = await source.build(5_000)
    assert.equal(built.cloud.count, 5_000)
    assertCanonical(built.cloud)
    assert.equal(built.slice?.layer, 'tail')
    assert.equal(built.slice?.kind, 'sway')
    assert.ok(built.slice!.pivot![0] > 0 && built.slice!.pivot![1] < 0, 'the hip is right of centre, below it')
  })

  it('falls back to rasterizing when nothing is vector-paintable or text is present', async () => {
    rasterCalls = 0
    const source = (markup: string) => createSvgSource(markup, { id: 'x', label: 'x', builtIn: false }, fakeRasterize)
    const empty = await source('<svg viewBox="0 0 10 10"><rect width="0" height="0"/></svg>').build(100)
    const text = await source('<svg viewBox="0 0 10 10"><rect width="5" height="5"/><text>Hi</text></svg>').build(100)
    const garbage = await source('not even xml').build('auto')

    assert.equal(rasterCalls, 3)
    assert.match(empty.detail, /rasterized \(no vector shapes\)/)
    assert.match(text.detail, /rasterized \(text or images\)/)
    assert.equal(garbage.cloud.count, 50_000)
    assert.deepEqual([...text.cloud.colors.subarray(0, 3)], [1, 0, 0])
  })

  it('lifts an all-dark drawing so it shows on the dark background, but not a bright one', () => {
    const dark = parseSvgDocument('<svg viewBox="0 0 10 10"><rect width="5" height="5" fill="#000"/><circle r="2" stroke="#111" fill="none"/></svg>')
    assert.equal(liftDarkDrawing(dark), true)
    assert.ok(dark.shapes[0]!.fill![0] > 0.6)
    const cat = parseSvgDocument(CAT_SVG)
    const pupils = cat.shapes.find((s) => s.name === 'pupils')!.fill
    assert.equal(liftDarkDrawing(cat), false)
    assert.deepEqual(cat.shapes.find((s) => s.name === 'pupils')!.fill, pupils)
  })
})

describe('OBJ sources and file detection', () => {
  const quadPair = 'v 0 0 0\nv 4 0 0\nv 4 2 0\nv 0 2 0\nv 0 0 1\nv 1 0 1\nv 0 1 1\ng big\nf 1 2 3 4\ng small\nf 5 6 7'

  it('builds a canonical, surface-sampled cloud and spins the smallest group', async () => {
    const built = await createObjSource(quadPair, { id: 'm', label: 'm.obj', builtIn: false }).build(2_000)
    assert.equal(built.cloud.count, 2_000)
    assertCanonical(built.cloud)
    assert.deepEqual(built.slice, { layer: 'small', kind: 'spin' })
    assert.match(built.detail, /surface-sampled from 7 vertices \/ 3 triangles/)
  })

  it('detects files by extension, then by content', () => {
    assert.equal(detectImportKind('a.SVG', ''), 'svg')
    assert.equal(detectImportKind('model.obj', ''), 'obj')
    assert.equal(detectImportKind('blob', '<?xml version="1.0"?><svg viewBox="0 0 1 1"/>'), 'svg')
    assert.equal(detectImportKind('blob', '# exported\nv 1.0 2 3\n'), 'obj')
    assert.equal(detectImportKind('notes.txt', 'hello'), null)
    assert.throws(() => sourceFromFile('notes.txt', 'hello', fakeRasterize), /not an SVG or OBJ/)
    assert.equal(sourceFromFile('m.obj', quadPair, fakeRasterize).dimension, '3d')
  })
})

describe('presets', () => {
  const presets = createPresets(fakeRasterize)

  for (const [id, expectedSlice] of [['cat', 'tail'], ['teapot', 'steam'], ['knot', 'pulse'], ['galaxy', 'core']] as const) {
    it(`${id} builds a canonical cloud whose sub-slice layer exists`, async () => {
      const built = await presets[id].build(8_000)
      assertCanonical(built.cloud)
      const layer = built.cloud.layers.find((l) => l.name === built.slice?.layer)
      assert.equal(built.slice?.layer, expectedSlice)
      assert.ok(layer && layer.end > layer.start)
      assert.equal(built.cloud.count >= 8_000, true)
    })
  }

  it('the teapot has body, lid, spout, handle and steam; 3D presets say so', async () => {
    const built = await presets.teapot.build(10_000)
    assert.deepEqual(built.cloud.layers.map((l) => l.name), ['body', 'lid', 'spout', 'handle', 'steam'])
    assert.equal(presets.teapot.dimension, '3d')
    assert.equal(presets.cat.dimension, '2d')
  })
})
