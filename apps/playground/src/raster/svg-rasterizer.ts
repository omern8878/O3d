import type { PixelImage } from './pixel-cloud-sampler.ts'

/** Longest side of the offscreen render, in pixels. */
const RASTER_SIZE = 1024
/** The size browsers assume for an SVG without width, height or viewBox. */
const DEFAULT_SIZE = { width: 300, height: 150 }

/**
 * Renders SVG markup with the browser's own SVG engine into an offscreen
 * canvas and returns its pixels: the fallback for content the vector parser
 * cannot turn into geometry (text, embedded images, filters). Browser-only.
 *
 * @throws {Error} if the browser cannot decode the SVG.
 */
export async function rasterizeSvg(markup: string): Promise<PixelImage> {
  const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
  if (svg.nodeName.toLowerCase() !== 'svg') throw new Error('The file is not a valid SVG document.')
  const { width, height } = intrinsicSize(svg)
  const fit = RASTER_SIZE / Math.max(width, height)
  const canvasWidth = Math.max(1, Math.round(width * fit))
  const canvasHeight = Math.max(1, Math.round(height * fit))
  // Give the root explicit pixel dimensions so it renders at the canvas size.
  svg.setAttribute('width', String(canvasWidth))
  svg.setAttribute('height', String(canvasHeight))
  if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = Object.assign(document.createElement('canvas'), { width: canvasWidth, height: canvasHeight })
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('Canvas 2D is not available for rasterizing.')
    context.drawImage(image, 0, 0, canvasWidth, canvasHeight)
    const { data } = context.getImageData(0, 0, canvasWidth, canvasHeight)
    return { data, width: canvasWidth, height: canvasHeight }
  } catch (error) {
    throw new Error(`The browser could not render this SVG (${error instanceof Error ? error.message : error}).`)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function intrinsicSize(svg: Element): { width: number; height: number } {
  const viewBox = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (viewBox.length === 4 && viewBox[2]! > 0 && viewBox[3]! > 0) return { width: viewBox[2]!, height: viewBox[3]! }
  const width = Number.parseFloat(svg.getAttribute('width') ?? '')
  const height = Number.parseFloat(svg.getAttribute('height') ?? '')
  return width > 0 && height > 0 ? { width, height } : DEFAULT_SIZE
}
