import type { FillRule } from './shape-geometry.ts'
import { parseAttributes, parseDeclarations } from './svg-attributes.ts'
import { parseSvgColor, type Rgb } from './svg-color.ts'
import { collectPaintServers } from './svg-paint-servers.ts'
import { flattenPathData } from './svg-path-flattener.ts'
import { SvgStylesheet } from './svg-stylesheet.ts'
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
  /**
   * Whether the document draws content that has no vector geometry here
   * (`<text>`, `<image>`, `<foreignObject>`): only rasterizing shows it all.
   */
  hasRasterOnlyContent: boolean
}

/** Inherited presentation state while walking the element tree. */
type Context = {
  transform: Affine
  fill: string
  stroke: string
  strokeWidth: number
  fillRule: FillRule
  /** The CSS `color` property, which `currentColor` refers to. */
  color: string
  id: string | null
  hidden: boolean
}

/** An element with an `id`, kept so `<use>` can instantiate it. */
type IndexedElement = { tag: string; attributes: Record<string, string> }

const TAG_PATTERN = /<\s*(\/)?\s*([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/)?\s*>/g
const STYLE_ELEMENT = /<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi
const IGNORED_MARKUP = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<!\[CDATA\[[\s\S]*?\]\]>/gi
/** Elements whose content is never painted directly. */
const NON_RENDERED = new Set([
  'defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'linearGradient',
  'radialGradient', 'style', 'title', 'desc', 'metadata', 'script', 'filter',
])
const SHAPE_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon'])
const RASTER_ONLY_TAGS = new Set(['text', 'image', 'foreignObject'])
/**
 * SVG's initial fill is black, which would vanish on the playground's dark
 * background; unstyled shapes get this light tone instead.
 */
export const DEFAULT_FILL = '#e8ebff'
/** Stand-in for paints we cannot resolve (unknown names, missing servers). */
const FALLBACK_PAINT: Rgb = [0.6, 0.66, 1]
const ROOT_CONTEXT: Context = {
  transform: IDENTITY,
  fill: DEFAULT_FILL,
  stroke: 'none',
  strokeWidth: 1,
  fillRule: 'nonzero',
  color: DEFAULT_FILL,
  id: null,
  hidden: false,
}
/** Curves are flattened into roughly this many segments across the document. */
const SEGMENTS_ACROSS_DOCUMENT = 600
const HREF_ATTRIBUTES = ['href', 'xlink:href']

/**
 * Parses an SVG string into flattened, painted shapes.
 *
 * Supports nested groups and transforms, the basic shapes, `<use>` of shapes,
 * presentation attributes, inline styles and `<style>` sheets (simple
 * selectors, with normal cascade order), `currentColor`, and gradients
 * (reduced to their average stop colour). Unresolvable paints fall back to a
 * visible colour instead of dropping the shape. Text and images are
 * reported through {@link SvgDocument.hasRasterOnlyContent}.
 */
export function parseSvgDocument(svg: string): SvgDocument {
  const stylesheet = new SvgStylesheet(
    [...svg.matchAll(STYLE_ELEMENT)].map(([, css]) => css!.replace(/<!\[CDATA\[|\]\]>/g, '')).join('\n'),
  )
  const source = svg.replace(IGNORED_MARKUP, '')
  const paints = collectPaintServers(source)
  const resolve = (tag: string, raw: string) => resolveAttributes(tag, parseAttributes(raw), stylesheet)
  const elementsById = indexElements(source, resolve)

  const stack: Context[] = [ROOT_CONTEXT]
  const shapes: SvgShape[] = []
  let viewBox: SvgViewBox | null = null
  let segmentLength = 1
  let skipDepth = 0
  let shapeIndex = 0
  let hasRasterOnlyContent = false

  for (const match of source.matchAll(TAG_PATTERN)) {
    const closing = match[1]
    const tag = match[2]!
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

    const attributes = resolve(tag, match[3] ?? '')
    const isRoot = tag === 'svg' && stack.length === 1
    if (isRoot) {
      viewBox = parseViewBox(attributes)
      const size = viewBox ? Math.max(viewBox.width, viewBox.height) : 1000
      segmentLength = size / SEGMENTS_ACROSS_DOCUMENT
    }
    const parent = stack[stack.length - 1]!
    const context = deriveContext(parent, tag === 'svg' && !isRoot ? withOffset(attributes) : attributes)

    if (!context.hidden) {
      if (RASTER_ONLY_TAGS.has(tag)) hasRasterOnlyContent = true
      const instance = tag === 'use' ? instantiateUse(attributes, context, elementsById) : null
      const [shapeTag, shapeAttributes, shapeContext] = instance ?? [tag, attributes, context]
      if (SHAPE_TAGS.has(shapeTag)) {
        shapeIndex++
        const shape = buildShape(shapeTag, shapeAttributes, shapeContext, paints, segmentLength, `${shapeTag}-${shapeIndex}`)
        if (shape) shapes.push(shape)
      }
    }
    // Every open element is pushed so its closing tag pops exactly it.
    if (!selfClosing) stack.push(context)
  }

  if (!viewBox) viewBox = boundsOf(shapes)
  return { viewBox, shapes, hasRasterOnlyContent }
}

/** Presentation attributes, overridden by stylesheet rules, overridden by inline style. */
function resolveAttributes(
  tag: string,
  attributes: Record<string, string>,
  stylesheet: SvgStylesheet,
): Record<string, string> {
  const css = stylesheet.isEmpty
    ? {}
    : stylesheet.declarationsFor({
      tag,
      id: attributes.id ?? null,
      classes: (attributes.class ?? '').split(/\s+/).filter(Boolean),
    })
  return { ...attributes, ...css, ...parseDeclarations(attributes.style ?? '') }
}

/** Every element with an `id`, wherever it is (including `<defs>`), for `<use>`. */
function indexElements(
  source: string,
  resolve: (tag: string, raw: string) => Record<string, string>,
): Map<string, IndexedElement> {
  const elements = new Map<string, IndexedElement>()
  for (const [, closing, tag, raw] of source.matchAll(TAG_PATTERN)) {
    if (closing || !raw?.includes('id')) continue
    const attributes = resolve(tag!, raw)
    if (attributes.id) elements.set(attributes.id, { tag: tag!, attributes })
  }
  return elements
}

/** `<use href="#shape" x y>`: the referenced shape, placed and styled by the use. */
function instantiateUse(
  attributes: Record<string, string>,
  context: Context,
  elementsById: Map<string, IndexedElement>,
): [string, Record<string, string>, Context] | null {
  const href = HREF_ATTRIBUTES.map((name) => attributes[name]).find((value) => value?.startsWith('#'))
  const target = href ? elementsById.get(href.slice(1)) : undefined
  if (!target || !SHAPE_TAGS.has(target.tag)) return null
  const placed = { ...context, transform: multiply(context.transform, offsetTransform(attributes)) }
  const targetContext = deriveContext(placed, { ...target.attributes, transform: target.attributes.transform ?? '' })
  return [target.tag, target.attributes, { ...targetContext, id: attributes.id ?? target.attributes.id ?? null }]
}

/** A nested `<svg>` places its content at its `x`, `y`. */
function withOffset(attributes: Record<string, string>): Record<string, string> {
  const x = Number.parseFloat(attributes.x ?? '0') || 0
  const y = Number.parseFloat(attributes.y ?? '0') || 0
  return { ...attributes, transform: `translate(${x} ${y}) ${attributes.transform ?? ''}` }
}

function offsetTransform(attributes: Record<string, string>): Affine {
  const x = Number.parseFloat(attributes.x ?? '0') || 0
  const y = Number.parseFloat(attributes.y ?? '0') || 0
  return [1, 0, 0, 1, x, y]
}

function deriveContext(parent: Context, attributes: Record<string, string>): Context {
  const strokeWidth = Number.parseFloat(attributes['stroke-width'] ?? '')
  const fillRule = attributes['fill-rule']
  const transparent = (name: string) => attributes[name] !== undefined && Number.parseFloat(attributes[name]!) === 0
  return {
    transform: multiply(parent.transform, parseTransform(attributes.transform)),
    fill: transparent('fill-opacity') ? 'none' : attributes.fill ?? parent.fill,
    stroke: transparent('stroke-opacity') ? 'none' : attributes.stroke ?? parent.stroke,
    strokeWidth: Number.isFinite(strokeWidth) ? strokeWidth : parent.strokeWidth,
    fillRule: fillRule === 'evenodd' || fillRule === 'nonzero' ? fillRule : parent.fillRule,
    color: attributes.color ?? parent.color,
    id: attributes.id ?? parent.id,
    hidden: parent.hidden || attributes.display === 'none' || attributes.visibility === 'hidden' ||
      transparent('opacity'),
  }
}

/**
 * Resolves an SVG paint: `none`, `currentColor`, `url(#server) [fallback]`
 * or a colour. Anything unrecognized becomes a visible fallback colour, so
 * exotic syntax never makes a shape disappear.
 */
function resolvePaint(value: string, context: Context, paints: Map<string, Rgb>): Rgb | null {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (lower === 'none' || lower === 'transparent') return null
  if (lower === 'currentcolor') return parseSvgColor(context.color) ?? FALLBACK_PAINT
  const server = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/i.exec(trimmed)
  if (server) {
    const fallback = server[2]?.trim()
    return paints.get(server[1]!) ?? (fallback ? resolvePaint(fallback, context, paints) : FALLBACK_PAINT)
  }
  return parseSvgColor(trimmed) ?? FALLBACK_PAINT
}

function buildShape(
  tag: string,
  attributes: Record<string, string>,
  context: Context,
  paints: Map<string, Rgb>,
  segmentLength: number,
  fallbackName: string,
): SvgShape | null {
  const pathData = shapeToPathData(tag, attributes)
  if (!pathData) return null
  const fill = tag === 'line' || tag === 'polyline' ? null : resolvePaint(context.fill, context, paints)
  const stroke = resolvePaint(context.stroke, context, paints)
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
