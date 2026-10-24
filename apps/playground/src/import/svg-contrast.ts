import { mixRgb, parseSvgColor, type Rgb } from '../vector/svg-color.ts'
import { DEFAULT_FILL, type SvgDocument } from '../vector/svg-document-parser.ts'

/** A drawing whose brightest paint is darker than this would vanish on the dark background. */
const DARK_DRAWING_LUMINANCE = 0.15
/** How far dark paints are pulled toward the light default. */
const LIFT = 0.8
const LIGHT = parseSvgColor(DEFAULT_FILL)!

/**
 * Lifts an entirely dark drawing (black line art, a dark logo) toward a light
 * tone, in place, keeping the relative differences between its colours.
 * Drawings with any bright paint are left untouched, so intentional dark
 * details (pupils on bright eyes) survive. Returns whether it lifted.
 */
export function liftDarkDrawing(document: SvgDocument): boolean {
  const paints = document.shapes.flatMap((shape) => [shape.fill, shape.stroke]).filter((c): c is Rgb => c !== null)
  if (paints.length === 0 || Math.max(...paints.map(luminance)) >= DARK_DRAWING_LUMINANCE) return false
  for (const shape of document.shapes) {
    if (shape.fill) shape.fill = mixRgb(shape.fill, LIGHT, LIFT)
    if (shape.stroke) shape.stroke = mixRgb(shape.stroke, LIGHT, LIFT)
  }
  return true
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
