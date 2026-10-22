import type { FillRule } from './shape-geometry.ts'
import { parseSvgColor, type Rgb } from './svg-color.ts'
import { flattenPathData } from './svg-path-flattener.ts'
import { applyAffine, IDENTITY, multiply, parseTransform, type Affine } from './svg-transform.ts'
import type { Polyline } from './polyline.types.ts'

/** One drawable element, flattened into the root SVG coordinate system. */
export type SvgShape = {
  /** Layer name: the element's `id`, else its nearest ancestor's, else `tag-N`. */
  name: string
  fill: Rgb | null
  stroke: Rgb | null
  strokeWidth: number
  fillRule: FillRule
  polylines: Polyline[]
}

export type SvgViewBox = { x: number; y: number; width: number; height: number }

export type SvgDocument = {
  viewBox: SvgViewBox | null
  shapes: SvgShape[]
}

/** Inherited presentation state while walking the element tree. */
type Context = {
  transform: Affine
  fill: string
  stroke: string
  strokeWidth: number
  fillRule: FillRule
  id: string | null
  hidden: boolean
}

const TAG_PATTERN = /<\s*(\/)?\s*([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?\s*>/g
const ATTRIBUTE_PATTERN = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
const IGNORED_MARKUP = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>/gi
/** Elements whose content is never painted directly. */
const NON_RENDERED = new Set([
  'defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'linearGradient',
  'radialGradient', 'style', 'title', 'desc', 'metadata', 'script', 'filter',
])
const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const ROOT_CONTEXT: Context = {
  transform: IDENTITY,
  fill: 'black',
  stroke: 'none',
  strokeWidth: 1,
  fillRule: 'nonzero',
  id: null,
  hidden: false,
}
/** Curves are flattened into roughly this many segments across the document. */
const SEGMENTS_ACROSS_DOCUMENT = 600

/**
 * Parses an SVG string into flattened, painted shapes. Handles nested groups,
 * inherited `fill` / `stroke` / `stroke-width` / `fill-rule` (as attributes or
 * inline `style`), `transform`, and the basic shapes. Gradients, CSS
 * stylesheets, `<use>` and text are not supported and are skipped.
 */
export function parseSvgDocument(svg: string): SvgDocument {
  const source = svg.replace(IGNORED_MARKUP, '')
  const stack: Context[] = [ROOT_CONTEXT]
  const shapes: SvgShape[] = []
  let viewBox: SvgViewBox | null = null
  let segmentLength = 1
  let skipDepth = 0
  let shapeIndex = 0

  for (const match of source.matchAll(TAG_PATTERN)) {
    const closing = match[1]
    const tag = match[2]!
    const rawAttributes = match[3] ?? ''
    const selfClosing = match[4]
    if (closing) {
      if (skipDepth > 0) skipDepth--
      else if (stack.length > 1) stack.pop()
      continue
    }
    if (skipDepth > 0 || NON_RENDERED.has(tag)) {
      if (!selfClosing) skipDepth++
      continue
    }

    const attributes = parseAttributes(rawAttributes)
    if (tag === 'svg' && stack.length === 1) {
      viewBox = parseViewBox(attributes)
      const size = viewBox ? Math.max(viewBox.width, viewBox.height) : 1000
      segmentLength = size / SEGMENTS_ACROSS_DOCUMENT
    }
    const context = deriveContext(stack[stack.length - 1]!, attributes)

    if (SHAPE_TAGS.has(tag) && !context.hidden) {
      shapeIndex++
      const shape = buildShape(tag, attributes, context, segmentLength, `${tag}-${shapeIndex}`)
      if (shape) shapes.push(shape)
    }
    // Every open element is pushed so its closing tag pops exactly it.
    if (!selfClosing) stack.push(context)
  }

  if (!viewBox) viewBox = boundsOf(shapes)
  return { viewBox, shapes }
}

function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const [, name, doubleQuoted, singleQuoted] of raw.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[name!] = doubleQuoted ?? singleQuoted ?? ''
  }
  // Inline style declarations win over presentation attributes.
  for (const declaration of (attributes.style ?? '').split(';')) {
    const [property, value] = declaration.split(':').map((part) => part?.trim())
    if (property && value) attributes[property] = value
  }
  return attributes
}

