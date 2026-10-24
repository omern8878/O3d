/** An RGB color with each channel in `0..1`. */
export type Rgb = [number, number, number]

const NAMED_COLORS: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  red: '#ff0000',
  green: '#008000',
  lime: '#00ff00',
  blue: '#0000ff',
  yellow: '#ffff00',
  cyan: '#00ffff',
  aqua: '#00ffff',
  magenta: '#ff00ff',
  fuchsia: '#ff00ff',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  brown: '#a52a2a',
  navy: '#000080',
  teal: '#008080',
  gold: '#ffd700',
  beige: '#f5f5dc',
  chocolate: '#d2691e',
  coral: '#ff7f50',
  crimson: '#dc143c',
  darkblue: '#00008b',
  darkgray: '#a9a9a9',
  darkgrey: '#a9a9a9',
  darkgreen: '#006400',
  darkred: '#8b0000',
  hotpink: '#ff69b4',
  indigo: '#4b0082',
  khaki: '#f0e68c',
  lightblue: '#add8e6',
  lightgray: '#d3d3d3',
  lightgrey: '#d3d3d3',
  maroon: '#800000',
  olive: '#808000',
  orangered: '#ff4500',
  royalblue: '#4169e1',
  salmon: '#fa8072',
  skyblue: '#87ceeb',
  steelblue: '#4682b4',
  tan: '#d2b48c',
  tomato: '#ff6347',
  turquoise: '#40e0d0',
  violet: '#ee82ee',
}

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i
const RGB_PATTERN = /^rgba?\(\s*([\d.]+)(%?)[\s,]+([\d.]+)(%?)[\s,]+([\d.]+)(%?)/i
const MAX_CHANNEL = 255

/**
 * Parses an SVG paint value. Returns `null` for `none`, `transparent` and
 * anything unsupported (gradients, `currentColor`), which callers treat as
 * "no paint".
 */
export function parseSvgColor(value: string | undefined): Rgb | null {
  if (value === undefined) return null
  const trimmed = value.trim().toLowerCase()
  const hex = NAMED_COLORS[trimmed] ?? trimmed

  const hexMatch = HEX_PATTERN.exec(hex)
  if (hexMatch) {
    const digits =
      hexMatch[1]!.length === 3 ? [...hexMatch[1]!].map((d) => d + d).join('') : hexMatch[1]!
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / MAX_CHANNEL) as Rgb
  }

  const rgbMatch = RGB_PATTERN.exec(trimmed)
  if (rgbMatch) {
    const channel = (amount: string, percent: string) =>
      clamp01(Number(amount) / (percent ? 100 : MAX_CHANNEL))
    return [
      channel(rgbMatch[1]!, rgbMatch[2]!),
      channel(rgbMatch[3]!, rgbMatch[4]!),
      channel(rgbMatch[5]!, rgbMatch[6]!),
    ]
  }
  return null
}

/** Linear blend from `a` (t = 0) to `b` (t = 1). */
export function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}
