import { normalizeCloud } from '../cloud/normalize-cloud.ts'
import { createObjSource } from '../import/obj-source.ts'
import type { SceneSource } from '../import/scene-source.types.ts'
import { createSvgSource } from '../import/svg-source.ts'
import type { PixelImage } from '../raster/pixel-cloud-sampler.ts'
import { CAT_LAYER_LABELS, CAT_SVG, CAT_TAIL_PIVOT } from '../vector/cat-vector-svg.ts'
import { galaxyCloud } from './galaxy-cloud.ts'
import { addTeapotSteam } from './teapot-steam.ts'
import { teapotObj } from './teapot-model.ts'
import { torusKnotObj } from './torus-knot-model.ts'

export type PresetId = 'cat' | 'teapot' | 'knot' | 'galaxy'

const GALAXY_AUTO_COUNT = 120_000

/**
 * The built-in scenes. The teapot and knot are generated as OBJ text and
 * imported exactly like a dropped file; the galaxy is a procedural cloud.
 */
export function createPresets(rasterize: (markup: string) => Promise<PixelImage>): Record<PresetId, SceneSource> {
  return {
    cat: createSvgSource(CAT_SVG, {
      id: 'cat', label: 'Vector cat', builtIn: true, tailPivot: CAT_TAIL_PIVOT, labels: CAT_LAYER_LABELS,
    }, rasterize),
    teapot: createObjSource(teapotObj(), {
      id: 'teapot', label: 'Teapot', builtIn: true,
      decorate: addTeapotSteam,
      slice: { layer: 'steam', kind: 'rise' },
      labels: { body: 'Teapot body', lid: 'Lid', spout: 'Spout', handle: 'Handle', steam: 'Steam' },
    }),
    knot: createObjSource(torusKnotObj(), {
      id: 'knot', label: 'Torus knot', builtIn: true,
      slice: { layer: 'pulse', kind: 'pulse' },
      labels: { knot: 'Trefoil knot', pulse: 'Pulse segment' },
    }),
    galaxy: {
      id: 'galaxy', label: 'Galaxy cluster', dimension: '3d', builtIn: true,
      async build(request) {
        const cloud = galaxyCloud(request === 'auto' ? GALAXY_AUTO_COUNT : request)
        normalizeCloud(cloud)
        return {
          cloud,
          slice: { layer: 'core', kind: 'spin' },
          labels: { core: 'Galactic core', arms: 'Spiral arms', halo: 'Stellar halo' },
          detail: `procedural: ${cloud.layers.length} layers`,
        }
      },
    },
  }
}
