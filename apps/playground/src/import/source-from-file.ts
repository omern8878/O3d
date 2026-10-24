import type { PixelImage } from '../raster/pixel-cloud-sampler.ts'
import { createObjSource } from './obj-source.ts'
import type { SceneSource } from './scene-source.types.ts'
import { createSvgSource } from './svg-source.ts'

export type ImportKind = 'svg' | 'obj'

/** By extension first, then by content (`<svg`, or OBJ `v` lines). */
export function detectImportKind(fileName: string, text: string): ImportKind | null {
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase()
  if (extension === 'svg') return 'svg'
  if (extension === 'obj') return 'obj'
  if (/<svg[\s>]/i.test(text.slice(0, 4096))) return 'svg'
  if (/^\s*v\s+-?[\d.]/m.test(text.slice(0, 65536))) return 'obj'
  return null
}

/**
 * A scene source for a dropped or uploaded file.
 *
 * @throws {Error} if the file is neither SVG nor OBJ.
 */
export function sourceFromFile(
  fileName: string,
  text: string,
  rasterize: (markup: string) => Promise<PixelImage>,
): SceneSource {
  const kind = detectImportKind(fileName, text)
  const id = `file:${fileName}`
  if (kind === 'svg') return createSvgSource(text, { id, label: fileName, builtIn: false }, rasterize)
  if (kind === 'obj') return createObjSource(text, { id, label: fileName, builtIn: false })
  throw new Error(`"${fileName}" is not an SVG or OBJ file.`)
}
