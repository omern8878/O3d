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
  it('applies <style> rules by tag, class and id, with inline style winning', () => {
    const { shapes } = parseSvgDocument(`
      <svg viewBox="0 0 10 10">
        <style><![CDATA[
          rect { fill: red }
          .accent, .other { fill: #00ff00; stroke: blue }
          #special.accent { fill: #0000ff }
        ]]></style>
        <rect id="plain" width="1" height="1"/>
        <rect id="classed" class="accent" width="1" height="1"/>
        <rect id="special" class="accent" width="1" height="1"/>
        <rect id="inline" class="accent" width="1" height="1" style="fill: white"/>
      </svg>`)
    const fills = Object.fromEntries(shapes.map((s) => [s.name, s.fill]))
    assert.deepEqual(fills, { plain: [1, 0, 0], classed: [0, 1, 0], special: [0, 0, 1], inline: [1, 1, 1] })
    assert.deepEqual(shapes[1]!.stroke, [0, 0, 1], 'class rules also set strokes')
  })

  it('resolves gradients to their average stop colour and currentColor to color', () => {
    const { shapes } = parseSvgDocument(`
      <svg viewBox="0 0 10 10" color="#ff0000">
        <defs>
          <linearGradient id="g"><stop offset="0" stop-color="#000000"/><stop offset="1" style="stop-color:#ffffff"/></linearGradient>
          <radialGradient id="alias" href="#g"/>
        </defs>
        <rect id="grad" width="1" height="1" fill="url(#g)"/>
        <rect id="alias-fill" width="1" height="1" fill="url('#alias')"/>
        <rect id="missing" width="1" height="1" fill="url(#nope) #00ff00"/>
        <rect id="current" width="1" height="1" fill="currentColor"/>
      </svg>`)
    const fills = Object.fromEntries(shapes.map((s) => [s.name, s.fill]))
    assert.deepEqual(fills.grad, [0.5, 0.5, 0.5])
    assert.deepEqual(fills['alias-fill'], [0.5, 0.5, 0.5], 'a stop-less gradient inherits through href')
    assert.deepEqual(fills.missing, [0, 1, 0], 'the url() fallback colour is used')
    assert.deepEqual(fills.current, [1, 0, 0])
  })

  it('never drops a shape over an unrecognized paint, and uses a light default fill', () => {
    const { shapes } = parseSvgDocument(`
      <svg viewBox="0 0 10 10">
        <rect id="unstyled" width="1" height="1"/>
        <rect id="exotic" width="1" height="1" fill="color(display-p3 1 0 0)"/>
        <rect id="ghost" width="1" height="1" fill-opacity="0"/>
      </svg>`)
    assert.deepEqual(shapes.map((s) => s.name), ['unstyled', 'exotic'])
    const [r, g, b] = shapes[0]!.fill!
    assert.ok(r > 0.8 && g > 0.8 && b > 0.8, 'not black on the dark background')
    assert.ok(shapes[1]!.fill, 'an exotic paint gets a visible fallback')
  })

  it('instantiates <use> references to shapes, placed at x, y with the use styles', () => {
    const { shapes } = parseSvgDocument(`
      <svg viewBox="0 0 100 100">
        <defs><rect id="tile" width="10" height="10"/></defs>
        <use href="#tile" x="20" y="30" fill="#ff0000"/>
        <use xlink:href="#tile" x="50" y="0" id="second" fill="#00ff00"/>
        <use href="#nowhere"/>
      </svg>`)
    assert.equal(shapes.length, 2)
    assert.deepEqual(shapes[0]!.polylines[0]!.points.slice(0, 2), [20, 30])
    assert.deepEqual(shapes[0]!.fill, [1, 0, 0])
    assert.equal(shapes[1]!.name, 'second')
  })

  it('handles stroke-only line art and documents without a viewBox', () => {
    const { viewBox, shapes } = parseSvgDocument(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <path d="M10 10 L60 10 L60 40" fill="none" stroke="#fff" stroke-width="3"/>
        <polyline points="0,50 30,80" stroke="#f00"/>
      </svg>`)
    assert.equal(shapes.length, 2)
    assert.equal(shapes[0]!.fill, null)
    assert.equal(shapes[0]!.strokeWidth, 3)
    assert.deepEqual(viewBox, { x: 0, y: 10, width: 60, height: 70 }, 'computed from the geometry')
  })

  it('flags text and images, which only rasterizing can show', () => {
    assert.equal(parseSvgDocument('<svg viewBox="0 0 10 10"><text x="1" y="5">Hi</text></svg>').hasRasterOnlyContent, true)
    assert.equal(parseSvgDocument('<svg viewBox="0 0 10 10"><image href="a.png" width="5" height="5"/></svg>').hasRasterOnlyContent, true)
    assert.equal(parseSvgDocument('<svg viewBox="0 0 10 10"><defs><text>x</text></defs><rect width="1" height="1"/></svg>').hasRasterOnlyContent, false)
  })

  it('treats opacity 0 as hidden and honours nested svg offsets', () => {
    const { shapes } = parseSvgDocument(`
      <svg viewBox="0 0 100 100">
        <g opacity="0"><rect width="5" height="5"/></g>
        <svg x="40" y="10"><rect id="inner" width="5" height="5"/></svg>
      </svg>`)
    assert.deepEqual(shapes.map((s) => s.name), ['inner'])
    assert.deepEqual(shapes[0]!.polylines[0]!.points.slice(0, 2), [40, 10])
  })
})
