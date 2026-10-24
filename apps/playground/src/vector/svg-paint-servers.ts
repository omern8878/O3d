import { parseAttributes, parseDeclarations } from './svg-attributes.ts'
import { parseSvgColor, type Rgb } from './svg-color.ts'

const GRADIENT_OPEN = /<\s*(linearGradient|radialGradient)\b((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g
const STOP_PATTERN = /<\s*stop\b((?:[^>"']|"[^"]*"|'[^']*')*)\/?>/g
const HREF_ATTRIBUTES = ['href', 'xlink:href']

/**
 * Gradients by id, each reduced to one representative colour (the average
 * of its stops). A particle takes one colour, so this is the closest flat
 * stand-in, and it keeps `fill="url(#g)"` shapes from vanishing.
 * Gradients that only inherit stops through `href` borrow their target's.
 */
export function collectPaintServers(source: string): Map<string, Rgb> {
  const colors = new Map<string, Rgb>()
  const inherits = new Map<string, string>()
  for (const match of source.matchAll(GRADIENT_OPEN)) {
    const [opening, tag, rawAttributes, selfClosing] = match
    const start = match.index + opening.length
    const close = source.indexOf(`</${tag}`, start)
    const body = selfClosing ? '' : source.slice(start, close < 0 ? undefined : close)
    const attributes = parseAttributes(rawAttributes!)
    if (!attributes.id) continue
    const stops = [...body.matchAll(STOP_PATTERN)]
      .map(([, raw]) => {
        const stop = parseAttributes(raw!)
        const style = parseDeclarations(stop.style ?? '')
        return parseSvgColor(style['stop-color'] ?? stop['stop-color'] ?? 'black')
      })
      .filter((color): color is Rgb => color !== null)
    if (stops.length > 0) colors.set(attributes.id, average(stops))
    const href = HREF_ATTRIBUTES.map((name) => attributes[name]).find(Boolean)
    if (stops.length === 0 && href?.startsWith('#')) inherits.set(attributes.id, href.slice(1))
  }
  for (const [id, target] of inherits) {
    const color = colors.get(target)
    if (color) colors.set(id, color)
  }
  return colors
}

function average(colors: readonly Rgb[]): Rgb {
  const sum = colors.reduce<Rgb>((acc, c) => [acc[0] + c[0], acc[1] + c[1], acc[2] + c[2]], [0, 0, 0])
  return [sum[0] / colors.length, sum[1] / colors.length, sum[2] / colors.length]
}
