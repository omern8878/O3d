import {
  CameraController,
  EntityManager,
  GpuContext,
  InstancedRenderer,
} from '@engine/templates'

const GRID_SIZE = 10
const CELL_SPACING = 16
const QUAD_SIZE = 12
const ORTHO_HALF_HEIGHT = 100

/** Fills a centered `GRID_SIZE` x `GRID_SIZE` grid with a color gradient. */
function populateGrid(entities: EntityManager): void {
  const half = ((GRID_SIZE - 1) * CELL_SPACING) / 2
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      entities.createEntity({
        position: { x: col * CELL_SPACING - half, y: row * CELL_SPACING - half, z: 0 },
        scale: { x: QUAD_SIZE, y: QUAD_SIZE, z: 1 },
        color: {
          r: col / (GRID_SIZE - 1),
          g: row / (GRID_SIZE - 1),
          b: 0.6,
        },
      })
    }
  }
}

/** Creates the GPU context, or returns `null` (after warning) if that fails. */
async function tryCreateGpuContext(canvas: HTMLCanvasElement): Promise<GpuContext | null> {
  if (!navigator.gpu) {
    console.warn('Render demo skipped: WebGPU is not available in this browser.')
    return null
  }
  try {
    return await GpuContext.create({
      canvas,
      clearColor: { r: 0.05, g: 0.05, b: 0.1, a: 1 },
    })
  } catch (err) {
    // Headless browsers expose `navigator.gpu` but have no adapter.
    console.warn(`Render demo skipped: ${err instanceof Error ? err.message : err}`)
    return null
  }
}

/**
 * Renders one frame of a colored entity grid through the full pipeline:
 * Wasm ECS -> dirty-tracked GPU buffers -> camera uniform -> instanced draw.
 *
 * Without a usable GPU (e.g. headless browsers) it logs a warning and returns.
 */
export async function runRenderSceneDemo(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#render-canvas')
  if (!canvas) {
    throw new Error('Render demo needs a <canvas id="render-canvas">.')
  }

  const gpu = await tryCreateGpuContext(canvas)
  if (!gpu) {
    return
  }
  gpu.resizeToDisplaySize()

  const entities = new EntityManager()
  populateGrid(entities)

  const camera = new CameraController({ mode: '2d', orthoHalfHeight: ORTHO_HALF_HEIGHT })
  camera.resize(canvas.width, canvas.height)

  const renderer = new InstancedRenderer(gpu)
  camera.syncIfDirty(renderer)
  const drawn = renderer.render(entities)

  console.log(`Render demo: drew ${drawn} instances in a single draw call.`)
}
