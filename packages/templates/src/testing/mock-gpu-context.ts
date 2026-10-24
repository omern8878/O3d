import type { GpuContext } from "../renderer/gpu-context.ts";
import type { ClearColor } from "../types/renderer.types.ts";

/** Drawing-buffer size of the fake canvas; mutate it to simulate a resize. */
export type MockCanvasSize = { width: number; height: number };

/** A `GpuContext` stand-in backed by a mock device and a fake canvas texture. */
export function createMockGpuContext(
  device: GPUDevice,
  clearColor: ClearColor,
  canvasSize: MockCanvasSize = { width: 300, height: 150 },
): GpuContext {
  const textureView = { label: "mock-canvas-view" };

  return {
    device,
    queue: device.queue,
    format: "bgra8unorm",
    clearColor,
    context: {
      getCurrentTexture: () => ({
        createView: () => textureView,
        width: canvasSize.width,
        height: canvasSize.height,
      }),
    },
    textureView,
  } as unknown as GpuContext;
}