function deriveContext(parent: Context, attributes: Record<string, string>): Context {
  const strokeWidth = Number.parseFloat(attributes['stroke-width'] ?? '')
  const fillRule = attributes['fill-rule']
  return {
    transform: multiply(parent.transform, parseTransform(attributes.transform)),
    fill: attributes.fill ?? parent.fill,
    stroke: attributes.stroke ?? parent.stroke,
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : parent.strokeWidth,
    fillRule: fillRule === 'evenodd' || fillRule === 'nonzero' ? fillRule : parent.fillRule,
    id: attributes.id ?? parent.id,
    hidden: parent.hidden || attributes.display === 'none' || attributes.visibility === 'hidden',
  }
}

function buildShape(
  tag: string,
  attributes: Record<string, string>,
  context: Context,
  segmentLength: number,
  fallbackName: string,
): SvgShape | null {
  const pathData = shapeToPathData(tag, attributes)
  if (!pathData) return null
  const fill = tag === 'line' || tag === 'polyline' ? null : parseSvgColor(context.fill)
  const stroke = parseSvgColor(context.stroke)
  if (!fill && !stroke) return null

  const polylines = flattenPathData(pathData, segmentLength).map(({ points, closed }) => {
    const transformed: number[] = []
    for (let i = 0; i < points.length; i += 2) {
      transformed.push(...applyAffine(context.transform, points[i]!, points[i + 1]!))
    }
    return { points: transformed, closed }
  })
  if (polylines.length === 0) return null

  const [a, b, c, d] = context.transform
  return {
    name: context.id ?? fallbackName,
    fill,
    stroke,
    strokeWidth: context.strokeWidth * Math.sqrt(Math.abs(a * d - b * c)),
    fillRule: context.fillRule,
    polylines,
  }
}

/** Every basic shape expressed as path data, so one flattener handles them all. */
function shapeToPathData(tag: string, a: Record<string, string>): string | null {
  const num = (name: string, fallback = 0) => {
    const value = Number.parseFloat(a[name] ?? '')
    return Number.isFinite(value) ? value : fallback
  }
  switch (tag) {
    case 'path':
      return a.d ?? null
    case 'rect': {
      const [x, y, w, h] = [num('x'), num('y'), num('width'), num('height')]
      if (w <= 0 || h <= 0) return null
      const rx = Math.min(num('rx', num('ry')), w / 2)
      const ry = Math.min(num('ry', rx), h / 2)
      if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}` +
        `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
        `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
    }
    case 'circle':
    case 'ellipse': {
      const rx = tag === 'circle' ? num('r') : num('rx')
      const ry = tag === 'circle' ? num('r') : num('ry')
      if (rx <= 0 || ry <= 0) return null
      const [cx, cy] = [num('cx'), num('cy')]
      return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`
    }
    case 'line':
      return `M${num('x1')} ${num('y1')}L${num('x2')} ${num('y2')}`
    case 'polyline':
    case 'polygon': {
      const coordinates = (a.points ?? '').trim()
      if (!coordinates) return null
      return `M${coordinates}${tag === 'polygon' ? 'Z' : ''}`
    }
    default:
      return null
  }
}

function parseViewBox(attributes: Record<string, string>): SvgViewBox | null {
  const values = (attributes.viewBox ?? '').split(/[\s,]+/).filter(Boolean).map(Number)
  if (values.length === 4 && values.every(Number.isFinite) && values[2]! > 0 && values[3]! > 0) {
    return { x: values[0]!, y: values[1]!, width: values[2]!, height: values[3]! }
  }
  const width = Number.parseFloat(attributes.width ?? '')
  const height = Number.parseFloat(attributes.height ?? '')
  return width > 0 && height > 0 ? { x: 0, y: 0, width, height } : null
}

function boundsOf(shapes: readonly SvgShape[]): SvgViewBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const { polylines } of shapes) {
    for (const { points } of polylines) {
      for (let i = 0; i < points.length; i += 2) {
        minX = Math.min(minX, points[i]!)
        maxX = Math.max(maxX, points[i]!)
        minY = Math.min(minY, points[i + 1]!)
        maxY = Math.max(maxY, points[i + 1]!)
      }
    }
  }
  return maxX > minX && maxY > minY ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null
}
