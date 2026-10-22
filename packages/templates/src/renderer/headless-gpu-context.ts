import type { ClearColor } from "../types/renderer.types.ts";
import type { GpuContext } from "./gpu-context.ts";

const DEFAULT_CLEAR_COLOR: ClearColor = { r: 0, g: 0, b: 0, a: 1 };
const HEADLESS_FORMAT: GPUTextureFormat = "bgra8unorm";

/** A render pass that accepts and ignores every command. */
const NULL_PASS = new Proxy({}, { get: () => () => undefined });

/** The subset of `GPUDevice` the engine calls, with every command discarded. */
function createNullDevice(): GPUDevice {
  const nullBuffer = (size: number) => ({ size, destroy: () => undefined });
  return {
    createBuffer: ({ size }: GPUBufferDescriptor) => nullBuffer(size),
    createShaderModule: () => ({}),
    createRenderPipeline: () => ({}),
    createBindGroupLayout: () => ({}),
    createPipelineLayout: () => ({}),
    createBindGroup: () => ({}),
    createCommandEncoder: () => ({
      beginRenderPass: () => NULL_PASS,
      finish: () => ({}),
    }),
    queue: {
      writeBuffer: () => undefined,
      submit: () => undefined,
    },
  } as unknown as GPUDevice;
}

/**
 * A `GpuContext` with no GPU behind it: every buffer write and draw is
 * discarded, while the CPU side (Wasm storage, dirty tracking, culling,
 * picking and upload accounting) runs for real.
 *
 * Use it for benchmarks, server-side tests, or a non-WebGPU preview that
 * rasterizes the scene some other way. It needs no browser APIs.
 */
export function createHeadlessGpuContext(
  clearColor: ClearColor = DEFAULT_CLEAR_COLOR,
): GpuContext {
  const device = createNullDevice();
  return {
    device,
    queue: device.queue,
    format: HEADLESS_FORMAT,
    clearColor,
    context: {
      getCurrentTexture: () => ({ createView: () => ({}) }),
    },
  } as unknown as GpuContext;
}
