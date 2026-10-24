import { normalizeCloud } from '../cloud/normalize-cloud.ts'
import type { ParticleRequest } from '../cloud/point-cloud.types.ts'
import { samplePixelCloud, type PixelImage } from '../raster/pixel-cloud-sampler.ts'
import { parseSvgDocument } from '../vector/svg-document-parser.ts'
import { samplePointCloud } from '../vector/svg-point-sampler.ts'
import type { BuiltScene, SceneSource } from './scene-source.types.ts'
import { liftDarkDrawing } from './svg-contrast.ts'

/** Particles for an SVG in auto mode. */
export const SVG_AUTO_COUNT = 50_000
/** Sample in canonical units so relief depth matches the final scale. */
const CANONICAL_WORLD_HEIGHT = 20
const TAIL_PATTERN = /tail/i

export type SvgSourceOptions = {
  id: string
  label: string
  builtIn: boolean
  /** SVG-space pivot of the tail sway (defaults to the tail layer's centroid). */
  tailPivot?: { x: number; y: number }
  labels?: Readonly<Record<string, string>>
}

/**
 * An SVG as a scene source. Vector shapes are sampled into crisp particles;
 * when the vector parser finds nothing paintable, or the drawing contains
 * text or images it cannot vectorize, the browser rasterizes the SVG and the
 * painted pixels are sampled instead. Either way the result is fitted into
 * canonical `[-10, 10]` space.
 *
 * `rasterize` is the browser rasterizer (injected so the vector path can be
 * tested without a DOM).
 */
export function createSvgSource(
  markup: string,
  options: SvgSourceOptions,
  rasterize: (markup: string) => Promise<PixelImage>,
): SceneSource {
  return {
    id: options.id,
    label: options.label,
    dimension: '2d',
    builtIn: options.builtIn,
    async build(request: ParticleRequest): Promise<BuiltScene> {
      const count = request === 'auto' ? SVG_AUTO_COUNT : request
      const document = safeParse(markup)
      if (!document || document.shapes.length === 0 || document.hasRasterOnlyContent) {
        const cloud = samplePixelCloud(await rasterize(markup), count)
        normalizeCloud(cloud)
        const reason = document?.hasRasterOnlyContent ? 'text or images' : 'no vector shapes'
        return { cloud, slice: null, labels: options.labels ?? {}, detail: `rasterized (${reason})` }
      }

      const lifted = liftDarkDrawing(document)
      const cloud = samplePointCloud(document, { count, worldHeight: CANONICAL_WORLD_HEIGHT })
      const transform = normalizeCloud(cloud)
      const tail = cloud.layers.find((layer) => TAIL_PATTERN.test(layer.name))
      const pivot = tail && options.tailPivot
        ? transform.apply(...cloud.toWorld(options.tailPivot.x, options.tailPivot.y), 0)
        : undefined
      return {
        cloud,
        slice: tail ? { layer: tail.name, kind: 'sway', pivot: pivot ? [pivot[0], pivot[1]] : undefined } : null,
        labels: options.labels ?? {},
        detail: `${cloud.layers.length} vector layers${lifted ? ', dark drawing lifted for contrast' : ''}`,
      }
    },
  }
}

function safeParse(markup: string) {
  try {
    return parseSvgDocument(markup)
  } catch {
    return null
  }
}
