import { createHeadlessGpuContext, GpuContext, type SceneTemplate } from '@engine/templates'
import { Canvas2dPresenter } from './canvas2d-presenter.ts'

/** Background shared by both backends: a deep blue-black. */
export const BACKGROUND: [number, number, number] = [0.024, 0.027, 0.06]
const MAX_PIXEL_RATIO = 2

export type BackendKind = 'webgpu' | 'canvas2d'

/**
 * Where frames go. Both backends drive the same `SceneTemplate` pipeline
 * (Wasm storage, dirty tracking, culling, picking); WebGPU draws it on the
 * GPU, while the fallback runs it on a headless context and rasterizes the
 * node views in software.
 */
export type RenderBackend = {
  readonly kind: BackendKind
  /** Why the fallback is active, or the adapter in use. */
  readonly detail: string
  readonly gpuContext: GpuContext
  /** Matches the drawing buffer to the canvas's display size. */
  resize(): { width: number; height: number }
  /** Shows the frame `scene.renderFrame()` just produced. */
  present(scene: SceneTemplate): void
}

/** Uses WebGPU when an adapter is available, otherwise the Canvas2D preview. */
export async function createRenderBackend(canvas: HTMLCanvasElement): Promise<RenderBackend> {
  const clearColor = { r: BACKGROUND[0], g: BACKGROUND[1], b: BACKGROUND[2], a: 1 }
  try {
    const gpuContext = await GpuContext.create({ canvas, clearColor })
    return {
      kind: 'webgpu',
      detail: describeAdapter(gpuContext.adapter),
      gpuContext,
      resize: () => {
        gpuContext.resizeToDisplaySize()
        return { width: canvas.width, height: canvas.height }
      },
      present: () => undefined,
    }
  } catch (error) {
    const presenter = new Canvas2dPresenter(canvas, BACKGROUND)
    return {
      kind: 'canvas2d',
      detail: error instanceof Error ? error.message : String(error),
      gpuContext: createHeadlessGpuContext(clearColor),
      resize: () => resizeCanvas(canvas),
      present: (scene) =>
        presenter.present(
          scene.getNodeViews(),
          scene.getCameraController().getViewProjection(),
          scene.getShapeMode(),
        ),
    }
  }
}

function describeAdapter(adapter: GPUAdapter): string {
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info
  const name = [info?.vendor, info?.architecture].filter(Boolean).join(' ')
  return name || 'WebGPU adapter'
}

function resizeCanvas(canvas: HTMLCanvasElement): { width: number; height: number } {
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO)
  const width = Math.max(1, Math.floor(canvas.clientWidth * ratio))
  const height = Math.max(1, Math.floor(canvas.clientHeight * ratio))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  return { width, height }
}
