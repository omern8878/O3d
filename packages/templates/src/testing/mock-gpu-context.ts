import type { GpuContext } from "../renderer/gpu-context.ts";
import type { ClearColor } from "../types/renderer.types.ts";

/** A `GpuContext` stand-in backed by a mock device and a fake canvas texture. */
export function createMockGpuContext(
  device: GPUDevice,
  clearColor: ClearColor,
): GpuContext {
  const textureView = { label: "mock-canvas-view" };

  return {
    device,
    queue: device.queue,
    format: "bgra8unorm",
    clearColor,
    context: {
      getCurrentTexture: () => ({ createView: () => textureView }),
    },
    textureView,
  } as unknown as GpuContext;
}
