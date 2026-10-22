import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CAT_SVG } from './cat-vector-svg.ts'
import { parseSvgDocument } from './svg-document-parser.ts'

describe('parseSvgDocument', () => {
  it('reads the viewBox and every cat layer in document order', () => {
    const { viewBox, shapes } = parseSvgDocument(CAT_SVG)
    assert.deepEqual(viewBox, { x: 0, y: 0, width: 400, height: 480 })
    assert.equal(shapes[0]!.name, 'tail')
    assert.equal(shapes.filter((s) => s.name === 'whiskers').length, 6)
    assert.ok(shapes.find((s) => s.name === 'whiskers')!.stroke)
  })

  it('inherits paint from groups and lets inline style win over attributes', () => {
    const { shapes } = parseSvgDocument(
      `<svg viewBox="0 0 10 10"><g fill="red"><rect width="1" height="1"/><rect width="1" height="1" fill="blue" style="fill:#00ff00"/></g></svg>`,
    )
    assert.deepEqual(shapes.map((s) => s.fill), [[1, 0, 0], [0, 1, 0]])
  })

  it('applies nested transforms and scales stroke widths', () => {
    const { shapes } = parseSvgDocument(
      `<svg viewBox="0 0 100 100"><g transform="translate(10 20)"><line x1="0" y1="0" x2="1" y2="0" stroke="#fff" stroke-width="2" transform="scale(3)"/></g></svg>`,
    )
    assert.deepEqual(shapes[0]!.polylines[0]!.points, [10, 20, 13, 20])
    assert.equal(shapes[0]!.strokeWidth, 6)
  })

  it('skips defs, hidden elements and unpainted shapes, and survives odd markup', () => {
    const { shapes } = parseSvgDocument(`
      <svg viewBox="0 0 10 10">
        <defs><rect id="hidden-def" width="5" height="5"/></defs>
        <rect width="5" height="5" display="none"/>
        <rect width="5" height="5" fill="none"/>
        <path id="kept" d="M0 0h5v5z"><title>A path with a child</title></path>
        <rect id="after" width="1" height="1"/>
      </svg>`)
    assert.deepEqual(shapes.map((s) => s.name), ['kept', 'after'])
  })
})
